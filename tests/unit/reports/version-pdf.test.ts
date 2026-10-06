/**
 * PDF of a report version (lib/reports/version-pdf.ts): rendered from the
 * frozen content only — no database or Supabase access — with provenance
 * badges, confidence, sources and the generation date, and no figure that the
 * content does not hold.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PointAReportContent } from '@/lib/reports/types'

const touched: string[] = []
const forbid = (name: string) => new Proxy({}, { get: (_t, p) => { touched.push(`${name}.${String(p)}`); throw new Error(`${name} must not be used by the renderer`) } })
vi.mock('@/lib/db', () => ({ prisma: forbid('prisma') }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => forbid('service'), requireServiceRoleKey: () => { throw new Error('no') } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => forbid('session') }))

const { buildPointAReportContent } = await import('@/lib/reports/snapshot')
const { renderReportVersionPdf } = await import('@/lib/reports/version-pdf')
const { HIDDEN_HYPOTHESIS_TITLE, HIDDEN_RECOMMENDATION_TITLE, inputs } = await import('./fixtures')

async function pdfText(pdf: Buffer): Promise<{ text: string; pages: number }> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: pdf })
  try {
    const r = await parser.getText()
    return { text: r.text.replace(/\s+/g, ' '), pages: r.total }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

/** Every digit run of every value in the content, as numbers (plus derived forms the renderer prints). */
function allowedNumbers(content: unknown): Set<number> {
  const out = new Set<number>()
  const runs = (s: string) => { for (const m of s.matchAll(/\d+/g)) out.add(Number(m[0])) }
  const walk = (v: unknown) => {
    if (typeof v === 'number') {
      runs(String(v))
      runs(v.toLocaleString('ru-RU'))
      out.add(Math.round(v))
      out.add(Math.round(v * 100)) // confidence / completeness as %
    } else if (typeof v === 'string') {
      runs(v)
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) runs(new Date(v).toLocaleDateString('ru-RU'))
    } else if (Array.isArray(v)) {
      v.forEach(walk)
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk)
    }
  }
  walk(content)
  // Fixed template text: «/100», «/10» scales and the «AIStart360» footer.
  for (const n of [100, 10, 360]) out.add(n)
  return out
}

describe('renderReportVersionPdf', () => {
  let content: PointAReportContent
  let pdf: Buffer
  let text: string
  let pages: number

  beforeAll(async () => {
    content = buildPointAReportContent(inputs()).content
    content.narrative = {
      summary: 'Индекс Точки А 47 из 100: слабее всего продажи (28/100), полнота данных 62%.',
      key_points: ['Внедрить CRM в течение 90 дней'],
      provenance_type: 'AI_HYPOTHESIS',
      model: 'anthropic/claude-opus-4.8',
      prompt_version: 'report-narrative@1',
      generated_at: content.generated_at,
    }
    pdf = await renderReportVersionPdf(content)
    ;({ text, pages } = await pdfText(pdf))
  })

  afterAll(() => vi.restoreAllMocks())

  it('returns a PDF document', () => {
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(5_000)
  })

  it('never touches the database or Supabase', () => {
    expect(touched).toEqual([])
  })

  it('shows provenance badges, confidence and producer for findings and recommendations', () => {
    for (const label of ['РАСЧЁТ', 'ГИПОТЕЗА ИИ', 'РЕКОМЕНДАЦИЯ']) expect(text).toContain(label)
    expect(text).toContain('УВЕРЕННОСТЬ 70%') // the reviewed hypothesis
    expect(text).toContain('УВЕРЕННОСТЬ 65%') // the reviewed model recommendation
    expect(text).toContain('Продажи зависят от одного канала привлечения')
    expect(text).toContain('Запустить второй канал привлечения')
    expect(text).toContain('Источник: гипотезы ИИ, проверенные сотрудником')
    expect(text).toContain('Основания: метрика biz.finansy.vyruchka_god')
  })

  it('marks the model narrative as an AI hypothesis with model and prompt version', () => {
    expect(text).toContain('Резюме')
    expect(text).toContain('Модель: anthropic/claude-opus-4.8')
    expect(text).toContain('report-narrative@1')
  })

  it('lists the data sources and the generation and calculation dates', () => {
    expect(text).toContain('Источники данных')
    expect(text).toContain('Анкета заполнено шагов: 9 из 12')
    expect(text).toContain('Метрики со значением: 24 из 148')
    expect(text).toContain(`Отчёт сформирован ${new Date(content.generated_at).toLocaleDateString('ru-RU')}`)
    expect(text).toContain(`Дата расчёта ${new Date(content.calculated_at!).toLocaleDateString('ru-RU')}`)
    expect(text).toContain('Как читать пометки')
  })

  it('contains no data that is not in the content', () => {
    expect(text).not.toContain(HIDDEN_HYPOTHESIS_TITLE)
    expect(text).not.toContain(HIDDEN_RECOMMENDATION_TITLE)
    const allowed = allowedNumbers(content)
    const stray = [...text.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => !allowed.has(n))
    expect(stray).toEqual([])
  })

  it('every page carries the footer and there are no blank trailing pages', () => {
    const footers = text.split('© AIStart360 · Конфиденциально').length - 1
    expect(footers).toBe(pages)
    expect(pages).toBeLessThan(8)
  })

  it('renders an empty report honestly', async () => {
    const base = buildPointAReportContent(inputs({ findings: [], recommendations: [] })).content
    const empty: PointAReportContent = { ...base, findings: [], data: { ...base.data, gaps: [] } }
    const t = (await pdfText(await renderReportVersionPdf(empty))).text
    expect(t).toContain('Выводов для показа нет.')
    expect(t).toContain('Рекомендаций для показа нет.')
  })
})
