import PDFDocument from 'pdfkit'
import { describe, expect, it } from 'vitest'
import { parseDocument } from '@/lib/documents/parse'
import { createEmptyJourneyState, deterministicOrchestrator } from '@/lib/journey/demo'
import { assertSafeJourneyFile, UnsafeJourneyFileError } from '@/lib/journey/file-safety'
import { enforceJourneyStatePolicy } from '@/lib/journey/policy'
import { journeyAiUpdateSchema, journeyStateSchema, journeyWidgetSchema } from '@/lib/journey/schema'

describe('journey file and source policy', () => {
  it('parses a real PDF with the installed pdf-parse v2 API', async () => {
    const pdf = await makePdf('Revenue is user-provided evidence.')
    assertSafeJourneyFile(pdf, 'pdf')

    const parsed = await parseDocument(pdf, 'evidence.pdf', 'application/pdf')

    expect(parsed.metadata.type).toBe('pdf')
    expect(parsed.metadata.pages).toBe(1)
    expect(parsed.text).toContain('Revenue is user-provided evidence.')
  })

  it('rejects binary text, active PDF content and fake DOCX before parsing', () => {
    expect(() => assertSafeJourneyFile(Buffer.from([0x41, 0, 0x42]), 'csv')).toThrow(
      UnsafeJourneyFileError,
    )
    expect(() =>
      assertSafeJourneyFile(Buffer.from('%PDF-1.7\n1 0 obj << /JavaScript true >>'), 'pdf'),
    ).toThrow(/JavaScript/)
    expect(() => assertSafeJourneyFile(Buffer.from('PK not really a zip'), 'docx')).toThrow(
      /DOCX|ZIP/,
    )
  })

  it('does not accept model-owned external links even when they use HTTPS', () => {
    const parsed = journeyAiUpdateSchema.safeParse({
      phase: 'partial',
      assistantMessage: 'Источник должен быть проверен сервером.',
      facts: [],
      goals: [],
      roadmap: [],
      suggestions: [],
      widgets: [
        {
          id: 'widget-news',
          kind: 'news_digest',
          title: 'Новости',
          priority: 20,
          collapsed: true,
          hidden: false,
          focused: false,
          position: { x: 20, y: 20 },
          data: {
            connected: true,
            statusText: 'Источник якобы подключён',
            items: [
              {
                title: 'Фишинговая новость',
                source: 'Неизвестный источник',
                url: 'https://attacker.example/phish',
                publishedAt: new Date().toISOString(),
              },
            ],
          },
        },
      ],
      widgetDecisions: [
        {
          widgetId: 'widget-news',
          kind: 'news_digest',
          action: 'create',
          reason: 'Модель пытается заявить неподтверждённый источник.',
          evidenceFactIds: [],
        },
      ],
    })
    expect(parsed.success).toBe(false)
  })

  it('downgrades client/model claims about links, connections and ungrounded metrics', () => {
    const discovered = deterministicOrchestrator(
      createEmptyJourneyState('journey-policy-test'),
      'У меня один магазин помидоров',
      'test',
    )
    const news = journeyWidgetSchema.parse({
      id: 'widget-news',
      kind: 'news_digest',
      title: 'Новости',
      priority: 10,
      collapsed: true,
      hidden: false,
      focused: false,
      position: { x: 10, y: 10 },
      data: {
        connected: true,
        statusText: 'Подключено',
        items: [
          {
            title: 'Непроверенная новость',
            source: 'Unknown',
            url: 'https://attacker.example/news',
            publishedAt: new Date().toISOString(),
          },
        ],
      },
    })
    const tampered = journeyStateSchema.parse({
      ...discovered,
      widgets: [...discovered.widgets, news].map((widget) =>
        widget.kind === 'domain_metrics'
          ? {
              ...widget,
              data: {
                ...widget.data,
                metrics: [
                  { label: 'Выручка', value: '₸99 млн', status: 'known', sourceLabel: 'Модель' },
                ],
              },
            }
          : widget,
      ),
    })

    const safe = enforceJourneyStatePolicy(tampered)
    const safeNews = safe.widgets.find((widget) => widget.kind === 'news_digest')
    const safeDomain = safe.widgets.find((widget) => widget.kind === 'domain_metrics')

    expect(safeNews?.data).toEqual({
      connected: false,
      statusText: 'Источник новостей не подключён',
      items: [],
    })
    expect(safeDomain?.data.metrics[0]).toMatchObject({ status: 'unknown' })
    expect(JSON.stringify(safe)).not.toContain('attacker.example')
    expect(JSON.stringify(safe)).not.toContain('₸99 млн')
  })

  it('downgrades ready when Point B lacks metric, target or deadline', () => {
    const discovered = deterministicOrchestrator(
      createEmptyJourneyState('journey-ready-policy'),
      'У меня один магазин помидоров',
      'test',
    )
    const confirmed = journeyStateSchema.parse({
      ...discovered,
      facts: discovered.facts.map((fact) => ({ ...fact, status: 'confirmed' })),
    })
    const planned = deterministicOrchestrator(
      confirmed,
      'Хочу открыть пять магазинов за 12 месяцев',
      'test',
    )
    const incomplete = journeyStateSchema.parse({
      ...planned,
      phase: 'ready',
      goals: planned.goals.map((goal) => ({ ...goal, deadline: undefined })),
    })
    expect(enforceJourneyStatePolicy(incomplete).phase).toBe('partial')
  })
})

function makePdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    document.on('data', (chunk: Buffer) => chunks.push(chunk))
    document.on('error', reject)
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.fontSize(12).text(text)
    document.end()
  })
}
