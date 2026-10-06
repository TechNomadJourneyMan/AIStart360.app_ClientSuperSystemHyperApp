/**
 * lib/reports/version-pdf.ts — PDF of one report version, rendered ONLY from
 * report_versions.content (the frozen snapshot). Nothing here reads a table:
 * what the PDF shows is exactly what the version froze, whenever it is
 * downloaded.
 *
 * The PDF is rendered on demand by the API route instead of being stored
 * (report_versions.pdf_storage_path stays NULL): the content is immutable and
 * rendering takes well under a second, so a stored copy would only add a
 * second source of truth, storage permissions and a cleanup job. If a stored
 * copy is ever needed (e.g. e-mail attachments), render this function's
 * output once and record the path.
 *
 * Every finding and recommendation shows its provenance badge (Факт / Расчёт /
 * Вывод по правилам / Гипотеза ИИ / Рекомендация), confidence and producer;
 * the end of the document lists the data sources and the generation date.
 * Visual language: lib/reports/pdf.ts (A4, IBM Plex, brand-green rules).
 */
import { pdfLayout as L } from './pdf'
import { REPORT_FONTS } from './fonts'
import {
  PROVENANCE_LABELS,
  SEVERITY_LABELS,
  producerLabel,
  type ReportContent,
  type ReportEvidence,
  type ReportFinding,
  type ReportProvenanceType,
  type ReportRecommendation,
} from './types'

type Doc = ReturnType<typeof L.newDoc>

const PROVENANCE_COLOR: Record<ReportProvenanceType, string> = {
  FACT: '#0E9E6E',
  CALCULATED: '#2563EB',
  INFERRED: '#0891B2',
  AI_HYPOTHESIS: '#9333EA',
  RECOMMENDATION: '#CA8A04',
}

const EFFORT_LABELS: Record<string, string> = { low: 'небольшие усилия', medium: 'средние усилия', high: 'большие усилия' }
const EVIDENCE_TYPES: Record<string, string> = {
  survey: 'анкета', document: 'документ', metric: 'метрика', diagnostic: 'расчёт Точки А',
  benchmark: 'ориентир отрасли', finding: 'вывод диагностики', platform: 'данные платформы',
}

function pct(v: number): string {
  return `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
}

function fmtValue(v: string | number | null): string | null {
  if (v === null) return null
  if (typeof v === 'number') return v.toLocaleString('ru-RU')
  return v
}

/** A row of coloured chips (provenance, confidence, severity). */
function chips(doc: Doc, items: Array<{ text: string; color: string; filled?: boolean }>): void {
  L.ensureSpace(doc, 22)
  const y = doc.y
  let x = L.MARGIN
  doc.font(REPORT_FONTS.mono).fontSize(7.5)
  for (const item of items) {
    const text = item.text.toUpperCase()
    const w = doc.widthOfString(text, { characterSpacing: 0.6 }) + 10
    if (x + w > L.MARGIN + L.CONTENT_W) break
    doc.save()
    if (item.filled) doc.roundedRect(x, y, w, 13, 3).fill(item.color)
    else doc.roundedRect(x, y, w, 13, 3).lineWidth(0.8).strokeColor(item.color).stroke()
    doc.restore()
    doc
      .font(REPORT_FONTS.mono)
      .fontSize(7.5)
      .fillColor(item.filled ? '#FFFFFF' : item.color)
      .text(text, x + 5, y + 3, { characterSpacing: 0.6, lineBreak: false })
    x += w + 5
  }
  doc.x = L.MARGIN
  doc.y = y + 18
}

function provenanceChips(type: ReportProvenanceType, confidence: number, extra: Array<{ text: string; color: string }> = []) {
  return [
    { text: PROVENANCE_LABELS[type] ?? type, color: PROVENANCE_COLOR[type] ?? L.colors.MUTED, filled: true },
    { text: `уверенность ${pct(confidence)}`, color: L.colors.MUTED },
    ...extra,
  ]
}

function evidenceLine(e: ReportEvidence): string {
  const kind = EVIDENCE_TYPES[e.type] ?? e.type
  const value = fmtValue(e.value)
  if (e.type === 'metric') return `${kind} ${e.ref}${value !== null ? ` = ${value}` : ''}`
  if (e.quote) return `${kind}: ${e.quote}`
  return value !== null ? `${kind}: ${value}` : kind
}

function drawFinding(doc: Doc, f: ReportFinding): void {
  L.ensureSpace(doc, 70)
  chips(doc, provenanceChips(f.provenance_type, f.confidence, [
    { text: SEVERITY_LABELS[f.severity] ?? f.severity, color: L.severityColor(f.severity) },
    { text: f.area_label, color: L.colors.FAINT },
  ]))
  L.subHeader(doc, f.title, f.severity === 'critical' ? L.colors.CRIT : L.colors.INK)
  if (f.body) L.paragraph(doc, f.body, { size: 10, color: L.colors.TEXT, gap: 0.2 })
  const meta = [`Источник: ${producerLabel(f.source)}`]
  if (f.provenance_type === 'AI_HYPOTHESIS') meta.push('предположение модели, проверено сотрудником до публикации')
  L.paragraph(doc, meta.join(' · '), { size: 8.5, color: L.colors.MUTED, gap: 0.1 })
  if (f.evidence.length) {
    const shown = f.evidence.slice(0, 3).map(evidenceLine).join('; ')
    const more = f.evidence.length > 3 ? ` и ещё ${f.evidence.length - 3}` : ''
    L.paragraph(doc, `Основания: ${shown}${more}`, { size: 8.5, color: L.colors.MUTED, gap: 0.6 })
  } else {
    doc.moveDown(0.4)
  }
}

function drawRecommendation(doc: Doc, r: ReportRecommendation, findingTitles: Map<string, string>): void {
  L.ensureSpace(doc, 70)
  const extra: Array<{ text: string; color: string }> = [{ text: `приоритет ${r.priority}`, color: r.priority <= 2 ? L.colors.CRIT : L.colors.MUTED }]
  if (r.horizon_days) extra.push({ text: `срок ${r.horizon_days} дней`, color: L.colors.MUTED })
  extra.push({ text: r.area_label, color: L.colors.FAINT })
  chips(doc, provenanceChips(r.provenance_type, r.confidence, extra))
  L.subHeader(doc, r.title)
  if (r.body) L.paragraph(doc, r.body, { size: 10, gap: 0.2 })
  if (r.expected_impact) L.paragraph(doc, `Ожидаемый эффект: ${r.expected_impact}`, { size: 9.5, color: L.colors.POSITIVE, gap: 0.2 })
  const meta = [`Источник: ${producerLabel(r.source)}`]
  if (r.effort) meta.push(EFFORT_LABELS[r.effort] ?? r.effort)
  const addresses = r.finding_ids.map((id) => findingTitles.get(id)).filter((t): t is string => Boolean(t))
  if (addresses.length) meta.push(`закрывает: ${addresses.slice(0, 2).join('; ')}`)
  L.paragraph(doc, meta.join(' · '), { size: 8.5, color: L.colors.MUTED, gap: 0.6 })
}

const LEGEND: Array<[ReportProvenanceType, string]> = [
  ['FACT', 'значение из источника без вычислений: ответ анкеты, поле документа, данные CRM'],
  ['CALCULATED', 'детерминированный расчёт по формуле или правилу методики'],
  ['INFERRED', 'вывод по правилу из нескольких фактов, без участия ИИ'],
  ['AI_HYPOTHESIS', 'предположение языковой модели; в отчёт попадает только после проверки сотрудником'],
  ['RECOMMENDATION', 'предлагаемое действие на основе выводов диагностики'],
]

export async function renderReportVersionPdf(content: ReportContent): Promise<Buffer> {
  const company = content.company.name?.trim() || 'Компания'
  const doc = L.newDoc(content.title)
  const d = content.diagnostic

  L.drawCover(doc, {
    tag: 'Точка А · Отчёт диагностики',
    title: 'Точка А — диагностика бизнеса',
    meta: { companyName: company, generatedAt: content.generated_at, industry: content.company.industry },
    headline: d.overall_score !== null ? { label: 'Индекс Точки А', value: `${Math.round(d.overall_score)}/100` } : null,
  })

  // ── Сводка ──────────────────────────────────────────────────────────────
  L.sectionHeader(doc, 'Сводные показатели')
  if (d.overall_score !== null) L.kvRow(doc, 'Индекс Точки А', `${Math.round(d.overall_score)}/100`, L.scoreColor(d.overall_score))
  if (d.health_index !== null) L.kvRow(doc, 'Индекс здоровья бизнеса', `${Math.round(d.health_index)}/100`, L.scoreColor(d.health_index))
  if (d.maturity) L.kvRow(doc, 'Стадия зрелости', d.maturity.label)
  if (d.gri_index !== null) L.kvRow(doc, 'Индекс GRI', `${d.gri_index}/10`)
  if (content.data.completeness !== null) L.kvRow(doc, 'Полнота данных', pct(content.data.completeness))
  L.kvRow(doc, 'Дата расчёта', content.calculated_at ? L.fmtDate(content.calculated_at) : 'нет данных')

  // ── Резюме модели (опционально) ───────────────────────────────────────────
  if (content.narrative) {
    L.sectionHeader(doc, 'Резюме')
    chips(doc, [
      { text: PROVENANCE_LABELS.AI_HYPOTHESIS, color: PROVENANCE_COLOR.AI_HYPOTHESIS, filled: true },
      { text: 'текст модели по данным этого отчёта', color: L.colors.MUTED },
    ])
    L.paragraph(doc, content.narrative.summary)
    for (const p of content.narrative.key_points) L.bullet(doc, p)
    L.paragraph(doc, `Модель: ${content.narrative.model} · версия промпта: ${content.narrative.prompt_version}`, { size: 8.5, color: L.colors.MUTED })
  }

  // ── Блоки ───────────────────────────────────────────────────────────────
  if (d.blocks.length) {
    L.sectionHeader(doc, 'Оценки по блокам')
    chips(doc, [
      { text: PROVENANCE_LABELS.CALCULATED, color: PROVENANCE_COLOR.CALCULATED, filled: true },
      { text: 'правила методики Точки А', color: L.colors.FAINT },
    ])
    for (const b of d.blocks) {
      L.scoreBar(doc, b.label, b.score)
      if (b.top_issues[0]) L.paragraph(doc, `Главная проблема: ${b.top_issues[0]}`, { size: 9, color: L.colors.MUTED, gap: 0.3 })
    }
  }

  // ── Выводы ──────────────────────────────────────────────────────────────
  L.sectionHeader(doc, 'Выводы диагностики')
  if (!content.findings.length) {
    L.paragraph(doc, 'Выводов для показа нет.', { color: L.colors.MUTED })
  }
  for (const f of content.findings) drawFinding(doc, f)

  // ── Рекомендации ────────────────────────────────────────────────────────
  L.sectionHeader(doc, 'Рекомендации')
  if (!content.recommendations.length) {
    L.paragraph(doc, 'Рекомендаций для показа нет.', { color: L.colors.MUTED })
  }
  const titles = new Map(content.findings.map((f) => [f.id, f.title]))
  for (const r of content.recommendations) drawRecommendation(doc, r, titles)

  // ── Полнота и пробелы ─────────────────────────────────────────────────────
  if (content.data.gaps.length) {
    L.sectionHeader(doc, 'Чего не хватает для точной диагностики')
    for (const g of content.data.gaps) L.bullet(doc, g)
  }

  // ── Источники ───────────────────────────────────────────────────────────
  L.sectionHeader(doc, 'Источники данных')
  for (const s of content.sources) L.kvRow(doc, s.label, s.detail)
  L.kvRow(doc, 'Дата расчёта', content.calculated_at ? L.fmtDate(content.calculated_at) : 'нет данных')
  L.kvRow(doc, 'Отчёт сформирован', L.fmtDate(content.generated_at))

  // ── Легенда ─────────────────────────────────────────────────────────────
  L.sectionHeader(doc, 'Как читать пометки')
  for (const [type, text] of LEGEND) {
    chips(doc, [{ text: PROVENANCE_LABELS[type], color: PROVENANCE_COLOR[type], filled: true }])
    L.paragraph(doc, text, { size: 9, color: L.colors.MUTED, gap: 0.3 })
  }
  L.paragraph(doc, 'Уверенность — насколько вывод подтверждён данными: от низкой к полной.', { size: 9, color: L.colors.MUTED })

  return L.finalize(doc)
}
