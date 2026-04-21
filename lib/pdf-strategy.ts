// PDF strategy generator for clinic vertical. Mirrors the structure of the
// reference Start_Sau_Zhurek_Clinic_Strategy.docx (7 sections) but renders
// deterministically from patient_segments + growth_bundles + revenue_losses.
//
// Uses pdfkit — lightweight, no React overhead, ~50ms per 8-page doc.

import PDFDocument from 'pdfkit'
import type { SegmentationResult } from '@/lib/rfm-segmentation'
import { SEGMENT_LABELS } from '@/lib/rfm-segmentation'
import type { BundleCalculation } from '@/lib/clinic-bundles'
import type { RevenueAudit } from '@/lib/revenue-audit'
import type { Branding } from '@/lib/verticals'

export interface PdfStrategyInput {
  clinic_name: string
  clinic_email?: string | null
  segmentation: SegmentationResult
  bundles: BundleCalculation[]
  audit: RevenueAudit
  branding: Branding | null
}

const PRIMARY = '#6EFFC0'         // default brand green
const TEXT = '#1A1A1A'
const MUTED = '#666666'
const ACCENT_CRITICAL = '#DC2626'
const ACCENT_HIGH = '#EA580C'
const ACCENT_MEDIUM = '#CA8A04'

function fmtKzt(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₸`
}

function fmtMillion(n: number): string {
  return `${(n / 1_000_000).toFixed(1)}M ₸`
}

export async function generateStrategyPdf(input: PdfStrategyInput): Promise<Buffer> {
  const primaryColor = input.branding?.primary_color?.trim() || PRIMARY

  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `Стратегия роста · ${input.clinic_name}`,
      Author: input.branding?.product_name || 'AIStart360',
      Subject: 'Клиническая стратегия роста выручки',
    },
  })

  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))

  // ── Cover ────────────────────────────────────────────────────────────────
  doc.rect(0, 0, 595, 180).fill(primaryColor)
  doc.fill('white').fontSize(10).text(input.branding?.product_name || 'AIStart360', 50, 60)
  doc.fontSize(24).text('Стратегия роста выручки', 50, 90)
  doc.fontSize(16).text(input.clinic_name, 50, 130)

  doc.fill(TEXT).fontSize(10)
     .text(`Дата: ${new Date().toLocaleDateString('ru-RU')}`, 50, 210)
  if (input.clinic_email) {
    doc.text(`Email клиента: ${input.clinic_email}`, 50, 225)
  }

  // ── Executive Summary ────────────────────────────────────────────────────
  doc.moveDown(3)
  doc.fill(primaryColor).fontSize(18).text('Ключевые цифры')
  doc.moveDown(0.5)
  doc.fill(TEXT).fontSize(11).text(
    `База пациентов: ${input.segmentation.totals.total_patients.toLocaleString('ru-RU')} человек. ` +
    `Суммарный LTV: ${fmtMillion(input.segmentation.totals.total_ltv_kzt)}. ` +
    `Средний чек: ${fmtKzt(input.segmentation.totals.avg_check_kzt)}. ` +
    `Активных (≤90 дней): ${input.segmentation.totals.active_last_90d.toLocaleString('ru-RU')}.`,
    { align: 'justify' },
  )
  doc.moveDown(0.5)
  doc.fill(ACCENT_CRITICAL).fontSize(13).text(
    `⚠ Оценочные ежемесячные потери: ${fmtMillion(input.audit.total_loss_kzt)}`,
  )
  doc.moveDown(0.3)
  doc.fill(MUTED).fontSize(10).text(input.audit.narrative, { align: 'justify' })

  // ── Section 1: Сегментация базы ──────────────────────────────────────────
  doc.addPage()
  drawSectionHeader(doc, primaryColor, '1. Сегментация клиентской базы')

  doc.fill(TEXT).fontSize(10).text(
    'Пациенты разбиты на 8 сегментов по методике RFM (Recency, Frequency, Monetary). ' +
    'Сегменты отсортированы по приоритету обзвона — от наиболее ценного возврата к наименее вероятному.',
    { align: 'justify' },
  )
  doc.moveDown(0.8)

  const segTableTop = doc.y
  drawTableHeader(doc, segTableTop, [
    { label: '№', x: 50, w: 25 },
    { label: 'Сегмент', x: 75, w: 145 },
    { label: 'Клиентов', x: 220, w: 60 },
    { label: 'Σ LTV', x: 280, w: 80 },
    { label: 'Ср. LTV', x: 360, w: 75 },
    { label: 'Давность', x: 435, w: 60 },
  ])
  let y = segTableTop + 25
  for (const s of input.segmentation.summary) {
    doc.fill(TEXT).fontSize(9)
       .text(`S${s.priority}`, 50, y, { width: 25 })
       .text(s.label, 75, y, { width: 145 })
       .text(s.count.toLocaleString('ru-RU'), 220, y, { width: 60 })
       .text(fmtMillion(s.total_ltv_kzt), 280, y, { width: 80 })
       .text(fmtKzt(s.avg_ltv_kzt), 360, y, { width: 75 })
       .text(`${s.avg_recency_days} дн`, 435, y, { width: 60 })
    y += 16
  }

  // ── Section 2: Карта потерь выручки ──────────────────────────────────────
  doc.addPage()
  drawSectionHeader(doc, primaryColor, '2. Карта потерь выручки')

  doc.fill(TEXT).fontSize(10).text(
    `По оценке системы клиника теряет около ${fmtMillion(input.audit.total_loss_kzt)} в месяц ` +
    'из-за отсутствующих или неэффективных процессов работы с базой. Все 9 точек потерь закрываются системно через 9 связок.',
    { align: 'justify' },
  )
  doc.moveDown(0.8)

  for (const loss of input.audit.losses) {
    const sevColor = loss.severity === 'critical' ? ACCENT_CRITICAL :
                     loss.severity === 'high' ? ACCENT_HIGH :
                     loss.severity === 'medium' ? ACCENT_MEDIUM : MUTED
    doc.fill(sevColor).fontSize(11).text(`▪ ${loss.label} — ${fmtMillion(loss.estimated_loss_kzt)}/мес`)
    doc.fill(MUTED).fontSize(8.5).text(loss.source_data, { indent: 15 })
    doc.moveDown(0.4)
  }

  // ── Section 3: 9 связок роста ────────────────────────────────────────────
  doc.addPage()
  drawSectionHeader(doc, primaryColor, '3. Девять связок роста')

  for (const b of input.bundles) {
    if (doc.y > 720) doc.addPage()
    doc.fill(primaryColor).fontSize(12).text(`#${b.priority}  ${b.label}`)
    doc.fill(TEXT).fontSize(9)
    doc.text(`Целевые сегменты: ${b.target_segments.map((s) => SEGMENT_LABELS[s]).join(', ')}`, { indent: 15 })
    doc.text(`Целевые пациенты: ${b.target_patient_count.toLocaleString('ru-RU')}`, { indent: 15 })
    doc.text(`Конверсия: ${b.estimated_conversion}%   Эффект: ${b.effect_timeline}   Сложность: ${b.complexity}`, { indent: 15 })
    doc.fill('#10B981').text(`Прогноз выручки: ${fmtKzt(b.estimated_revenue_kzt)} / мес`, { indent: 15 })
    doc.fill(MUTED).fontSize(8.5)
       .text(b.trigger_description, { indent: 15 })
       .text(`Скрипт: ${b.script_preview}`, { indent: 15 })
    doc.moveDown(0.7)
  }

  // Bundle total
  const bundleTotal = input.bundles.reduce((s, b) => s + b.estimated_revenue_kzt, 0)
  if (doc.y > 720) doc.addPage()
  doc.fill(primaryColor).fontSize(14)
  doc.text(`ИТОГО потенциал: ${fmtMillion(bundleTotal)} / мес дополнительной выручки`)

  // ── Section 4: План запуска 30/60/90 ─────────────────────────────────────
  doc.addPage()
  drawSectionHeader(doc, primaryColor, '4. План запуска по месяцам')

  const phases = [
    { label: 'Месяц 1', focus: input.bundles.slice(0, 2), note: 'Первая волна — самое быстрое «быстрые победы». Первые результаты видны в течение 48 часов.' },
    { label: 'Месяц 2', focus: input.bundles.slice(2, 5), note: 'Подключение cross-sell и follow-up. Повторные визиты в тот же день после диагностики.' },
    { label: 'Месяц 3', focus: input.bundles.slice(5, 7), note: 'Реактивация спящей базы и запуск NPS-контура. Первая волна рефералов.' },
    { label: 'Месяц 4+', focus: input.bundles.slice(7), note: 'Хроники и сезонные кампании — стабильный долгосрочный поток выручки.' },
  ]
  for (const p of phases) {
    doc.fill(primaryColor).fontSize(12).text(p.label)
    for (const b of p.focus) {
      doc.fill(TEXT).fontSize(9).text(`• ${b.label} — ${fmtKzt(b.estimated_revenue_kzt)}/мес`, { indent: 15 })
    }
    doc.fill(MUTED).fontSize(8.5).text(p.note, { indent: 15 })
    doc.moveDown(0.5)
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  const productName = input.branding?.product_name || 'AIStart360'
  doc.fill(MUTED).fontSize(7.5).text(
    `© ${productName} · Стратегия для ${input.clinic_name} · Конфиденциально`,
    50, 800, { align: 'center', width: 495 },
  )

  doc.end()
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type PDFDocInstance = InstanceType<typeof PDFDocument>

function drawSectionHeader(doc: PDFDocInstance, color: string, text: string) {
  doc.fill(color).fontSize(18).text(text)
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(color).stroke()
  doc.moveDown(0.8)
}

interface ColDef { label: string; x: number; w: number }

function drawTableHeader(doc: PDFDocInstance, y: number, cols: ColDef[]) {
  doc.fill('#999').fontSize(8.5)
  for (const c of cols) {
    doc.text(c.label, c.x, y, { width: c.w })
  }
  doc.moveTo(50, y + 16).lineTo(545, y + 16).strokeColor('#DDDDDD').stroke()
}
