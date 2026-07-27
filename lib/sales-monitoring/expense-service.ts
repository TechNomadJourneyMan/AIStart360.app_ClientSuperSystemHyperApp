import type { PoolClient } from 'pg'
import type {
  CreateExpenseInput,
  ExpenseOperationType,
  ExpenseResult,
} from '@/types/sales-monitoring'
import type { SalesAccessContext } from './access'
import { executeIdempotent } from './database'
import { DomainError } from './errors'
import { signalAnalytics, writeAudit, writeOutbox } from './events'

interface ExpenseRow {
  id: string
  organization_id: string
  status: ExpenseResult['status']
  operation_type: ExpenseOperationType
  document_date: string | Date
  payment_date: string | Date | null
  category_id: string
  cost_center_id: string | null
  amount: string
  base_amount: string
  currency: string
  affects_pnl: boolean
  affects_cash_flow: boolean
  comment: string | null
}

function toDate(value: string | Date | null): string | null {
  if (!value) return null
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
}

function mapExpense(row: ExpenseRow): ExpenseResult {
  return {
    id: row.id,
    organizationId: row.organization_id,
    status: row.status,
    operationType: row.operation_type,
    documentDate: toDate(row.document_date)!,
    paymentDate: toDate(row.payment_date),
    amount: row.base_amount,
    currency: row.currency.trim(),
    affectsPnl: row.affects_pnl,
    affectsCashFlow: row.affects_cash_flow,
  }
}

const effects: Record<ExpenseOperationType, { pnl: boolean; cash: boolean }> = {
  operating_expense: { pnl: true, cash: true },
  write_off: { pnl: true, cash: false },
  owner_payment: { pnl: false, cash: true },
  tax: { pnl: true, cash: true },
  capital_expense: { pnl: false, cash: true },
  internal_transfer: { pnl: false, cash: true },
  adjustment: { pnl: true, cash: false },
  depreciation: { pnl: true, cash: false },
}

async function assertPeriodOpen(client: PoolClient, organizationId: string, date: string) {
  const closed = await client.query(
    `SELECT id FROM accounting_periods
     WHERE organization_id = $1 AND $2::date BETWEEN starts_on AND ends_on
       AND status = 'closed' LIMIT 1`,
    [organizationId, date],
  )
  if (closed.rowCount) throw new DomainError('PERIOD_CLOSED', 'Финансовый период закрыт', 409)
}

export async function createExpense(
  input: CreateExpenseInput,
  access: SalesAccessContext,
  idempotencyKey: string,
  request?: Request,
) {
  return executeIdempotent(
    {
      organizationId: input.organizationId,
      actorId: access.actorId,
      operation: 'expense.create',
      key: idempotencyKey,
    },
    async (client) => {
      await assertPeriodOpen(client, input.organizationId, input.documentDate)
      const category = await client.query(
        `SELECT id FROM expense_categories
         WHERE id = $1::uuid AND organization_id = $2 AND archived_at IS NULL`,
        [input.categoryId, input.organizationId],
      )
      if (!category.rowCount) throw new DomainError('EXPENSE_CATEGORY_NOT_FOUND', 'Статья расхода не найдена', 422)

      const effect = effects[input.operationType]
      const inserted = await client.query<ExpenseRow>(
        `INSERT INTO expenses (
           organization_id, operation_type, document_date, payment_date,
           category_id, cost_center_id, amount, currency, base_amount,
           supplier, document_number, comment, attachment_paths,
           affects_pnl, affects_cash_flow, source, source_ref, created_by
         ) VALUES (
           $1,$2,$3::date,$4::date,$5::uuid,$6::uuid,$7,$8,$7,
           $9,$10,$11,$12::text[],$13,$14,$15,$16,$17
         ) RETURNING *`,
        [
          input.organizationId,
          input.operationType,
          input.documentDate,
          input.paymentDate ?? null,
          input.categoryId,
          input.costCenterId ?? null,
          input.amount,
          input.currency ?? 'KZT',
          input.supplier ?? null,
          input.documentNumber ?? null,
          input.comment ?? null,
          input.attachmentPaths ?? [],
          effect.pnl,
          effect.cash,
          input.source ?? 'manual',
          input.sourceRef ?? null,
          access.actorId,
        ],
      )
      const expense = mapExpense(inserted.rows[0])
      await writeAudit(client, {
        access,
        entityType: 'expense',
        entityId: expense.id,
        action: 'expense.created',
        after: expense,
        request,
      })
      await writeOutbox(client, {
        access,
        eventType: 'expense.created',
        entityType: 'expense',
        entityId: expense.id,
      })
      return { status: 201, body: { data: expense } }
    },
  )
}

async function loadExpense(client: PoolClient, organizationId: string, expenseId: string) {
  const result = await client.query<ExpenseRow>(
    `SELECT * FROM expenses WHERE id = $1::uuid AND organization_id = $2 FOR UPDATE`,
    [expenseId, organizationId],
  )
  if (!result.rows[0]) throw new DomainError('EXPENSE_NOT_FOUND', 'Расход не найден', 404)
  return result.rows[0]
}

export async function postExpense(
  organizationId: string,
  expenseId: string,
  access: SalesAccessContext,
  idempotencyKey: string,
  request?: Request,
) {
  return executeIdempotent(
    {
      organizationId,
      actorId: access.actorId,
      operation: `expense.post:${expenseId}`,
      key: idempotencyKey,
    },
    async (client) => {
      const expense = await loadExpense(client, organizationId, expenseId)
      if (expense.status !== 'draft') {
        throw new DomainError('EXPENSE_NOT_POSTABLE', 'Расход нельзя провести в текущем статусе', 409)
      }
      await assertPeriodOpen(client, organizationId, toDate(expense.document_date)!)
      const category = await client.query<{ pnl_line: string | null; cash_flow_line: string | null }>(
        `SELECT pnl_line, cash_flow_line FROM expense_categories WHERE id = $1::uuid`,
        [expense.category_id],
      )
      const lines = category.rows[0]

      if (expense.affects_pnl) {
        await client.query(
          `INSERT INTO management_ledger_entries (
             organization_id, source_type, source_id, entry_date, account,
             amount, currency, pnl_line, cost_center_id
           ) VALUES ($1,'expense',$2::uuid,$3::date,'expense',-($4::numeric),$5,$6,$7::uuid)`,
          [
            organizationId,
            expenseId,
            toDate(expense.document_date),
            expense.base_amount,
            expense.currency,
            lines?.pnl_line ?? 'operating_expenses',
            expense.cost_center_id,
          ],
        )
      }
      if (expense.affects_cash_flow && expense.payment_date) {
        await client.query(
          `INSERT INTO management_ledger_entries (
             organization_id, source_type, source_id, entry_date, account,
             amount, currency, cash_flow_line, cost_center_id
           ) VALUES ($1,'expense',$2::uuid,$3::date,'cash_outflow',-($4::numeric),$5,$6,$7::uuid)`,
          [
            organizationId,
            expenseId,
            toDate(expense.payment_date),
            expense.base_amount,
            expense.currency,
            lines?.cash_flow_line ?? expense.operation_type,
            expense.cost_center_id,
          ],
        )
      }
      const posted = await client.query<ExpenseRow>(
        `UPDATE expenses
         SET status = 'posted', posted_by = $2, posted_at = now(), version = version + 1
         WHERE id = $1::uuid RETURNING *`,
        [expenseId, access.actorId],
      )
      await writeAudit(client, {
        access,
        entityType: 'expense',
        entityId: expenseId,
        action: 'expense.posted',
        before: { status: 'draft' },
        after: { status: 'posted' },
        request,
      })
      await writeOutbox(client, {
        access,
        eventType: 'expense.posted',
        entityType: 'expense',
        entityId: expenseId,
        payload: { amount: expense.base_amount, operationType: expense.operation_type },
      })
      await signalAnalytics(client, organizationId, 'expense.posted', 'expense', expenseId)
      return { status: 200, body: { data: mapExpense(posted.rows[0]) } }
    },
  )
}

export async function reverseExpense(
  input: {
    organizationId: string
    expenseId: string
    reason: string
    reversedAt?: string
  },
  access: SalesAccessContext,
  idempotencyKey: string,
  request?: Request,
) {
  return executeIdempotent(
    {
      organizationId: input.organizationId,
      actorId: access.actorId,
      operation: `expense.reverse:${input.expenseId}`,
      key: idempotencyKey,
    },
    async (client) => {
      const original = await loadExpense(client, input.organizationId, input.expenseId)
      if (original.status !== 'posted') {
        throw new DomainError('EXPENSE_NOT_REVERSIBLE', 'Сторнировать можно только проведённый расход', 409)
      }
      const reversedAt = input.reversedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
      await assertPeriodOpen(client, input.organizationId, reversedAt)
      const reversal = await client.query<ExpenseRow>(
        `INSERT INTO expenses (
           organization_id, status, operation_type, document_date, payment_date,
           category_id, cost_center_id, amount, currency, base_amount,
           supplier, document_number, comment, attachment_paths,
           affects_pnl, affects_cash_flow, source, source_ref,
           original_expense_id, created_by, posted_by, posted_at
         )
         SELECT organization_id, 'posted', operation_type, $2::date,
           CASE WHEN affects_cash_flow THEN $2::date ELSE NULL END,
           category_id, cost_center_id, amount, currency, base_amount,
           supplier, document_number, $3, '{}', affects_pnl, affects_cash_flow,
           'reversal', id::text, id, $4, $4, now()
         FROM expenses WHERE id = $1::uuid
         RETURNING *`,
        [input.expenseId, reversedAt, input.reason, access.actorId],
      )
      const reversalRow = reversal.rows[0]

      const entries = await client.query<{
        id: string
        account: string
        amount: string
        currency: string
        pnl_line: string | null
        cash_flow_line: string | null
        cost_center_id: string | null
      }>(
        `SELECT id, account, amount::text, currency, pnl_line, cash_flow_line, cost_center_id
         FROM management_ledger_entries
         WHERE source_type = 'expense' AND source_id = $1::uuid`,
        [input.expenseId],
      )
      for (const entry of entries.rows) {
        await client.query(
          `INSERT INTO management_ledger_entries (
             organization_id, source_type, source_id, entry_date, account,
             amount, currency, pnl_line, cash_flow_line, cost_center_id, reversal_of_id
           ) VALUES ($1,'expense_reversal',$2::uuid,$3::date,$4,-($5::numeric),
             $6,$7,$8,$9::uuid,$10::uuid)`,
          [
            input.organizationId,
            reversalRow.id,
            reversedAt,
            entry.account,
            entry.amount,
            entry.currency,
            entry.pnl_line,
            entry.cash_flow_line,
            entry.cost_center_id,
            entry.id,
          ],
        )
      }
      await client.query(
        `UPDATE expenses
         SET status = 'reversed', reversed_by_expense_id = $2::uuid, version = version + 1
         WHERE id = $1::uuid`,
        [input.expenseId, reversalRow.id],
      )
      await writeAudit(client, {
        access,
        entityType: 'expense',
        entityId: input.expenseId,
        action: 'expense.reversed',
        reason: input.reason,
        after: { reversalId: reversalRow.id },
        request,
      })
      await writeOutbox(client, {
        access,
        eventType: 'expense.reversed',
        entityType: 'expense',
        entityId: input.expenseId,
        payload: { reversalId: reversalRow.id },
      })
      await signalAnalytics(client, input.organizationId, 'expense.reversed', 'expense', input.expenseId)
      return { status: 201, body: { data: mapExpense(reversalRow), originalExpenseId: input.expenseId } }
    },
  )
}
