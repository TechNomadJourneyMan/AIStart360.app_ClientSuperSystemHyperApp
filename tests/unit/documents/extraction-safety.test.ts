/**
 * Document extraction safety (lib/documents/{pii-mask,extraction,pipeline}.ts):
 *   - personal data never reach the model; business figures still do
 *   - a quote verifies only when the WHOLE quote is in the text and the value
 *     is written next to it (no leading-words match)
 *   - model rows are kept only when a line of the document carries them,
 *     and are marked as model-extracted
 *   - row-extraction failures are reported with their code, not as «check
 *     the column names», and transient ones ask for a retry
 *   - huge CSV exports are stored capped, never failing the payload limit
 */
import { describe, expect, it } from 'vitest'
import type { LlmJsonResult } from '@/lib/ai/gateway'
import {
  extractFieldsWithLlm,
  extractRowsWithLlm,
  locateQuote,
  MAX_LLM_ROWS,
  type LlmJsonFn,
} from '@/lib/documents/extraction'
import type { ClientBaseRow, SalesRow } from '@/lib/documents/extract-rows'
import { maskStructuredText } from '@/lib/documents/pii-mask'
import { runDocumentPipeline, type PipelineInput } from '@/lib/documents/pipeline'
import { preflightDocument } from '@/lib/documents/preflight'
import { structuredFromPages } from '@/lib/documents/text'

const DOC_ID = '44444444-4444-4444-8444-444444444444'
const usage = { model: 'test/model', tier: 'standard' as const, tokensIn: 10, tokensOut: 10, costUsd: 0.001, costSource: 'estimate' as const, latencyMs: 1, attempts: 1 }

type Responder = (user: string, system: string) => unknown

function fakeLlm(responder: Responder) {
  const calls: Array<{ system: string; user: string }> = []
  const fn: LlmJsonFn = async <T,>(req: Parameters<LlmJsonFn>[0] & { schema: { safeParse(v: unknown): { success: boolean; data?: T } } }) => {
    calls.push({ system: req.system, user: req.user })
    const out = responder(req.user, req.system)
    if (out && typeof out === 'object' && '__error' in (out as object)) {
      return { ok: false, error: (out as { __error: string }).__error, message: 'x', usage: null } as LlmJsonResult<T>
    }
    const parsed = req.schema.safeParse(out)
    if (!parsed.success) return { ok: false, error: 'INVALID_OUTPUT', message: 'schema', usage } as LlmJsonResult<T>
    return { ok: true, data: parsed.data as T, usage }
  }
  return { fn: fn as LlmJsonFn, calls }
}

/** Data lines of the fenced document in a prompt (header line first). */
function fencedLines(user: string): string[] {
  const m = /<untrusted_document>\n([\s\S]*?)\n<\/untrusted_document>/.exec(user)
  return (m?.[1] ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\[/.test(l))
}

const isRows = (system: string) => system.includes('строки продаж') || system.includes('клиентскую базу')

function input(buffer: Buffer, fileName: string, over: Partial<PipelineInput> = {}): PipelineInput {
  const pf = preflightDocument(buffer, fileName)
  if (!pf.ok) throw new Error(`fixture rejected: ${pf.reason}`)
  return {
    documentId: DOC_ID, docType: 'pl_report', fileName, buffer, kind: pf.kind, mime: pf.mime,
    llm: null, aiBudgetLeft: () => true, deadlineAt: Date.now() + 60_000, ...over,
  }
}

// Headers the deterministic mapper does not know → model fallback.
const PATIENTS = [
  'Пациент;Моб. телефон;Почта;Первый визит;Последний визит;Оплачено;Визитов',
  'Иванова Анна Сергеевна;+7 701 123 45 67;anna.ivanova@mail.kz;05.03.2025;20.06.2025;150 000;3',
  'Петров Олег;8 (702) 555-12-34;oleg@petrov.kz;11.01.2025;11.01.2025;45 500;1',
].join('\n')

describe('personal data never reach the model (#7)', () => {
  it('patient base: names, phones and emails are pseudonymised, figures kept, rows restored server-side', async () => {
    const { fn, calls } = fakeLlm((user, system) => {
      if (!isRows(system)) return { summary: '', fields: [] }
      const [, ...data] = fencedLines(user)
      return {
        rows: data.map((l) => {
          const c = l.split(';')
          const [d1, m1, y1] = c[3].split('.')
          const [d2, m2, y2] = c[4].split('.')
          return {
            client_id: c[1], name: c[0],
            first_purchase_date: `${y1}-${m1}-${d1}`, last_purchase_date: `${y2}-${m2}-${d2}`,
            total_spent_kzt: Number(c[5].replace(/\s/g, '')), purchase_count: Number(c[6]),
          }
        }),
      }
    })
    const out = await runDocumentPipeline(input(Buffer.from(PATIENTS), 'patients.csv', { docType: 'patient_base', llm: fn }))

    expect(calls.length).toBeGreaterThanOrEqual(2) // fields + rows
    for (const c of calls) {
      expect(c.user).not.toMatch(/Иванова|Анна|Петров|Олег|701 123|555-12-34|mail\.kz|petrov\.kz|7011234567/)
      expect(c.system).not.toMatch(/Телефон вместо id/)
    }
    const rowsCall = calls.find((c) => isRows(c.system))!
    expect(rowsCall.user).toContain('150 000')
    expect(rowsCall.user).toContain('05.03.2025')
    expect(rowsCall.user).toMatch(/ID-[0-9a-f]{8};ID-[0-9a-f]{8};ID-[0-9a-f]{8};05\.03\.2025/)

    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    const rows = out.payload.client_rows as ClientBaseRow[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ client_id: '77011234567', name: 'Иванова Анна Сергеевна', total_spent_kzt: 150_000, purchase_count: 3 })
    expect(rows[1]).toMatchObject({ client_id: '77025551234', name: 'Петров Олег', total_spent_kzt: 45_500 })
    expect(out.payload.rows_method).toBe('llm')
  })

  it('field extraction of a prose document masks contacts and names but keeps the figures', async () => {
    const st = structuredFromPages([{ page: 1, text: 'Директор: Ахметов Серик Болатович, тел. +7 701 765 43 21, ceo@firm.kz.\nВыручка за 2025 год составила 120 млн тенге.' }], 1)
    const { fn, calls } = fakeLlm(() => ({
      summary: '',
      fields: [{ key: 'revenue', label: 'Выручка', value: 120_000_000, quote: 'Выручка за 2025 год составила 120 млн тенге', confidence: 0.9 }],
    }))
    const res = await extractFieldsWithLlm({ st, documentId: DOC_ID, docType: 'pl_report', fileName: 'report.pdf', llm: fn, deadlineAt: Date.now() + 30_000 })
    expect(calls[0].user).not.toMatch(/Ахметов|Серик|765 43 21|ceo@firm/)
    expect(calls[0].user).toContain('Выручка за 2025 год составила 120 млн тенге')
    expect(res.fields.find((f) => f.key === 'revenue')?.provenance?.quote_verified).toBe(true)
  })

  it('pseudonyms are stable within a document and segments keep their pages', () => {
    const st = structuredFromPages([
      { page: 1, text: 'Клиент;Сумма\nИванов;100\nПетров;200' },
      { page: 2, text: 'Клиент;Сумма\nИванов;300' },
    ], 2)
    const m = maskStructuredText(st, { tabular: true })
    const ids = m.st.text.match(/ID-[0-9a-f]{8}/g) ?? []
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe(ids[2])
    expect(ids[0]).not.toBe(ids[1])
    expect(m.st.text).not.toMatch(/Иванов|Петров/)
    expect(m.st.text.slice(m.st.segments[1].start, m.st.segments[1].end)).toMatch(/^\n\n\[Страница 2\]\nКлиент;Сумма\nID-/)
  })

  it('a title row above the header does not hide the identity columns', () => {
    const st = structuredFromPages([{ page: 1, text: 'Продажи за март,2025,,\nКлиент,Телефон,Сумма,Дата\nСеменов Ильяс,87017778899,"12 500",05.03.2025' }], 1)
    const text = maskStructuredText(st, { tabular: true }).st.text
    expect(text).not.toMatch(/Семенов|Ильяс|87017778899/)
    expect(text).toMatch(/ID-[0-9a-f]{8},ID-[0-9a-f]{8},12 500,05\.03\.2025/)
  })
})

describe('quote verification needs the whole quote and the value (#8)', () => {
  const text = '[Страница 3]\nВыручка компании за 2025 год составила 120 млн тенге.'

  it('a quote that only shares the leading words is not found', () => {
    expect(locateQuote(text, 'Выручка компании за 2025 год составила 950 млн тенге')).toBe(-1)
    expect(locateQuote(text, 'Выручка компании за 2025 год составила 120 млн тенге')).toBeGreaterThan(0)
    expect(locateQuote(text, 'выручка компании за 2025 год составила 120 млн тенге')).toBeGreaterThan(0)
  })

  it('normalises whitespace, quotes and digit grouping', () => {
    const t = '[Страница 1]\nЧистая прибыль:  1 800 000,5 ₸ («итог»)'
    expect(locateQuote(t, 'чистая прибыль: 1800000.5 ₸ (итог)')).toBeGreaterThan(0)
  })

  it('an invented value next to a real quote is kept apart, never verified', async () => {
    const st = structuredFromPages([{ page: 3, text: 'Выручка компании за 2025 год составила 120 млн тенге.' }], 3)
    const { fn } = fakeLlm(() => ({
      summary: '',
      fields: [
        { key: 'revenue', label: 'Выручка', value: 950_000_000, quote: 'Выручка компании за 2025 год составила 950 млн тенге', confidence: 0.95 },
        { key: 'net_revenue', label: 'Выручка (2)', value: 950_000_000, quote: 'Выручка компании за 2025 год составила 120 млн тенге', confidence: 0.95 },
        { key: 'gross_revenue', label: 'Выручка (3)', value: 120_000, quote: 'Выручка компании за 2025 год составила 120 млн тенге', confidence: 0.95 },
      ],
    }))
    const res = await extractFieldsWithLlm({ st, documentId: DOC_ID, docType: 'pl_report', fileName: 'r.pdf', llm: fn, deadlineAt: Date.now() + 30_000 })
    expect(res.fields).toEqual([])
    expect(res.unverified).toHaveLength(3)
    expect(res.unverified.every((f) => f.provenance?.quote_verified === false && f.metric_id === null)).toBe(true)
    expect(res.unverified[1].provenance?.value_verified).toBe(false)
  })

  it('the correct value in the document\'s units or scaled (тыс / млн) verifies', async () => {
    const st = structuredFromPages([{ page: 1, text: 'Выручка компании за 2025 год составила 120 млн тенге.\nСредний чек, тыс. ₸: 25' }], 1)
    const { fn } = fakeLlm(() => ({
      summary: '',
      fields: [
        { key: 'revenue', label: 'Выручка', value: 120_000_000, quote: 'составила 120 млн тенге', confidence: 0.9 },
        { key: 'avg_check', label: 'Средний чек', value: 25_000, quote: 'Средний чек, тыс. ₸: 25', confidence: 0.9 },
      ],
    }))
    const res = await extractFieldsWithLlm({ st, documentId: DOC_ID, docType: 'pl_report', fileName: 'r.pdf', llm: fn, deadlineAt: Date.now() + 30_000 })
    expect(res.fields.map((f) => f.key).sort()).toEqual(['avg_check', 'revenue'])
    expect(res.unverified).toEqual([])
  })
})

const SALES = [
  'Покупатель;Чек;Когда;Товар',
  'Иванов;15 000;05.03.2025;Кофе',
  'Петров;22 000;06.03.2025;Чай',
].join('\n')

function salesResponder(extra: Array<Record<string, unknown>> = []) {
  return (user: string, system: string) => {
    if (!isRows(system)) return { summary: '', fields: [] }
    const [, ...data] = fencedLines(user)
    return {
      rows: [
        ...data.map((l) => {
          const c = l.split(';')
          const [d, m, y] = c[2].split('.')
          return { client_id: c[0], amount: Number(c[1].replace(/\s/g, '')), occurred_at: `${y}-${m}-${d}`, product_name: c[3] }
        }),
        ...extra,
      ],
    }
  }
}

describe('model rows are checked against the document (#28)', () => {
  it('rows not on any line of the document are quarantined; kept rows are marked as model rows', async () => {
    const invented = [
      { client_id: 'ID-deadbeef', amount: 999_999, occurred_at: '2025-03-07' },
      { client_id: '[телефон]', amount: 15_000, occurred_at: '2025-03-05' },
    ]
    const { fn } = fakeLlm(salesResponder(invented))
    const out = await runDocumentPipeline(input(Buffer.from(SALES), 'sales.csv', { docType: 'sales_report', llm: fn }))
    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    const rows = out.payload.raw_rows as SalesRow[]
    expect(rows.map((r) => [r.client_id, r.amount])).toEqual([['Иванов', 15_000], ['Петров', 22_000]])
    expect(out.payload.rows_method).toBe('llm')
    expect(out.payload.unverified_rows).toHaveLength(2)
    expect(out.payload.stats).toMatchObject({ unverified_row_count: 2, row_count: 2 })
    expect(out.payload.warnings?.join(' ')).toMatch(/2 строк, предложенных ИИ, не найдены в документе/)
  })

  it('a wrong amount or date for a real client is not accepted', async () => {
    const { fn } = fakeLlm((user, system) => (isRows(system)
      ? { rows: [
        { client_id: fencedLines(user)[1].split(';')[0], amount: 150_000, occurred_at: '2025-03-05' },
        { client_id: fencedLines(user)[2].split(';')[0], amount: 22_000, occurred_at: '2025-04-06' },
      ] }
      : { summary: '', fields: [] }))
    const st = structuredFromPages([{ page: 1, text: SALES }], 1)
    const res = await extractRowsWithLlm({ st, mode: 'sales', llm: fn, deadlineAt: Date.now() + 30_000, tabular: true })
    expect(res.rows).toEqual([])
    expect(res.unverified).toHaveLength(2)
  })
})

describe('row-extraction failures are reported honestly (#29)', () => {
  it('a model failure keeps its code, is not blamed on the column names and marks coverage partial', async () => {
    const { fn } = fakeLlm((_u, system) => (isRows(system) ? { __error: 'INVALID_OUTPUT' } : { summary: '', fields: [] }))
    const out = await runDocumentPipeline(input(Buffer.from(SALES), 'sales.csv', { docType: 'sales_report', llm: fn }))
    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    const warnings = out.payload.warnings?.join(' ') ?? ''
    expect(warnings).toMatch(/ИИ не смог распознать строки продаж \(INVALID_OUTPUT\)/)
    expect(warnings).not.toMatch(/проверьте названия колонок/)
    expect(out.payload.coverage).toMatchObject({ partial: true, rows_llm_error: 'INVALID_OUTPUT' })
    expect(out.payload.empty_reason).toMatchObject({ code: 'ROWS_LLM_FAILED' })
  })

  it('a transient row failure with nothing else found asks for a retry', async () => {
    const { fn } = fakeLlm((_u, system) => (isRows(system) ? { __error: 'TIMEOUT' } : { summary: '', fields: [] }))
    const out = await runDocumentPipeline(input(Buffer.from(SALES), 'sales.csv', { docType: 'sales_report', llm: fn }))
    expect(out).toMatchObject({ status: 'retry', code: 'LLM_UNAVAILABLE' })
  })

  it('tables are sent in slices that fit the output cap; too many rows are refused with a reason', async () => {
    const lines = ['Покупатель;Чек;Когда;Товар']
    for (let i = 0; i < 100; i++) lines.push(`Клиент${i};${1000 + i};05.03.2025;Кофе`)
    const { fn, calls } = fakeLlm(salesResponder())
    const st = structuredFromPages([{ page: 1, text: lines.join('\n') }], 1)
    const res = await extractRowsWithLlm({ st, mode: 'sales', llm: fn, deadlineAt: Date.now() + 30_000, tabular: true })
    expect(res.error).toBeNull()
    expect(calls).toHaveLength(3)
    expect(calls.every((c) => fencedLines(c.user)[0] === 'Покупатель;Чек;Когда;Товар')).toBe(true)
    expect(res.rows).toHaveLength(100)

    for (let i = 100; i < MAX_LLM_ROWS + 1; i++) lines.push(`Клиент${i};${1000 + i};05.03.2025;Кофе`)
    const big = await extractRowsWithLlm({ st: structuredFromPages([{ page: 1, text: lines.join('\n') }], 1), mode: 'sales', llm: fn, deadlineAt: Date.now() + 30_000, tabular: true })
    expect(big).toMatchObject({ rows: [], error: 'TOO_MANY_ROWS' })
  })
})

describe('huge CSV exports are stored capped (#31)', () => {
  it('a 90k-row sales CSV is parsed with a payload under the 8 MB limit and the cut recorded', async () => {
    const lines = ['client_id,amount,date']
    for (let i = 0; i < 90_000; i++) lines.push(`c${i % 5000},${1000 + (i % 977)},2025-0${1 + (i % 9)}-1${i % 10}`)
    const out = await runDocumentPipeline(input(Buffer.from(lines.join('\n')), 'export.csv', { docType: 'sales_report' }))
    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    expect(JSON.stringify(out.payload).length).toBeLessThan(8_000_000)
    expect(out.payload.coverage).toMatchObject({ rows_total: 90_000, rows_truncated: true, partial: true })
    expect(out.rowCount).toBeLessThan(90_000)
    expect(out.payload.warnings?.join(' ')).toMatch(/Сохранено строк: \d+ из 90000/)
    expect(out.payload.rows_method).toBe('deterministic')
  }, 60_000)
})
