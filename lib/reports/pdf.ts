/**
 * Branded PDF export renderers for AIStart360 client reports.
 *
 * Four entrypoints, each returning a `Promise<Buffer>`:
 *   • renderGriPdf      — Growth Readiness Index (7-block scoring)
 *   • renderPointAPdf   — Точка А (diagnostic + AI analysis)
 *   • renderPointBPdf   — Точка Б (goal-driven growth plan + AI strategy)
 *   • renderSurveyPdf   — onboarding survey answers, grouped by step
 *
 * Visual language (printable / light theme — dark text on white):
 *   • A4, 50pt margin, brand-green (#6EFFC0) cover band
 *   • IBM Plex Serif body/bold + IBM Plex Mono for numbers (all Cyrillic-safe,
 *     registered via lib/reports/fonts.ts)
 *   • Footer on every page: «© AIStart360 · Конфиденциально»
 *
 * The route is responsible for ALL data loading; these functions accept already
 * typed, already loaded objects so they stay pure (and unit-testable).
 */

import PDFDocument from 'pdfkit'
import { registerReportFonts, REPORT_FONTS } from './fonts'
import {
  SURVEY_LABELS,
  SURVEY_STEP_LABELS,
  getStepFromKey,
  formatSurveyValue,
} from '@/lib/survey-labels'

// ─── Theme ───────────────────────────────────────────────────────────────────

const PRIMARY = '#6EFFC0'
const INK = '#14181F' // near-black body ink
const TEXT = '#1A1A1A'
const MUTED = '#5B6470'
const FAINT = '#8A929E'
const HAIR = '#E2E6EC' // hairline rules
const POSITIVE = '#0E9E6E'
const WARN = '#CA8A04'
const CRIT = '#DC2626'

const PAGE_W = 595.28 // A4 width in pt
const PAGE_H = 841.89 // A4 height in pt
const MARGIN = 50
const CONTENT_W = PAGE_W - MARGIN * 2 // 495.28
const CONTENT_BOTTOM = PAGE_H - 70 // keep clear of the footer

type PDFDoc = InstanceType<typeof PDFDocument>

// ─── Shared input fragments ──────────────────────────────────────────────────

export interface ReportMeta {
  companyName: string
  /** ISO timestamp or Date used for the cover date (defaults to "now"). */
  generatedAt?: string | Date | null
  industry?: string | null
  stage?: string | null
}

// ── GRI ──────────────────────────────────────────────────────────────────────

export interface GriBlockInput {
  key: string
  label: string
  /** 0–100 normalized score. */
  score: number
}

export interface GriPdfInput {
  meta: ReportMeta
  /** Overall GRI index, 0–100. */
  overall: number
  blocks: GriBlockInput[]
  top5?: Array<{ rank?: number; title: string; severity?: string }>
  actionPlan?: Array<{ title: string; detail?: string; horizon?: string }>
}

// ── Точка А ───────────────────────────────────────────────────────────────────

export interface PointABlockInput {
  key: string
  label: string
  score: number
  diagnosis?: string
  benchmark_comparison?: string
  key_risk?: string
  top_recommendation?: string
}

export interface PointAPdfInput {
  meta: ReportMeta
  overallScore: number
  healthIndex: number
  stage?: string | null
  executiveSummary?: string | null
  industryContext?: string | null
  blocks: PointABlockInput[]
  strategicPriorities?: Array<{ title: string; rationale?: string; expected_impact?: string }>
  growthRoadmap?: Array<{ horizon: string; actions: string[] }>
  risks?: Array<{ level?: string; area: string; text: string }>
}

// ── Точка Б ───────────────────────────────────────────────────────────────────

export interface PointBGapInput {
  horizon: string // '12m' | '3y'
  current_revenue: number | null
  target_revenue: number | null
  multiplier: number | null
  required_cagr: number | null
}

export interface PointBPdfInput {
  meta: ReportMeta
  goals: {
    current_revenue_year: number | null
    goal_12m_revenue_year: number | null
    goal_3y_revenue_year: number | null
    goal_12m_text?: string
    goal_3y_text?: string
    main_pain?: string
  }
  gap: PointBGapInput[]
  realism?: {
    level: string
    score: number
    rationale?: string[]
    risk_factors?: string[]
    weak_blocks?: string[]
  } | null
  scenarios?: Array<{
    label: string
    target_revenue_12m: number | null
    target_revenue_3y: number | null
    confidence: string
  }>
  top5Limits?: Array<{ rank: number; title: string; severity?: string }>
  growthDecomposition?: {
    required_multiplier: number | null
    summary?: string
    steps?: Array<{ label: string; note?: string }>
  } | null
  /** AI narrative bridge (PointBStrategy), optional. */
  aiStrategy?: {
    strategic_bridge_summary?: string
    gap_bridge?: Array<{ block: string; gap: string; action: string; priority: string }>
    milestones?: Array<{ q: string; title: string; desc: string }>
    risk_mitigations?: Array<{ risk: string; mitigation: string }>
  } | null
}

// ── Survey ─────────────────────────────────────────────────────────────────────

export interface SurveyPdfInput {
  meta: ReportMeta
  /** Flat map of question_key → raw value (already unwrapped from {value}). */
  answers: Record<string, unknown>
}

// ─── Low-level layout helpers ─────────────────────────────────────────────────

function fmtDate(d?: string | Date | null): string {
  const date = d ? new Date(d) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString('ru-RU')
  return date.toLocaleDateString('ru-RU')
}

function fmtKzt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n).toLocaleString('ru-RU')} ₸`
}

function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

function fmtMult(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n * 10) / 10}×`
}

/**
 * Pick the right numeric font for a value string. JetBrains Mono (our `Mono`)
 * has no tenge glyph «₸», so any string containing it must render with `Money`
 * (Serif Bold). Everything else uses the crisp monospace.
 */
function valueFont(value: string): string {
  return value.includes('₸') ? REPORT_FONTS.money : REPORT_FONTS.mono
}

function scoreColor(score: number): string {
  if (score >= 70) return POSITIVE
  if (score >= 50) return WARN
  return CRIT
}

function severityColor(sev?: string): string {
  const s = (sev || '').toLowerCase()
  if (s === 'critical') return CRIT
  if (s === 'high' || s === 'important') return WARN
  return MUTED
}

/** Ensure at least `space` pt remain before the footer; add a page if not. */
function ensureSpace(doc: PDFDoc, space: number): void {
  if (doc.y + space > CONTENT_BOTTOM) doc.addPage()
}

/**
 * Stamp the confidential footer onto every buffered page. Called ONCE at
 * finalize time (after all content is written) so it never re-enters the
 * layout while sections are still being drawn — `bufferPages: true` makes the
 * page range available. The footer uses Mono (no «₸», so JetBrains is safe).
 */
function stampFooters(doc: PDFDoc): void {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc
      .font(REPORT_FONTS.mono)
      .fontSize(7.5)
      .fillColor(FAINT)
      .text('© AIStart360 · Конфиденциально', MARGIN, PAGE_H - 42, {
        width: CONTENT_W,
        align: 'center',
        lineBreak: false,
      })
  }
}

interface CoverOptions {
  tag: string // mono kicker, e.g. "GROWTH READINESS INDEX"
  title: string // big serif title
  meta: ReportMeta
  /** Optional metric chip shown on the cover (e.g. overall score). */
  headline?: { label: string; value: string } | null
}

function drawCover(doc: PDFDoc, opts: CoverOptions): void {
  // Brand-green band
  doc.save().rect(0, 0, PAGE_W, 200).fill(PRIMARY).restore()

  doc
    .font(REPORT_FONTS.mono)
    .fontSize(9)
    .fillColor(INK)
    .text(opts.tag.toUpperCase(), MARGIN, 56, { characterSpacing: 2 })

  doc
    .font(REPORT_FONTS.bold)
    .fontSize(30)
    .fillColor(INK)
    .text(opts.title, MARGIN, 84, { width: CONTENT_W })

  doc
    .font(REPORT_FONTS.body)
    .fontSize(15)
    .fillColor(INK)
    .text(opts.meta.companyName, MARGIN, 150, { width: CONTENT_W, lineBreak: false })

  // Below the band — meta lines
  let y = 230
  doc.font(REPORT_FONTS.mono).fontSize(10).fillColor(MUTED)
  doc.text(`Дата формирования: ${fmtDate(opts.meta.generatedAt)}`, MARGIN, y)
  y += 16
  if (opts.meta.industry) {
    doc.text(`Отрасль: ${opts.meta.industry}`, MARGIN, y)
    y += 16
  }

  // Headline metric chip
  if (opts.headline) {
    y += 14
    const chipH = 70
    doc.save().roundedRect(MARGIN, y, CONTENT_W, chipH, 12).fill('#F4F6F8').restore()
    doc
      .font(REPORT_FONTS.mono)
      .fontSize(9)
      .fillColor(MUTED)
      .text(opts.headline.label.toUpperCase(), MARGIN + 18, y + 16, { characterSpacing: 1.5 })
    doc
      .font(REPORT_FONTS.bold)
      .fontSize(28)
      .fillColor(INK)
      .text(opts.headline.value, MARGIN + 18, y + 30)
    y += chipH
  }

  doc.y = Math.max(doc.y, y + 24)
}

function sectionHeader(doc: PDFDoc, text: string): void {
  ensureSpace(doc, 60)
  doc.moveDown(0.6)
  const y = doc.y
  doc.font(REPORT_FONTS.bold).fontSize(16).fillColor(INK).text(text, MARGIN, y, { width: CONTENT_W })
  const ruleY = doc.y + 3
  doc
    .save()
    .moveTo(MARGIN, ruleY)
    .lineTo(PAGE_W - MARGIN, ruleY)
    .lineWidth(1.5)
    .strokeColor(PRIMARY)
    .stroke()
    .restore()
  doc.moveDown(0.8)
}

function subHeader(doc: PDFDoc, text: string, color = INK): void {
  ensureSpace(doc, 40)
  doc.font(REPORT_FONTS.bold).fontSize(12).fillColor(color).text(text, MARGIN, doc.y, { width: CONTENT_W })
  doc.moveDown(0.2)
}

/** A paragraph of body copy. */
function paragraph(doc: PDFDoc, text: string, opts: { size?: number; color?: string; gap?: number } = {}): void {
  if (!text || !text.trim()) return
  ensureSpace(doc, 30)
  doc
    .font(REPORT_FONTS.body)
    .fontSize(opts.size ?? 10.5)
    .fillColor(opts.color ?? TEXT)
    .text(text, MARGIN, doc.y, { width: CONTENT_W, align: 'left', lineGap: 1.5 })
  doc.moveDown(opts.gap ?? 0.5)
}

/** A label → value definition row (mono value, right-aligned). */
function kvRow(doc: PDFDoc, label: string, value: string, valueColor = INK): void {
  ensureSpace(doc, 22)
  const y = doc.y
  const labelW = 200
  doc.font(REPORT_FONTS.body).fontSize(10).fillColor(MUTED).text(label, MARGIN, y, { width: labelW })
  const yAfterLabel = doc.y
  doc
    .font(valueFont(value))
    .fontSize(10)
    .fillColor(valueColor)
    .text(value, MARGIN + labelW + 10, y, { width: CONTENT_W - labelW - 10, align: 'right' })
  doc.y = Math.max(yAfterLabel, doc.y)
  doc.moveDown(0.25)
}

/** Bulleted list item with a brand-green marker. */
function bullet(doc: PDFDoc, text: string, opts: { color?: string; indent?: number } = {}): void {
  if (!text || !text.trim()) return
  ensureSpace(doc, 22)
  const indent = opts.indent ?? 0
  const x = MARGIN + indent
  const y = doc.y
  doc.save().circle(x + 3, y + 6, 2).fill(PRIMARY).restore()
  doc
    .font(REPORT_FONTS.body)
    .fontSize(10)
    .fillColor(opts.color ?? TEXT)
    .text(text, x + 12, y, { width: CONTENT_W - indent - 12, lineGap: 1 })
  doc.moveDown(0.3)
}

/**
 * Horizontal score bar with the numeric value. Renders a label, a 0–100 track
 * with a colored fill, and the mono value.
 */
function scoreBar(doc: PDFDoc, label: string, score: number): void {
  ensureSpace(doc, 30)
  const clamped = Math.max(0, Math.min(100, score))
  const y = doc.y
  const barW = CONTENT_W
  const barH = 8
  // Label + value line
  doc.font(REPORT_FONTS.body).fontSize(10).fillColor(INK).text(label, MARGIN, y, { width: barW - 60 })
  doc
    .font(REPORT_FONTS.mono)
    .fontSize(10)
    .fillColor(scoreColor(clamped))
    .text(`${Math.round(clamped)}/100`, MARGIN, y, { width: barW, align: 'right', lineBreak: false })
  const trackY = doc.y + 3
  // Track
  doc.save().roundedRect(MARGIN, trackY, barW, barH, 4).fill('#EEF1F4').restore()
  // Fill
  const fillW = Math.max(2, (barW * clamped) / 100)
  doc.save().roundedRect(MARGIN, trackY, fillW, barH, 4).fill(scoreColor(clamped)).restore()
  doc.y = trackY + barH + 10
}

interface TableCol {
  label: string
  width: number
  align?: 'left' | 'right' | 'center'
}

/**
 * Lightweight table. Renders a header row, then each data row. Wraps to a new
 * page when the cursor would cross into the footer zone (re-drawing the header).
 */
function table(doc: PDFDoc, cols: TableCol[], rows: string[][], rowColors?: (string | undefined)[]): void {
  const rowH = 20

  const drawHeader = () => {
    const y = doc.y
    let x = MARGIN
    doc.font(REPORT_FONTS.mono).fontSize(8.5).fillColor(MUTED)
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, y, { width: c.width, align: c.align ?? 'left', lineBreak: false })
      x += c.width
    }
    const ruleY = y + 14
    doc.save().moveTo(MARGIN, ruleY).lineTo(PAGE_W - MARGIN, ruleY).lineWidth(1).strokeColor(HAIR).stroke().restore()
    doc.y = ruleY + 6
  }

  ensureSpace(doc, rowH * 2)
  drawHeader()

  rows.forEach((row, ri) => {
    if (doc.y + rowH > CONTENT_BOTTOM) {
      doc.addPage()
      drawHeader()
    }
    const y = doc.y
    let x = MARGIN
    const color = rowColors?.[ri] ?? INK
    row.forEach((cell, ci) => {
      const c = cols[ci]
      const isNumeric = (c.align ?? 'left') === 'right'
      doc
        .font(isNumeric ? valueFont(cell) : REPORT_FONTS.body)
        .fontSize(9.5)
        .fillColor(ci === 0 ? color : INK)
        .text(cell, x, y, { width: c.width, align: c.align ?? 'left', lineBreak: false })
      x += c.width
    })
    doc.y = y + rowH
    // hairline between rows
    doc.save().moveTo(MARGIN, doc.y - 6).lineTo(PAGE_W - MARGIN, doc.y - 6).lineWidth(0.5).strokeColor('#F0F2F5').stroke().restore()
  })
  doc.moveDown(0.6)
}

// ─── Document bootstrap ───────────────────────────────────────────────────────

function newDoc(title: string): PDFDoc {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: title,
      Author: 'AIStart360',
      Subject: title,
    },
  })
  registerReportFonts(doc)
  return doc
}

function finalize(doc: PDFDoc): Promise<Buffer> {
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  stampFooters(doc) // footers on every page, after all content is laid out
  doc.flushPages()
  doc.end()
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

// ─── GRI ───────────────────────────────────────────────────────────────────────

export async function renderGriPdf(input: GriPdfInput): Promise<Buffer> {
  const doc = newDoc(`GRI · ${input.meta.companyName}`)

  drawCover(doc, {
    tag: 'Growth Readiness Index',
    title: 'Индекс готовности к росту',
    meta: input.meta,
    headline: { label: 'Общий индекс GRI', value: `${Math.round(input.overall)}/100` },
  })

  // ── Блоки готовности ─────────────────────────────────────────────────────
  sectionHeader(doc, 'Готовность по блокам')
  paragraph(
    doc,
    'Оценка готовности бизнеса к кратному росту по семи фундаментальным блокам. ' +
      'Каждый блок нормирован к шкале 0–100: чем выше, тем устойчивее блок при масштабировании.',
    { color: MUTED, size: 10 },
  )
  doc.moveDown(0.3)
  for (const b of input.blocks) {
    scoreBar(doc, b.label, b.score)
  }

  // ── Сводная таблица ──────────────────────────────────────────────────────
  sectionHeader(doc, 'Сводка по блокам')
  table(
    doc,
    [
      { label: 'Блок', width: 320 },
      { label: 'Оценка', width: 90, align: 'right' },
      { label: 'Статус', width: 85, align: 'right' },
    ],
    input.blocks.map((b) => [b.label, `${Math.round(b.score)}/100`, statusLabel(b.score)]),
    input.blocks.map((b) => scoreColor(b.score)),
  )

  // ── TOP-5 ограничений ────────────────────────────────────────────────────
  if (input.top5 && input.top5.length > 0) {
    sectionHeader(doc, 'TOP-5 ограничений роста')
    input.top5.slice(0, 5).forEach((t, i) => {
      bullet(doc, `${t.rank ?? i + 1}. ${t.title}`, { color: severityColor(t.severity) })
    })
  }

  // ── План действий ────────────────────────────────────────────────────────
  if (input.actionPlan && input.actionPlan.length > 0) {
    sectionHeader(doc, 'Приоритетный план действий')
    for (const a of input.actionPlan) {
      subHeader(doc, a.horizon ? `${a.title} · ${a.horizon}` : a.title)
      if (a.detail) paragraph(doc, a.detail, { size: 10, color: MUTED })
    }
  }

  return finalize(doc)
}

function statusLabel(score: number): string {
  if (score >= 85) return 'Отлично'
  if (score >= 70) return 'Сильно'
  if (score >= 50) return 'Средне'
  if (score >= 30) return 'Слабо'
  return 'Критично'
}

// ─── Точка А ─────────────────────────────────────────────────────────────────

export async function renderPointAPdf(input: PointAPdfInput): Promise<Buffer> {
  const doc = newDoc(`Точка А · ${input.meta.companyName}`)

  drawCover(doc, {
    tag: 'Точка А · Диагностика',
    title: 'Точка А — диагностика бизнеса',
    meta: input.meta,
    headline: { label: 'Общая оценка', value: `${Math.round(input.overallScore)}/100` },
  })

  // ── Сводные показатели ───────────────────────────────────────────────────
  sectionHeader(doc, 'Сводные показатели')
  kvRow(doc, 'Общая оценка', `${Math.round(input.overallScore)}/100`, scoreColor(input.overallScore))
  kvRow(doc, 'Индекс здоровья бизнеса', `${Math.round(input.healthIndex)}/100`, scoreColor(input.healthIndex))

  // ── Резюме ───────────────────────────────────────────────────────────────
  if (input.executiveSummary) {
    sectionHeader(doc, 'Краткое резюме')
    paragraph(doc, input.executiveSummary)
  }

  // ── Оценки по блокам ─────────────────────────────────────────────────────
  sectionHeader(doc, 'Оценки по блокам')
  for (const b of input.blocks) {
    scoreBar(doc, b.label, b.score)
  }

  // ── Разбор блоков ────────────────────────────────────────────────────────
  const hasDetail = input.blocks.some(
    (b) => b.diagnosis || b.benchmark_comparison || b.key_risk || b.top_recommendation,
  )
  if (hasDetail) {
    sectionHeader(doc, 'Разбор по блокам')
    for (const b of input.blocks) {
      if (!(b.diagnosis || b.benchmark_comparison || b.key_risk || b.top_recommendation)) continue
      subHeader(doc, `${b.label} · ${Math.round(b.score)}/100`, scoreColor(b.score))
      if (b.diagnosis) paragraph(doc, `Диагноз: ${b.diagnosis}`, { size: 10 })
      if (b.benchmark_comparison) paragraph(doc, `Сравнение с рынком: ${b.benchmark_comparison}`, { size: 10, color: MUTED })
      if (b.key_risk) paragraph(doc, `Ключевой риск: ${b.key_risk}`, { size: 10, color: CRIT })
      if (b.top_recommendation) paragraph(doc, `Рекомендация: ${b.top_recommendation}`, { size: 10, color: POSITIVE })
      doc.moveDown(0.3)
    }
  }

  // ── Стратегические приоритеты ────────────────────────────────────────────
  if (input.strategicPriorities && input.strategicPriorities.length > 0) {
    sectionHeader(doc, 'Стратегические приоритеты')
    input.strategicPriorities.forEach((p, i) => {
      subHeader(doc, `${i + 1}. ${p.title}`)
      if (p.rationale) paragraph(doc, p.rationale, { size: 10, color: MUTED })
      if (p.expected_impact) paragraph(doc, `Ожидаемый эффект: ${p.expected_impact}`, { size: 10, color: POSITIVE })
    })
  }

  // ── Дорожная карта роста ─────────────────────────────────────────────────
  if (input.growthRoadmap && input.growthRoadmap.length > 0) {
    sectionHeader(doc, 'Дорожная карта роста')
    for (const r of input.growthRoadmap) {
      subHeader(doc, roadmapHorizonLabel(r.horizon))
      for (const a of r.actions) bullet(doc, a)
      doc.moveDown(0.2)
    }
  }

  // ── Риски ────────────────────────────────────────────────────────────────
  if (input.risks && input.risks.length > 0) {
    sectionHeader(doc, 'Ключевые риски')
    for (const r of input.risks) {
      bullet(doc, `${r.area}: ${r.text}`, { color: severityColor(r.level) })
    }
  }

  // ── Контекст отрасли ─────────────────────────────────────────────────────
  if (input.industryContext) {
    sectionHeader(doc, 'Контекст отрасли')
    paragraph(doc, input.industryContext)
  }

  return finalize(doc)
}

function roadmapHorizonLabel(horizon: string): string {
  const map: Record<string, string> = {
    '30_days': 'Первые 30 дней',
    '90_days': 'Первые 90 дней',
    '180_days': 'Первые 180 дней',
  }
  return map[horizon] ?? horizon
}

// ─── Точка Б ─────────────────────────────────────────────────────────────────

export async function renderPointBPdf(input: PointBPdfInput): Promise<Buffer> {
  const doc = newDoc(`Точка Б · ${input.meta.companyName}`)

  const gap12 = input.gap.find((g) => g.horizon === '12m')
  const headlineVal =
    gap12 && gap12.multiplier != null ? `Рост ${fmtMult(gap12.multiplier)} за 12 мес` : 'План роста'

  drawCover(doc, {
    tag: 'Точка Б · Цель',
    title: 'Точка Б — план достижения цели',
    meta: input.meta,
    headline: { label: 'Цель на 12 месяцев', value: headlineVal },
  })

  // ── Цели ─────────────────────────────────────────────────────────────────
  sectionHeader(doc, 'Цели владельца')
  kvRow(doc, 'Текущая выручка / год', fmtKzt(input.goals.current_revenue_year))
  kvRow(doc, 'Цель на 12 месяцев / год', fmtKzt(input.goals.goal_12m_revenue_year), POSITIVE)
  kvRow(doc, 'Цель на 3 года / год', fmtKzt(input.goals.goal_3y_revenue_year), POSITIVE)
  if (input.goals.goal_12m_text) paragraph(doc, `Цель на 12 месяцев: ${input.goals.goal_12m_text}`, { size: 10, color: MUTED, gap: 0.2 })
  if (input.goals.goal_3y_text) paragraph(doc, `Цель на 3 года: ${input.goals.goal_3y_text}`, { size: 10, color: MUTED, gap: 0.2 })
  if (input.goals.main_pain) paragraph(doc, `Главная боль: ${input.goals.main_pain}`, { size: 10, color: MUTED })

  // ── Разрыв ───────────────────────────────────────────────────────────────
  sectionHeader(doc, 'Разрыв до цели')
  table(
    doc,
    [
      { label: 'Горизонт', width: 110 },
      { label: 'Текущая', width: 120, align: 'right' },
      { label: 'Цель', width: 120, align: 'right' },
      { label: 'Множитель', width: 70, align: 'right' },
      { label: 'CAGR', width: 65, align: 'right' },
    ],
    input.gap.map((g) => [
      horizonLabel(g.horizon),
      fmtKzt(g.current_revenue),
      fmtKzt(g.target_revenue),
      fmtMult(g.multiplier),
      fmtPct(g.required_cagr),
    ]),
  )

  // ── Реалистичность ───────────────────────────────────────────────────────
  if (input.realism) {
    sectionHeader(doc, 'Реалистичность цели')
    kvRow(doc, 'Уровень', realismLabel(input.realism.level))
    kvRow(doc, 'Уверенность', `${Math.round(input.realism.score)}/100`, scoreColor(input.realism.score))
    for (const r of input.realism.rationale ?? []) paragraph(doc, r, { size: 10, color: MUTED, gap: 0.2 })
    if ((input.realism.risk_factors ?? []).length > 0) {
      subHeader(doc, 'Факторы риска', CRIT)
      for (const rf of input.realism.risk_factors ?? []) bullet(doc, rf, { color: CRIT })
    }
  }

  // ── Сценарии ─────────────────────────────────────────────────────────────
  if (input.scenarios && input.scenarios.length > 0) {
    sectionHeader(doc, 'Сценарии роста')
    table(
      doc,
      [
        { label: 'Сценарий', width: 180 },
        { label: 'Цель 12 мес', width: 135, align: 'right' },
        { label: 'Цель 3 года', width: 135, align: 'right' },
      ],
      input.scenarios.map((s) => [s.label, fmtKzt(s.target_revenue_12m), fmtKzt(s.target_revenue_3y)]),
    )
  }

  // ── Декомпозиция роста ───────────────────────────────────────────────────
  if (input.growthDecomposition) {
    sectionHeader(doc, 'Декомпозиция роста')
    if (input.growthDecomposition.required_multiplier != null) {
      kvRow(doc, 'Требуемый множитель выручки', fmtMult(input.growthDecomposition.required_multiplier))
    }
    if (input.growthDecomposition.summary) paragraph(doc, input.growthDecomposition.summary, { size: 10 })
    for (const s of input.growthDecomposition.steps ?? []) {
      bullet(doc, s.note ? `${s.label}: ${s.note}` : s.label)
    }
  }

  // ── TOP-5 ограничений ────────────────────────────────────────────────────
  if (input.top5Limits && input.top5Limits.length > 0) {
    sectionHeader(doc, 'TOP-5 ограничений роста')
    input.top5Limits.slice(0, 5).forEach((t, i) => {
      bullet(doc, `${t.rank ?? i + 1}. ${t.title}`, { color: severityColor(t.severity) })
    })
  }

  // ── AI-стратегия ─────────────────────────────────────────────────────────
  const ai = input.aiStrategy
  if (ai && (ai.strategic_bridge_summary || (ai.gap_bridge?.length ?? 0) > 0 || (ai.milestones?.length ?? 0) > 0)) {
    sectionHeader(doc, 'Стратегический мост к цели')
    if (ai.strategic_bridge_summary) paragraph(doc, ai.strategic_bridge_summary)

    if (ai.gap_bridge && ai.gap_bridge.length > 0) {
      subHeader(doc, 'Закрытие разрывов')
      for (const g of ai.gap_bridge) {
        bullet(doc, `${g.block} — ${g.gap}`)
        paragraph(doc, `Действие (${g.priority}): ${g.action}`, { size: 9.5, color: POSITIVE, gap: 0.3 })
      }
    }

    if (ai.milestones && ai.milestones.length > 0) {
      subHeader(doc, 'Вехи')
      for (const m of ai.milestones) {
        bullet(doc, `${m.q} · ${m.title}`)
        if (m.desc) paragraph(doc, m.desc, { size: 9.5, color: MUTED, gap: 0.3 })
      }
    }

    if (ai.risk_mitigations && ai.risk_mitigations.length > 0) {
      subHeader(doc, 'Снижение рисков', CRIT)
      for (const r of ai.risk_mitigations) {
        bullet(doc, `Риск: ${r.risk}`, { color: CRIT })
        paragraph(doc, `Мера: ${r.mitigation}`, { size: 9.5, color: MUTED, gap: 0.3 })
      }
    }
  }

  return finalize(doc)
}

function horizonLabel(h: string): string {
  if (h === '12m') return '12 месяцев'
  if (h === '3y') return '3 года'
  return h
}

function realismLabel(level: string): string {
  const map: Record<string, string> = {
    realistic: 'Реалистичная',
    ambitious: 'Амбициозная',
    aggressive: 'Агрессивная',
    unrealistic: 'Нереалистичная',
    unknown: 'Недостаточно данных',
  }
  return map[level] ?? level
}

// ─── Survey ─────────────────────────────────────────────────────────────────

export async function renderSurveyPdf(input: SurveyPdfInput): Promise<Buffer> {
  const doc = newDoc(`Анкета · ${input.meta.companyName}`)

  drawCover(doc, {
    tag: 'Онбординг · Анкета',
    title: 'Анкета компании',
    meta: input.meta,
    headline: {
      label: 'Заполнено ответов',
      value: String(Object.keys(input.answers).filter((k) => hasValue(input.answers[k])).length),
    },
  })

  // Group answered keys by survey step (1..12). Keys with a known step + a
  // non-empty value only — we don't print blank rows.
  const byStep = new Map<number, Array<[string, unknown]>>()
  for (const [key, value] of Object.entries(input.answers)) {
    if (!hasValue(value)) continue
    const step = getStepFromKey(key)
    if (step <= 0) continue
    if (!byStep.has(step)) byStep.set(step, [])
    byStep.get(step)!.push([key, value])
  }

  const steps = Array.from(byStep.keys()).sort((a, b) => a - b)
  if (steps.length === 0) {
    sectionHeader(doc, 'Ответы анкеты')
    paragraph(doc, 'Ответы анкеты не заполнены.', { color: MUTED })
    return finalize(doc)
  }

  for (const step of steps) {
    const title = SURVEY_STEP_LABELS[step] ?? `Шаг ${step}`
    sectionHeader(doc, `${step}. ${title}`)
    const rows = byStep.get(step)!
    for (const [key, value] of rows) {
      const label = SURVEY_LABELS[key] ?? key
      kvRow(doc, label, formatSurveyValue(key, value))
    }
  }

  return finalize(doc)
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}
