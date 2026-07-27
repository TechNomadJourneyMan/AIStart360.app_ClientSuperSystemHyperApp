import type { PoolClient } from 'pg'
import type { CreateSaleInput, SaleResult } from '@/types/sales-monitoring'
import type { SalesAccessContext } from './access'
import { assertScopedAccess } from './access'
import {
  calculateSaleLine,
  minorToMoney,
  sumMinor,
} from './calculations'
import { executeIdempotent, query } from './database'
import { DomainError } from './errors'
import { signalAnalytics, writeAudit, writeOutbox } from './events'

interface VariantRow {
  variant_id: string
  sku: string
  size: string | null
  color: string | null
  product_id: string
  product_name: string
  cost_version_id: string | null
  unit_cost: string | null
}

interface SaleRow {
  id: string
  organization_id: string
  number: string
  status: SaleResult['status']
  sold_at: Date
  currency: string
  revenue_total: string
  cost_total: string
  gross_profit_total: string
  discount_total: string
  bonus_total: string
  region_id: string | null
  channel_id: string | null
  negative_margin_reason: string | null
  negative_margin_comment: string | null
}

function mapSale(row: SaleRow): SaleResult {
  return {
    id: row.id,
    organizationId: row.organization_id,
    number: row.number,
    status: row.status,
    soldAt: row.sold_at.toISOString(),
    currency: row.currency.trim(),
    revenueTotal: row.revenue_total,
    costTotal: row.cost_total,
    grossProfitTotal: row.gross_profit_total,
    discountTotal: row.discount_total,
    bonusTotal: row.bonus_total,
  }
}

async function assertPeriodOpen(client: PoolClient, organizationId: string, at: string | Date) {
  const date = typeof at === 'string' ? at.slice(0, 10) : at.toISOString().slice(0, 10)
  const result = await client.query(
    `SELECT id FROM accounting_periods
     WHERE organization_id = $1 AND $2::date BETWEEN starts_on AND ends_on
       AND status = 'closed'
     LIMIT 1`,
    [organizationId, date],
  )
  if (result.rowCount) {
    throw new DomainError('PERIOD_CLOSED', 'Финансовый период закрыт', 409, { date })
  }
}

async function nextSaleNumber(client: PoolClient, soldAt: string | Date): Promise<string> {
  const prefix = (typeof soldAt === 'string' ? new Date(soldAt) : soldAt)
    .toISOString()
    .slice(0, 7)
    .replace('-', '')
  const sequence = await client.query<{ value: string }>(
    `SELECT nextval('sale_number_seq')::text AS value`,
  )
  return `SALE-${prefix}-${sequence.rows[0].value.padStart(6, '0')}`
}

async function loadVariantAt(
  client: PoolClient,
  organizationId: string,
  variantId: string,
  soldAt: string,
): Promise<VariantRow> {
  const result = await client.query<VariantRow>(
    `SELECT
       v.id AS variant_id, v.sku, v.size, v.color,
       p.id AS product_id, p.name AS product_name,
       cv.id AS cost_version_id, cv.base_amount::text AS unit_cost
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN LATERAL (
       SELECT id, base_amount
       FROM product_cost_versions
       WHERE product_variant_id = v.id
         AND valid_from <= $3::timestamptz
         AND (valid_to IS NULL OR valid_to > $3::timestamptz)
       ORDER BY valid_from DESC
       LIMIT 1
     ) cv ON true
     WHERE v.id = $1::uuid AND v.organization_id = $2
       AND v.archived_at IS NULL AND p.archived_at IS NULL`,
    [variantId, organizationId, soldAt],
  )
  const row = result.rows[0]
  if (!row) {
    throw new DomainError('PRODUCT_VARIANT_NOT_FOUND', 'Вариант товара не найден', 422, { variantId })
  }
  if (!row.cost_version_id || row.unit_cost === null) {
    throw new DomainError(
      'COST_VERSION_REQUIRED',
      `Для товара ${row.sku} отсутствует действующая себестоимость`,
      422,
      { variantId, soldAt },
    )
  }
  return row
}

export async function createSale(
  input: CreateSaleInput,
  access: SalesAccessContext,
  idempotencyKey: string,
  request?: Request,
) {
  assertScopedAccess(access, input.regionId, input.channelId)
  return executeIdempotent<{ data: SaleResult; approvalRequired?: boolean; approvalId?: string }>(
    {
      organizationId: input.organizationId,
      actorId: access.actorId,
      operation: 'sale.create',
      key: idempotencyKey,
    },
    async (client) => {
      await assertPeriodOpen(client, input.organizationId, input.soldAt)

      const region = input.regionId
        ? await client.query<{ name: string }>(
          `SELECT name FROM sales_regions WHERE id = $1::uuid AND organization_id = $2 AND archived_at IS NULL`,
          [input.regionId, input.organizationId],
        )
        : null
      if (input.regionId && !region?.rows[0]) throw new DomainError('REGION_NOT_FOUND', 'Регион не найден', 422)

      const channel = input.channelId
        ? await client.query<{ name: string }>(
          `SELECT name FROM sales_channels WHERE id = $1::uuid AND organization_id = $2 AND archived_at IS NULL`,
          [input.channelId, input.organizationId],
        )
        : null
      if (input.channelId && !channel?.rows[0]) throw new DomainError('CHANNEL_NOT_FOUND', 'Канал не найден', 422)

      const prepared = []
      for (const item of input.items) {
        const variant = await loadVariantAt(
          client,
          input.organizationId,
          item.productVariantId,
          input.soldAt,
        )
        const calculated = calculateSaleLine({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: variant.unit_cost!,
          discountAmount: item.discountAmount,
        })
        prepared.push({ input: item, variant, calculated })
      }

      const totals = {
        revenue: sumMinor(prepared.map((item) => item.calculated.revenueMinor)),
        cost: sumMinor(prepared.map((item) => item.calculated.costMinor)),
        grossProfit: sumMinor(prepared.map((item) => item.calculated.grossProfitMinor)),
        discount: sumMinor(prepared.map((item) => item.calculated.discountMinor)),
        bonus: sumMinor(prepared.map((item) => item.calculated.bonusMinor)),
      }
      const number = await nextSaleNumber(client, input.soldAt)
      const saleResult = await client.query<SaleRow>(
        `INSERT INTO sales (
           organization_id, number, sold_at, manager_id, manager_name_snapshot,
           region_id, region_name_snapshot, channel_id, channel_name_snapshot,
           currency, revenue_total, cost_total, gross_profit_total,
           discount_total, bonus_total, negative_margin_reason,
           negative_margin_comment, source, source_ref, created_by
         ) VALUES (
           $1,$2,$3::timestamptz,$4,$5,$6::uuid,$7,$8::uuid,$9,$10,
           $11,$12,$13,$14,$15,$16,$17,$18,$19,$20
         )
         RETURNING *`,
        [
          input.organizationId,
          number,
          input.soldAt,
          input.managerId ?? access.actorId,
          input.managerName ?? access.email,
          input.regionId ?? null,
          region?.rows[0]?.name ?? null,
          input.channelId ?? null,
          channel?.rows[0]?.name ?? null,
          input.currency ?? 'KZT',
          minorToMoney(totals.revenue),
          minorToMoney(totals.cost),
          minorToMoney(totals.grossProfit),
          minorToMoney(totals.discount),
          minorToMoney(totals.bonus),
          input.negativeMarginReason ?? null,
          input.negativeMarginComment ?? null,
          input.source ?? 'manual',
          input.sourceRef ?? null,
          access.actorId,
        ],
      )
      const sale = saleResult.rows[0]

      const lines: NonNullable<SaleResult['lines']> = []
      for (const item of prepared) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO sale_items (
             sale_id, organization_id, product_variant_id,
             product_name_snapshot, sku_snapshot, size_snapshot, color_snapshot,
             quantity, unit_price, discount_amount, revenue_amount,
             unit_cost_snapshot, cost_amount, gross_profit_amount,
             bonus_rate_snapshot, bonus_amount, cost_version_id
           ) VALUES (
             $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,$15,$16::uuid
           ) RETURNING id`,
          [
            sale.id,
            input.organizationId,
            item.variant.variant_id,
            item.variant.product_name,
            item.variant.sku,
            item.variant.size,
            item.variant.color,
            item.input.quantity,
            item.input.unitPrice,
            item.input.discountAmount ?? '0.00',
            minorToMoney(item.calculated.revenueMinor),
            item.variant.unit_cost,
            minorToMoney(item.calculated.costMinor),
            minorToMoney(item.calculated.grossProfitMinor),
            minorToMoney(item.calculated.bonusMinor),
            item.variant.cost_version_id,
          ],
        )
        lines.push({
          id: inserted.rows[0].id,
          productVariantId: item.variant.variant_id,
          productName: item.variant.product_name,
          sku: item.variant.sku,
          size: item.variant.size,
          color: item.variant.color,
          quantity: item.input.quantity,
          unitPrice: item.input.unitPrice,
          discountAmount: item.input.discountAmount ?? '0.00',
          revenueAmount: minorToMoney(item.calculated.revenueMinor),
          unitCost: item.variant.unit_cost!,
          costAmount: minorToMoney(item.calculated.costMinor),
          grossProfitAmount: minorToMoney(item.calculated.grossProfitMinor),
          bonusAmount: minorToMoney(item.calculated.bonusMinor),
        })
      }

      const response = { ...mapSale(sale), lines }
      await writeAudit(client, {
        access,
        entityType: 'sale',
        entityId: sale.id,
        action: 'sale.created',
        after: response,
        request,
      })
      await writeOutbox(client, {
        access,
        eventType: 'sale.created',
        entityType: 'sale',
        entityId: sale.id,
        payload: { number, status: sale.status },
      })
      return { status: 201, body: { data: response } }
    },
  )
}

async function loadSaleForUpdate(client: PoolClient, organizationId: string, saleId: string) {
  const result = await client.query<SaleRow>(
    `SELECT * FROM sales WHERE id = $1::uuid AND organization_id = $2 FOR UPDATE`,
    [saleId, organizationId],
  )
  const sale = result.rows[0]
  if (!sale) throw new DomainError('SALE_NOT_FOUND', 'Продажа не найдена', 404)
  return sale
}

export async function postSale(
  organizationId: string,
  saleId: string,
  access: SalesAccessContext,
  idempotencyKey: string,
  request?: Request,
) {
  return executeIdempotent<{ data: SaleResult; approvalRequired?: boolean; approvalId?: string }>(
    {
      organizationId,
      actorId: access.actorId,
      operation: `sale.post:${saleId}`,
      key: idempotencyKey,
    },
    async (client) => {
      const sale = await loadSaleForUpdate(client, organizationId, saleId)
      assertScopedAccess(access, sale.region_id, sale.channel_id)
      if (!['draft', 'pending_approval'].includes(sale.status)) {
        throw new DomainError('SALE_NOT_POSTABLE', 'Продажу нельзя провести в текущем статусе', 409, {
          status: sale.status,
        })
      }
      await assertPeriodOpen(client, organizationId, sale.sold_at)

      const settings = await client.query<{ negative_margin_policy: string }>(
        `SELECT negative_margin_policy FROM organization_sales_settings WHERE organization_id = $1`,
        [organizationId],
      )
      const policy = settings.rows[0]?.negative_margin_policy ?? 'comment_required'
      const hasNegativeMargin = Number(sale.gross_profit_total) < 0

      if (hasNegativeMargin) {
        if (policy === 'blocked') {
          throw new DomainError('NEGATIVE_MARGIN_BLOCKED', 'Политика компании запрещает убыточные продажи', 422)
        }
        if (
          ['comment_required', 'approval_required'].includes(policy)
          && (!sale.negative_margin_reason || !sale.negative_margin_comment)
        ) {
          throw new DomainError(
            'NEGATIVE_MARGIN_EXPLANATION_REQUIRED',
            'Для убыточной продажи укажите причину и комментарий',
            422,
          )
        }
        if (policy === 'approval_required') {
          const approval = await client.query<{ id: string; status: string }>(
            `SELECT id, status FROM operation_approvals
             WHERE organization_id = $1 AND entity_type = 'sale' AND entity_id = $2::uuid
             ORDER BY created_at DESC LIMIT 1`,
            [organizationId, saleId],
          )
          if (approval.rows[0]?.status !== 'approved') {
            let approvalId = approval.rows[0]?.id
            if (!approvalId) {
              const created = await client.query<{ id: string }>(
                `INSERT INTO operation_approvals
                   (organization_id, entity_type, entity_id, reason_code, comment, requested_by)
                 VALUES ($1,'sale',$2::uuid,'negative_margin',$3,$4)
                 RETURNING id`,
                [organizationId, saleId, sale.negative_margin_comment, access.actorId],
              )
              approvalId = created.rows[0].id
            }
            await client.query(
              `UPDATE sales SET status = 'pending_approval', version = version + 1 WHERE id = $1::uuid`,
              [saleId],
            )
            await writeAudit(client, {
              access,
              entityType: 'sale',
              entityId: saleId,
              action: 'sale.approval_requested',
              after: { status: 'pending_approval', approvalId },
              request,
              approvalId,
            })
            await writeOutbox(client, {
              access,
              eventType: 'sale.approval_requested',
              entityType: 'sale',
              entityId: saleId,
              payload: { approvalId },
            })
            return {
              status: 202,
              body: {
                data: { ...mapSale(sale), status: 'pending_approval' as const },
                approvalRequired: true,
                approvalId,
              },
            }
          }
        }
      }

      const posted = await client.query<SaleRow>(
        `UPDATE sales
         SET status = 'posted', posted_by = $2, posted_at = now(), version = version + 1
         WHERE id = $1::uuid
         RETURNING *`,
        [saleId, access.actorId],
      )
      const entryDate = sale.sold_at.toISOString().slice(0, 10)
      const ledgerEntries = [
        { account: 'revenue', amount: sale.revenue_total, pnl: 'revenue' },
        { account: 'cost_of_goods', amount: `-${sale.cost_total}`, pnl: 'cost_of_goods' },
        ...(Number(sale.bonus_total) > 0
          ? [{ account: 'sales_bonus', amount: `-${sale.bonus_total}`, pnl: 'sales_bonus' }]
          : []),
      ]
      for (const entry of ledgerEntries) {
        await client.query(
          `INSERT INTO management_ledger_entries (
             organization_id, source_type, source_id, entry_date, account, amount,
             currency, pnl_line, region_id, channel_id, manager_id
           ) VALUES ($1,'sale',$2::uuid,$3::date,$4,$5,$6,$7,$8::uuid,$9::uuid,$10)`,
          [
            organizationId,
            saleId,
            entryDate,
            entry.account,
            entry.amount,
            sale.currency,
            entry.pnl,
            sale.region_id,
            sale.channel_id,
            access.actorId,
          ],
        )
      }
      await writeAudit(client, {
        access,
        entityType: 'sale',
        entityId: saleId,
        action: 'sale.posted',
        before: { status: sale.status },
        after: { status: 'posted' },
        request,
      })
      await writeOutbox(client, {
        access,
        eventType: 'sale.posted',
        entityType: 'sale',
        entityId: saleId,
        payload: { number: sale.number, revenue: sale.revenue_total },
      })
      await signalAnalytics(client, organizationId, 'sale.posted', 'sale', saleId)
      return { status: 200, body: { data: mapSale(posted.rows[0]) } }
    },
  )
}

export async function reverseSale(
  input: {
    organizationId: string
    saleId: string
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
      operation: `sale.reverse:${input.saleId}`,
      key: idempotencyKey,
    },
    async (client) => {
      const original = await loadSaleForUpdate(client, input.organizationId, input.saleId)
      if (original.status !== 'posted') {
        throw new DomainError('SALE_NOT_REVERSIBLE', 'Сторнировать можно только проведённую продажу', 409)
      }
      const reversedAt = input.reversedAt ?? new Date().toISOString()
      await assertPeriodOpen(client, input.organizationId, reversedAt)
      const number = await nextSaleNumber(client, reversedAt)
      const reversalResult = await client.query<SaleRow>(
        `INSERT INTO sales (
           organization_id, number, status, sold_at, manager_id, manager_name_snapshot,
           region_id, region_name_snapshot, channel_id, channel_name_snapshot, currency,
           revenue_total, cost_total, gross_profit_total, discount_total, bonus_total,
           negative_margin_reason, negative_margin_comment, source, source_ref,
           original_sale_id, created_by, posted_by, posted_at
         )
         SELECT organization_id, $2, 'posted', $3::timestamptz, manager_id, manager_name_snapshot,
           region_id, region_name_snapshot, channel_id, channel_name_snapshot, currency,
           -revenue_total, -cost_total, -gross_profit_total, 0, -bonus_total,
           'reversal', $4, 'reversal', id::text, id, $5, $5, now()
         FROM sales WHERE id = $1::uuid
         RETURNING *`,
        [input.saleId, number, reversedAt, input.reason, access.actorId],
      )
      const reversal = reversalResult.rows[0]

      await client.query(
        `INSERT INTO sale_items (
           sale_id, organization_id, product_variant_id, product_name_snapshot,
           sku_snapshot, size_snapshot, color_snapshot, quantity, unit_price,
           discount_amount, revenue_amount, unit_cost_snapshot, cost_amount,
           gross_profit_amount, bonus_rate_snapshot, bonus_amount, cost_version_id
         )
         SELECT $2::uuid, organization_id, product_variant_id, product_name_snapshot,
           sku_snapshot, size_snapshot, color_snapshot, quantity, unit_price,
           0, -revenue_amount, unit_cost_snapshot, -cost_amount,
           -gross_profit_amount, bonus_rate_snapshot, -bonus_amount, cost_version_id
         FROM sale_items WHERE sale_id = $1::uuid`,
        [input.saleId, reversal.id],
      )

      const originalEntries = await client.query<{
        id: string
        account: string
        amount: string
        currency: string
        pnl_line: string | null
        cash_flow_line: string | null
        region_id: string | null
        channel_id: string | null
        cost_center_id: string | null
        product_id: string | null
        manager_id: string | null
      }>(
        `SELECT * FROM management_ledger_entries
         WHERE source_type = 'sale' AND source_id = $1::uuid`,
        [input.saleId],
      )
      for (const entry of originalEntries.rows) {
        await client.query(
          `INSERT INTO management_ledger_entries (
             organization_id, source_type, source_id, entry_date, account, amount,
             currency, pnl_line, cash_flow_line, region_id, channel_id, cost_center_id,
             product_id, manager_id, reversal_of_id
           ) VALUES (
             $1,'sale_reversal',$2::uuid,$3::date,$4,-($5::numeric),$6,$7,$8,
             $9::uuid,$10::uuid,$11::uuid,$12::uuid,$13,$14::uuid
           )`,
          [
            input.organizationId,
            reversal.id,
            reversedAt.slice(0, 10),
            entry.account,
            entry.amount,
            entry.currency,
            entry.pnl_line,
            entry.cash_flow_line,
            entry.region_id,
            entry.channel_id,
            entry.cost_center_id,
            entry.product_id,
            entry.manager_id,
            entry.id,
          ],
        )
      }
      await client.query(
        `UPDATE sales
         SET status = 'reversed', reversed_by_sale_id = $2::uuid, version = version + 1
         WHERE id = $1::uuid`,
        [input.saleId, reversal.id],
      )
      await writeAudit(client, {
        access,
        entityType: 'sale',
        entityId: input.saleId,
        action: 'sale.reversed',
        reason: input.reason,
        before: { status: 'posted' },
        after: { status: 'reversed', reversalId: reversal.id },
        request,
      })
      await writeOutbox(client, {
        access,
        eventType: 'sale.reversed',
        entityType: 'sale',
        entityId: input.saleId,
        payload: { reversalId: reversal.id, reason: input.reason },
      })
      await signalAnalytics(client, input.organizationId, 'sale.reversed', 'sale', input.saleId)
      return { status: 201, body: { data: mapSale(reversal), originalSaleId: input.saleId } }
    },
  )
}

export async function listSales(input: {
  organizationId: string
  from?: string
  to?: string
  status?: string
  regionIds?: string[] | null
  channelIds?: string[] | null
  limit?: number
  offset?: number
}) {
  const conditions = ['organization_id = $1']
  const values: unknown[] = [input.organizationId]
  const add = (sql: string, value: unknown) => {
    values.push(value)
    conditions.push(sql.replace('?', `$${values.length}`))
  }
  if (input.from) add('sold_at >= ?::date', input.from)
  if (input.to) add(`sold_at < (?::date + INTERVAL '1 day')`, input.to)
  if (input.status) add('status = ?', input.status)
  if (input.regionIds) add('region_id = ANY(?::uuid[])', input.regionIds)
  if (input.channelIds) add('channel_id = ANY(?::uuid[])', input.channelIds)
  values.push(Math.min(input.limit ?? 50, 200), input.offset ?? 0)
  const rows = await query<SaleRow>(
    `SELECT * FROM sales
     WHERE ${conditions.join(' AND ')}
     ORDER BY sold_at DESC, created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  )
  return rows.map(mapSale)
}
