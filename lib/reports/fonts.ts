import path from 'path'
import type PDFDocument from 'pdfkit'

/**
 * Cyrillic-correct font registration for all AIStart360 report PDFs.
 *
 * pdfkit's built-in Helvetica/Times fonts do NOT contain Cyrillic glyphs — any
 * Russian text rendered with them comes out as empty boxes (the latent bug in
 * the legacy `lib/pdf-strategy.ts`). We therefore register three embedded TTFs
 * that are confirmed Cyrillic-complete:
 *
 *   • Body  — IBM Plex Serif Regular  (body copy, paragraphs)
 *   • Bold  — IBM Plex Serif Bold     (headings, emphasis)
 *   • Mono  — JetBrains Mono Regular  (scores, %, ×, data labels)
 *   • Money — IBM Plex Serif Bold     (currency values containing «₸»)
 *
 * NOTE ON THE MONO FONT: the IBM Plex Mono TTFs shipped in the canvas-design
 * skill are malformed and crash fontkit (the layout engine pdfkit uses) with
 * "Offset is outside the bounds of the DataView". We therefore use JetBrains
 * Mono — also the portal's brand mono — which is Cyrillic-complete. JetBrains
 * Mono lacks ONLY the Kazakhstani tenge sign «₸», so currency strings are
 * rendered with the `Money` alias (IBM Plex Serif Bold, which has «₸»).
 *
 * The TTFs live in `public/fonts/` (copied from the canvas-design skill). They
 * are resolved from `process.cwd()` so the route works in every runtime as long
 * as it runs on Node (the export route sets `runtime = 'nodejs'`).
 */

type PDFDoc = InstanceType<typeof PDFDocument>

export const REPORT_FONTS = {
  body: 'Body',
  bold: 'Bold',
  mono: 'Mono',
  /** Currency/tenge values — Serif Bold, the only registered font with «₸». */
  money: 'Money',
} as const

function fontPath(file: string): string {
  return path.join(process.cwd(), 'public', 'fonts', file)
}

/**
 * Register Body / Bold / Mono on the given PDFKit document. Call once, right
 * after constructing the document and before writing any text. Returns the same
 * doc for convenience.
 */
export function registerReportFonts(doc: PDFDoc): PDFDoc {
  doc.registerFont(REPORT_FONTS.body, fontPath('IBMPlexSerif-Regular.ttf'))
  doc.registerFont(REPORT_FONTS.bold, fontPath('IBMPlexSerif-Bold.ttf'))
  doc.registerFont(REPORT_FONTS.mono, fontPath('JetBrainsMono-Regular.ttf'))
  doc.registerFont(REPORT_FONTS.money, fontPath('IBMPlexSerif-Bold.ttf'))
  // Default every subsequent .text() to the Cyrillic body font so a missed
  // explicit .font() call can never fall back to glyph-less Helvetica.
  doc.font(REPORT_FONTS.body)
  return doc
}
