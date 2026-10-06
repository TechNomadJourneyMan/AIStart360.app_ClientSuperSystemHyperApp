/**
 * OCR self-check — proves local OCR works offline on this machine/container.
 *
 *   npm run ocr:check
 *   npx tsx scripts/ocr/check-ocr.ts [--langs rus,eng] [--skip-pdf] [--timeout 120]
 *
 * 1. language data resolves from node_modules (no URL, nothing downloaded)
 * 2. a generated PNG with known Russian + English text is recognised by the
 *    local tesseract engine and the expected words are found
 * 3. the same image wrapped in an image-only PDF goes through PDF
 *    rasterisation + OCR (the path scans take in production)
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */
import { localOcrAvailability, ocrDocument, setOcrEngine, tesseractOcrEngine, type OcrOutcome } from '../../lib/documents/ocr'
import { isUrlLike, parseOcrLangs, resolveLangData, stageLangData } from '../../lib/documents/ocr-tessdata'
import { missingWords, renderSamplePng, renderScannedPdf } from './sample'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

let failed = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function describe(outcome: OcrOutcome): string {
  if (!outcome.ok) return `${outcome.reason}: ${outcome.message}`
  return outcome.pages
    .map((p) => `page ${p.page}: engine=${p.engine} confidence=${p.confidence === null ? 'n/a' : Math.round(p.confidence)} ${p.ms ?? '?'} ms`)
    .join('; ') + ` (total ${outcome.ms ?? '?'} ms)`
}

async function main(): Promise<void> {
  const langs = parseOcrLangs(arg('langs') ?? process.env.DOCUMENT_OCR_LANGS)
  const timeoutMs = Math.max(10, Number(arg('timeout') ?? 120)) * 1000
  console.log(`OCR self-check: langs=${langs.join('+')} node=${process.version} cwd=${process.cwd()}`)

  // 1. Offline language data.
  const data = resolveLangData(langs)
  check(data.ok, 'language data present', data.ok ? data.files.map((f) => `${f.lang}: ${f.file}`).join(', ') : data.message)
  if (!data.ok) return
  const langPath = stageLangData(data.files)
  check(!isUrlLike(langPath), 'langPath is a local directory', langPath)
  check(localOcrAvailability(langs).ok, 'local engine available')

  // Force the local engine regardless of DOCUMENT_OCR_ENGINE / registered remote.
  setOcrEngine(tesseractOcrEngine())
  try {
    // 2. Image.
    const png = await renderSamplePng()
    const img = await ocrDocument(png, 'image', { langs, force: true, deadlineAt: Date.now() + timeoutMs })
    check(img.ok, 'image OCR completed', describe(img))
    if (img.ok) {
      const text = img.pages.map((p) => p.text).join('\n')
      const missing = missingWords(text)
      check(missing.length === 0, 'expected words recognised (image)', missing.length ? `missing: ${missing.join(', ')}\n--- text ---\n${text}` : '')
      check(img.pages.every((p) => p.engine === 'tesseract'), 'provenance: engine=tesseract on every page')
    }

    // 3. Image-only PDF.
    if (!process.argv.includes('--skip-pdf')) {
      const pdf = await renderScannedPdf([png, png])
      const res = await ocrDocument(pdf, 'pdf', { langs, force: true, deadlineAt: Date.now() + timeoutMs })
      check(res.ok, 'scanned PDF OCR completed', describe(res))
      if (res.ok) {
        check(res.totalPages === 2 && res.pages.length === 2, 'both PDF pages recognised', `${res.pages.length}/${res.totalPages}`)
        const missing = missingWords(res.pages.map((p) => p.text).join('\n'))
        check(missing.length === 0, 'expected words recognised (PDF)', missing.length ? `missing: ${missing.join(', ')}` : '')
      }
    }
  } finally {
    setOcrEngine(null)
  }
}

main()
  .catch((err) => {
    failed += 1
    console.error('FAIL  unexpected error', err)
  })
  .finally(() => {
    console.log(failed ? `\n${failed} check(s) failed` : '\nOCR self-check passed')
    process.exit(failed ? 1 : 0)
  })
