/**
 * Synthetic "scan" fixtures for OCR checks (scripts/ocr/check-ocr.ts and the
 * real-tesseract vitest test): known Russian + English text rendered to a PNG
 * with @napi-rs/canvas, optionally wrapped into an image-only PDF (pdfkit) —
 * a PDF without a text layer, exactly what a scanner produces.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

export const SAMPLE_LINES = [
  'Отчёт о продажах за 2025 год',
  'Выручка компании выросла до 48 500 000 тенге',
  'Количество клиентов 1250, средний чек 38 800',
  'Revenue growth 18 percent, net profit stable',
] as const

/** Words a working OCR must recognise on the sample (compared case-insensitively, ё → е). */
export const SAMPLE_EXPECTED_WORDS = ['Отчёт', 'продажах', 'Выручка', 'компании', 'тенге', 'клиентов', 'Revenue', 'growth', 'profit', '2025'] as const

export function normalizeOcrText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

/** Expected words missing from the recognised text. */
export function missingWords(text: string, words: readonly string[] = SAMPLE_EXPECTED_WORDS): string[] {
  const hay = normalizeOcrText(text)
  return words.filter((w) => !hay.includes(normalizeOcrText(w)))
}

const FONT_FILE = path.join(process.cwd(), 'public', 'fonts', 'IBMPlexSerif-Regular.ttf')
const FONT_FAMILY = 'OcrSampleSerif'

/** PNG with the sample lines: black serif text on white, ~150 dpi A4 width. */
export async function renderSamplePng(lines: readonly string[] = SAMPLE_LINES): Promise<Buffer> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas')
  let family = 'serif'
  if (existsSync(FONT_FILE) && (GlobalFonts.has(FONT_FAMILY) || GlobalFonts.registerFromPath(FONT_FILE, FONT_FAMILY))) {
    family = FONT_FAMILY
  }
  const width = 1240
  const lineHeight = 78
  const canvas = createCanvas(width, 120 + lines.length * lineHeight)
  const g = canvas.getContext('2d')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#111111'
  g.font = `40px ${family}`
  lines.forEach((line, i) => g.fillText(line, 70, 100 + i * lineHeight))
  return canvas.toBuffer('image/png')
}

/** Image-only PDF (no text layer) with one page per PNG. */
export async function renderScannedPdf(pngs: readonly Buffer[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default
  const doc = new PDFDocument({ autoFirstPage: false, compress: true })
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  for (const png of pngs) {
    doc.addPage({ size: 'A4', margin: 0 })
    doc.image(png, 20, 40, { width: 555 })
  }
  doc.end()
  return done
}
