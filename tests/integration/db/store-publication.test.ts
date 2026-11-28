import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'
import { parseStoreImport } from '@/lib/store/import/parser'
import { buildStorePublishPayload } from '@/lib/store/import/publication'
import type { StoreImportPreview } from '@/lib/store/import/types'
import { publishStoreImport } from '@/lib/store/import/repository'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'

function publicationClient(db: Db): SupabaseClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'publish_store_import' && name !== 'publish_store_financial_import') throw new Error('Unexpected store RPC')
      const entries = Object.entries(args)
      const params = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ')
      const values = entries.map(([key, value]) => key === 'p_rows' ? JSON.stringify(value) : value)
      return asService(db, async () => {
        await db.query('SAVEPOINT store_publish_attempt')
        try {
          const { rows } = await db.query(`SELECT * FROM public.${name}(${params})`, values)
          await db.query('RELEASE SAVEPOINT store_publish_attempt')
          // PostgREST represents timestamptz as a string on the wire.
          return { data: rows.map((row) => ({ ...row, published_at: row.published_at.toISOString() })), error: null }
        } catch (error) {
          await db.query('ROLLBACK TO SAVEPOINT store_publish_attempt')
          throw error
        }
      })
    },
  } as unknown as SupabaseClient
}

describe.skipIf(!dbTestsEnabled)('store publication and owner guard on Postgres', () => {
  afterAll(closeTestPool)

  it('publishes a parsed price file once and withholds it from other or blocked accounts', () => inRollback(async (db) => {
    const owner = await seedUser(db, { role: 'client', status: 'approved' })
    const other = await seedUser(db, { role: 'client', status: 'approved' })
    const company = await seedCompany(db, owner)
    const bytes = Buffer.from('Артикул;Наименование;Закупочная цена;Розничная цена\nTEST-L;Куртка тестовая L;100;150\n')
    const preview = parseStoreImport(bytes, 'prices.csv')
    expect(preview.detectedKinds).toEqual(['prices'])
    const payload = buildStorePublishPayload(preview, '2026-08-12')
    const request = {
      userId: owner,
      companyId: company,
      sourceFileName: `store-import-${preview.file.sha256.slice(0, 12)}.csv`,
      sourceSizeBytes: preview.file.sizeBytes,
      sourceSha256: preview.file.sha256,
      idempotencyKey: randomUUID(),
      payload,
    }
    const first = await publishStoreImport(publicationClient(db), request)
    const repeated = await publishStoreImport(publicationClient(db), request)
    expect(first).toMatchObject({ outcome: 'published', rowCount: 1 })
    expect(repeated).toMatchObject({ outcome: 'duplicate', importRunId: first.importRunId })

    const visiblePrice = (actor: string) => asUser(db, actor, () => db.query(
      'SELECT retail_price FROM public.store_price_snapshots WHERE import_run_id = $1',
      [first.importRunId],
    ))
    expect((await visiblePrice(owner)).rows).toEqual([{ retail_price: '150.00' }])
    expect((await visiblePrice(other)).rows).toEqual([])
    await db.query("UPDATE public.profiles SET status = 'blocked' WHERE id = $1", [owner])
    expect((await visiblePrice(owner)).rows).toEqual([])
  }))

  it('stores a monthly P&L separately from operational facts and keeps its reported variance', () => inRollback(async (db) => {
    const owner = await seedUser(db, { role: 'client', status: 'approved' })
    const company = await seedCompany(db, owner)
    const report: StoreImportPreview = {
      file: { fileName: 'management.xlsx', format: 'xlsx', sizeBytes: 256, sha256: 'a'.repeat(64) },
      detectedKinds: ['management_period'],
      data: {
        prices: [], inventory: [], sales: [],
        management_period: [{
          periodStart: '2026-08-01', periodEnd: '2026-08-31', granularity: 'month',
          currency: 'KZT', revenueBasis: 'net_after_discounts_returns',
          revenue: 2000, costOfGoods: 1200, grossProfit: 800, grossMarginPct: 40,
          reportedGrossProfit: 799.5, grossProfitReconciliationDelta: -0.5,
          periodExpenses: 300, bonusExpense: 20, writeOffExpense: 10,
          ebitda: 499.5, ebitdaMarginPct: 24.975, completeness: 'complete', qualityNote: null,
          sourceSheet: 'Управленческий отчёт', sourceRange: 'A2:F2',
        }],
      },
      issues: [], quarantine: [], sheets: [],
      summary: { acceptedRows: 1, quarantinedRows: 0, skippedRows: 0 },
    }
    const published = await publishStoreImport(publicationClient(db), {
      userId: owner, companyId: company, sourceFileName: `store-import-${report.file.sha256.slice(0, 12)}.xlsx`,
      sourceSizeBytes: report.file.sizeBytes, sourceSha256: report.file.sha256,
      idempotencyKey: randomUUID(), payload: buildStorePublishPayload(report),
    })
    const { rows } = await asUser(db, owner, () => db.query(
      'SELECT gross_profit, reported_gross_profit, ebitda FROM public.store_financial_periods WHERE import_id = $1',
      [published.importRunId],
    ))
    expect(rows).toEqual([{ gross_profit: '800.00', reported_gross_profit: '799.50', ebitda: '499.50' }])
  }))
})
