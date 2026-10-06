/**
 * CSV / XLSX exports of marketplaces and МойСклад through the documents
 * pipeline (lib/documents/marketplace-export.ts, synonyms, doc-types):
 * realistic header rows (Kaspi orders, WB «Отчёт о реализации», Ozon «Отчёт
 * о реализации», МойСклад «Прибыльность» / «Остатки»), invented rows without
 * customer data. The aggregates bind to the existing metrics (SKU, returns
 * share, online average check) without a model call.
 */
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { runDocumentPipeline } from '@/lib/documents/pipeline'
import { detectExportHeader, marketplaceExportFields } from '@/lib/documents/marketplace-export'
import { matchMarketplaceColumn } from '@/lib/documents/synonyms'
import { structuredFromPages } from '@/lib/documents/text'
import { resolveMetric } from '@/lib/metrics/resolver'
import { FIELD_SYSTEM_PROMPT, type LlmJsonFn } from '@/lib/documents/extraction'
import type { LlmJsonResult } from '@/lib/ai/gateway'
import type { ParsedDataField } from '@/lib/documents/extract'
import type { ResolverContext } from '@/lib/metrics/types'

const usage = { model: 'test/model', tier: 'standard' as const, tokensIn: 1, tokensOut: 1, costUsd: 0, costSource: 'estimate' as const, latencyMs: 1, attempts: 1 }

/**
 * A model that finds nothing and counts its field-extraction calls (did the
 * pipeline ask it to read the document? — binding calls are not counted).
 */
function countingLlm(): { llm: LlmJsonFn; calls: () => number } {
  let n = 0
  const fn = async <T,>(req: { system: string; schema: { safeParse(v: unknown): { success: boolean; data?: T } } }) => {
    if (req.system === FIELD_SYSTEM_PROMPT) n += 1
    const parsed = req.schema.safeParse({ summary: 'Нет показателей.', fields: [] })
    return parsed.success
      ? ({ ok: true, data: parsed.data as T, usage } as LlmJsonResult<T>)
      : ({ ok: false, error: 'INVALID_OUTPUT', message: 'schema', usage } as LlmJsonResult<T>)
  }
  return { llm: fn as unknown as LlmJsonFn, calls: () => n }
}

async function parse(content: string | Buffer, docType: string, kind: 'csv' | 'xlsx' = 'csv', llm: LlmJsonFn | null = null) {
  const out = await runDocumentPipeline({
    documentId: '00000000-0000-4000-8000-000000000001',
    docType,
    fileName: kind === 'csv' ? 'export.csv' : 'export.xlsx',
    buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    kind,
    mime: kind === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    llm,
    aiBudgetLeft: () => llm !== null,
    deadlineAt: Date.now() + 30_000,
  })
  expect(out.status).toBe('parsed')
  if (out.status !== 'parsed') throw new Error('not parsed')
  return out.payload
}

const field = (fields: ParsedDataField[], key: string) => fields.find((f) => f.key === key)

function ctxWith(docType: string, fields: ParsedDataField[]): ResolverContext {
  return {
    companyId: 'co', userId: 'u', surveyAnswers: {}, now: new Date('2026-10-06T10:00:00Z'),
    documents: [{ id: 'd1', docType, parsedData: { fields }, periodYear: null, periodQuarter: null, uploadedAt: '2026-10-05T00:00:00Z' }],
  }
}

describe('marketplace export columns', () => {
  it('maps official header wording to canonical columns', () => {
    expect(matchMarketplaceColumn('Тип документа')).toBe('doc_type')
    expect(matchMarketplaceColumn('Вознаграждение с продаж до вычета услуг поверенного, без НДС')).toBe('commission')
    expect(matchMarketplaceColumn('К перечислению продавцу за реализованный товар')).toBe('payout')
    expect(matchMarketplaceColumn('Wildberries реализовал Товар (Пр)')).toBe('amount')
    expect(matchMarketplaceColumn('Количество возврата')).toBe('returned_quantity')
    expect(matchMarketplaceColumn('Общая сумма заказа')).toBe('amount')
    expect(matchMarketplaceColumn('Проданное количество')).toBe('quantity')
    expect(matchMarketplaceColumn('Код города')).toBeNull()
  })

  it('an exact header beats a contained one («Количество» vs «Количество доставок»)', () => {
    const h = detectExportHeader(['Артикул продавца;Количество доставок;Количество;Тип документа'])!
    expect(h.columns.quantity).toBe(2)
  })
})

describe('marketplace exports through the documents pipeline', () => {
  it('Wildberries «Отчёт о реализации»: sales, returns, commission, payout, SKU, returns share', async () => {
    const csv = [
      '№;Предмет;Артикул WB;Артикул продавца;Тип документа;Обоснование для оплаты;Дата продажи;Количество;Цена розничная;Wildberries реализовал Товар (Пр);Вознаграждение с продаж до вычета услуг поверенного, без НДС;К перечислению продавцу за реализованный товар;Количество возврата;Количество доставок',
      '1;Сумки;111;BAG-01;Продажа;Продажа;2026-09-29;1;2500;2100;210,5;1800;0;1',
      '2;Сумки;111;BAG-01;Продажа;Продажа;2026-09-30;1;2500;2100;210,5;1800;0;1',
      '3;Ремни;222;BELT-02;Продажа;Продажа;2026-10-01;2;1200;2000;200;1700;0;1',
      '4;Ремни;222;BELT-02;Возврат;Возврат;2026-10-02;1;1200;1000;-100;-850;0;0',
      '5;Ремни;222;BELT-02;;Логистика;2026-10-02;0;0;0;0;-150;0;1',
      'Итого;;;;;;;;;;;;;',
    ].join('\n')
    const p = await parse(csv, 'marketplace_report')
    expect(field(p.fields, 'marketplace_revenue')?.value).toBe(6200)
    expect(field(p.fields, 'marketplace_commission')?.value).toBe(521)
    expect(field(p.fields, 'marketplace_payout')?.value).toBe(4300)
    expect(field(p.fields, 'returns_count')?.value).toBe(1)
    expect(field(p.fields, 'defect_rate')).toMatchObject({ value: 25, unit: '%' }) // 1 return / 4 units sold
    expect(field(p.fields, 'buyout_rate')?.value).toBe(80)
    expect(field(p.fields, 'sku_count')?.value).toBe(2)
    expect(field(p.fields, 'marketplace_revenue')?.period).toBe('2026-09-29 — 2026-10-02')
    expect(p.stats).toMatchObject({ llm_skipped: 'export_aggregated_deterministically' })
    // Feeds «Брак / возвраты» and «Кол-во SKU» (marketplace_report is in the ops / inventory families).
    const c = ctxWith('marketplace_report', p.fields)
    expect(resolveMetric('biz.operatsii.brak_vozvraty', c).numeric).toBe(25)
    expect(resolveMetric('biz.operatsii.kol_vo_sku', c).numeric).toBe(2)
  })

  it('Kaspi orders export (XLSX): orders, completed revenue, returns, average check', async () => {
    const rows = [
      ['Номер заказа', 'Дата создания заказа', 'Статус заказа', 'Артикул', 'Общая сумма заказа', 'Способ доставки'],
      ['100001', '01.10.2026', 'Выдан', 'SKU-A', 96045, 'Kaspi Доставка'],
      ['100002', '01.10.2026', 'Выдан', 'SKU-B', 23955, 'Самовывоз'],
      ['100003', '02.10.2026', 'Отменён', 'SKU-A', 5000, 'Самовывоз'],
      ['100004', '03.10.2026', 'Возвращён', 'SKU-C', 12000, 'Kaspi Доставка'],
      ['100005', '03.10.2026', 'Принят', 'SKU-B', 20000, 'Kaspi Доставка'],
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Заказы')
    const p = await parse(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'marketplace_report', 'xlsx')
    expect(field(p.fields, 'orders_count')?.value).toBe(3) // cancelled and returned excluded
    expect(field(p.fields, 'marketplace_revenue')?.value).toBe(120000) // completed only
    expect(field(p.fields, 'returns_count')?.value).toBe(1)
    expect(field(p.fields, 'avg_order_value')?.value).toBe(40000)
    expect(resolveMetric('biz.prodazhi.ecommerce_sredniy_chek', ctxWith('marketplace_report', p.fields)).numeric).toBe(40000)
  })

  it('Ozon «Отчёт о реализации» (product rows): sold / returned quantities, commission, payout', async () => {
    const csv = [
      'Артикул;SKU;Наименование товара;Реализовано: Кол-во;Реализовано: На сумму;Возвращено клиенту: Кол-во;Возвращено клиенту: На сумму;Комиссия;Итого к начислению',
      'OZ-1;9001;Кружка;10;15000;1;1500;-2250;11250',
      'OZ-2;9002;Термос;5;20000;0;0;-3000;17000',
    ].join('\n')
    const p = await parse(csv, 'marketplace_report')
    expect(field(p.fields, 'marketplace_revenue')?.value).toBe(35000)
    expect(field(p.fields, 'returns_count')?.value).toBe(1)
    expect(field(p.fields, 'marketplace_commission')?.value).toBe(-5250)
    expect(field(p.fields, 'marketplace_payout')?.value).toBe(28250)
    expect(field(p.fields, 'defect_rate')?.value).toBe(6.67)
    expect(field(p.fields, 'sku_count')?.value).toBe(2)
  })

  it('МойСклад «Остатки»: SKU and SKU in stock; «Прибыльность»: sold / returned', async () => {
    const stock = ['Наименование,Код,Артикул,Остаток,Резерв,Доступно', 'Сумка,00001,BAG-01,12,0,12', 'Ремень,00002,BELT-02,0,0,0', 'Кошелёк,00003,WAL-03,4,1,3'].join('\n')
    const s = await parse(stock, 'inventory_csv')
    expect(field(s.fields, 'sku_count')?.value).toBe(3)
    expect(field(s.fields, 'sku_in_stock')?.value).toBe(2)
    expect(resolveMetric('biz.operatsii.kol_vo_sku', ctxWith('inventory_csv', s.fields)).numeric).toBe(3)

    const profit = ['Наименование;Артикул;Проданное количество;Сумма продаж;Возвращенное количество;Сумма возвратов;Прибыль', 'Сумка;BAG-01;20;50000;2;5000;20000', 'Ремень;BELT-02;30;36000;1;1200;12000'].join('\n')
    const pr = await parse(profit, 'marketplace_report')
    expect(field(pr.fields, 'marketplace_revenue')?.value).toBe(86000)
    expect(field(pr.fields, 'returns_count')?.value).toBe(3)
    expect(field(pr.fields, 'defect_rate')?.value).toBe(6)
  })

  it('an unclassified upload is aggregated only with a marketplace-specific column', async () => {
    const generic = ['Дата,Сумма,Количество', '2026-10-01,1000,1', '2026-10-02,2000,2'].join('\n')
    expect((await parse(generic, 'other')).fields.find((f) => f.key === 'orders_count')).toBeUndefined()
    const wb = ['Тип документа,Количество,Сумма продаж,Комиссия', 'Продажа,1,1000,-100', 'Возврат,1,1000,100'].join('\n')
    expect(field((await parse(wb, 'other')).fields, 'returns_count')?.value).toBe(1)
  })

  it('a bank statement or a price list uploaded as `other` is no export: no orders / returns / SKU facts, the model reads it', async () => {
    const bank = ['Дата;Операция;Сумма;Остаток', '01.09.2026;Поступление от ТОО Альфа;1500000;2500000', '02.09.2026;Оплата аренды;-400000;2100000', '03.09.2026;Возврат средств покупателю;-50000;2050000', '04.09.2026;Поступление от ТОО Бета;900000;2950000'].join('\n')
    const prices = ['Код;Наименование;Цена;Остаток', 'A1;Чай;1200;10', 'A2;Кофе;3000;0', 'A3;Сахар;500;7'].join('\n')
    for (const csv of [bank, prices]) {
      expect(marketplaceExportFields(structuredFromPages([{ page: 1, text: csv }], 1), 'd', { requireSignature: true })).toEqual([])
      const m = countingLlm()
      const p = await parse(csv, 'other', 'csv', m.llm)
      for (const key of ['orders_count', 'returns_count', 'sku_count', 'sku_in_stock']) expect(field(p.fields, key), key).toBeUndefined()
      expect(p.stats?.llm_skipped).not.toBe('export_aggregated_deterministically')
      expect(m.calls()).toBeGreaterThan(0)
    }
  })

  it('a real export uploaded as `other` keeps its aggregates but the model still runs', async () => {
    const wb = ['Тип документа;Количество;Сумма продаж;Комиссия', 'Продажа;1;1000;-100', 'Продажа;2;2000;-200', 'Возврат;1;1000;100'].join('\n')
    const m = countingLlm()
    const p = await parse(wb, 'other', 'csv', m.llm)
    expect(field(p.fields, 'returns_count')?.value).toBe(1)
    expect(field(p.fields, 'marketplace_commission')?.value).toBe(-200)
    expect(p.stats?.llm_skipped).not.toBe('export_aggregated_deterministically')
    expect(m.calls()).toBeGreaterThan(0)
  })

  it('no sale row → no orders_count (returns / fees only are not «0 orders»)', async () => {
    const csv = ['Тип документа;Обоснование для оплаты;Количество;Сумма продаж;Комиссия', 'Возврат;Возврат;1;1000;100', 'Логистика;Логистика;0;0;-150', 'Штраф;Штраф;0;0;-300'].join('\n')
    const p = await parse(csv, 'marketplace_report')
    expect(field(p.fields, 'orders_count')).toBeUndefined()
    expect(field(p.fields, 'returns_count')?.value).toBe(1)
  })

  it('a KPI sheet with «…заказов» rows is not «covered» by marketplace synonyms: the model reads it, no orders_count', async () => {
    const csv = [
      'Показатель;Значение', 'Выручка;1000000', 'Количество повторных заказов;300', 'Доля повторных заказов, %;25',
      'Количество новых заказов;900', 'Частота заказов;1.4', 'Средняя сумма заказов;15000',
    ].join('\n')
    const m = countingLlm()
    const p = await parse(csv, 'other', 'csv', m.llm)
    expect(p.stats?.llm_skipped).not.toBe('table_covered_deterministically')
    expect(m.calls()).toBeGreaterThan(0)
    expect(field(p.fields, 'revenue')?.value).toBe(1000000)
    expect(field(p.fields, 'orders_count')).toBeUndefined()
  })
})
