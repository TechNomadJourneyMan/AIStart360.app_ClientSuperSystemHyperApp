/**
 * Run OCR on a local PDF / PNG / JPEG and print per-page text, engine,
 * confidence and timings.
 *
 *   npm run ocr:file -- <file> [--langs rus,eng] [--max-pages N] [--engine auto|local|remote]
 *                         [--remote-module ./my-remote.ts] [--timeout 300] [--json]
 *   npx tsx scripts/ocr/ocr-file.ts scan.pdf --langs rus,eng,kaz --max-pages 3
 *
 * --engine local   tesseract only (offline language data from node_modules)
 * --engine remote  the remote engine; failed pages fall back to local. A
 *                  remote caller must be registered: pass --remote-module with
 *                  a module whose default export is
 *                  `(image: Buffer, mime: string) => Promise<{ text, confidence? } | null>`
 *                  (the app registers one via registerRemoteOcr()).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ocrAvailability, ocrDocument, ocrEngineLabel, registerRemoteOcr, sniffImageMime, type RemoteOcrCall } from '../../lib/documents/ocr'
import { parseOcrLangs } from '../../lib/documents/ocr-tessdata'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function usage(msg?: string): never {
  if (msg) console.error(msg)
  console.error('usage: npx tsx scripts/ocr/ocr-file.ts <file.pdf|png|jpg> [--langs rus,eng] [--max-pages N] [--engine auto|local|remote] [--remote-module path] [--timeout sec] [--json]')
  process.exit(2)
}

async function main(): Promise<number> {
  const valueFlags = new Set(['--langs', '--max-pages', '--engine', '--remote-module', '--timeout'])
  const file = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !valueFlags.has(all[i - 1]))
  if (!file) usage()
  const engine = arg('engine')
  if (engine && !['auto', 'local', 'remote'].includes(engine)) usage(`unknown --engine ${engine}`)
  if (engine) process.env.DOCUMENT_OCR_ENGINE = engine
  const langs = parseOcrLangs(arg('langs') ?? process.env.DOCUMENT_OCR_LANGS)
  const maxPages = arg('max-pages') ? Number.parseInt(arg('max-pages') as string, 10) : undefined
  const timeoutMs = Math.max(5, Number(arg('timeout') ?? 300)) * 1000
  const json = process.argv.includes('--json')

  const remoteModule = arg('remote-module')
  if (remoteModule) {
    const mod = await import(pathToFileURL(path.resolve(remoteModule)).href)
    const call = (mod.default ?? mod.remoteOcr) as RemoteOcrCall | undefined
    if (typeof call !== 'function') usage(`${remoteModule}: default export must be a function (image, mime) => Promise<{ text, confidence? } | null>`)
    registerRemoteOcr(call)
  }

  const buffer = readFileSync(file)
  const ext = path.extname(file).toLowerCase()
  const kind: 'pdf' | 'image' = ext === '.pdf' || buffer.subarray(0, 5).toString('latin1') === '%PDF-' ? 'pdf' : 'image'
  if (kind === 'image' && sniffImageMime(buffer) === 'application/octet-stream') usage(`${file}: not a PDF, PNG or JPEG`)

  const avail = ocrAvailability()
  if (!json) {
    console.log(`file: ${file} (${kind}, ${(buffer.length / 1024).toFixed(0)} KB)`)
    console.log(`engine mode: ${avail.mode}; remote registered: ${avail.remote ? 'yes' : 'no'}; local data: ${avail.local.ok ? 'ok' : avail.local.message}`)
    if (avail.mode === 'remote' && !avail.remote) console.log('note: no remote OCR registered — falling back to the local engine')
    console.log(`langs: ${langs.join('+')}${maxPages ? `; max pages: ${maxPages}` : ''}`)
  }

  const started = Date.now()
  const res = await ocrDocument(buffer, kind, { langs, maxPages, force: true, deadlineAt: Date.now() + timeoutMs })
  const wall = Date.now() - started

  if (json) {
    console.log(JSON.stringify({ file, kind, wall_ms: wall, ...res }, null, 2))
    return res.ok ? 0 : 1
  }
  if (!res.ok) {
    console.error(`OCR failed (${res.reason}): ${res.message} [${wall} ms]`)
    return 1
  }
  for (const p of res.pages) {
    console.log(`\n=== page ${p.page} — ${ocrEngineLabel(p.engine ?? res.engine)}, confidence ${p.confidence === null ? 'n/a' : Math.round(p.confidence)}, ${p.ms ?? '?'} ms, ${p.text.length} chars ===`)
    console.log(p.text || '(no text)')
  }
  console.log('\n--- summary ---')
  console.log(`engine: ${ocrEngineLabel(res.engine)}; pages ${res.pages.length}/${res.totalPages} (rendered ${res.renderedPages ?? '?'})`)
  console.log(`mean confidence: ${res.meanConfidence === null ? 'n/a' : Math.round(res.meanConfidence)}; partial: ${res.partial ? `yes (${res.stopReason})` : 'no'}`)
  if (res.fallback) console.log(`fallback: ${res.fallback.from} → ${res.fallback.to}, ${res.fallback.pages} page(s) (${res.fallback.reason})`)
  const pageMs = res.pages.map((p) => p.ms ?? 0)
  console.log(`time: ${wall} ms total; recognition ${pageMs.reduce((s, x) => s + x, 0)} ms (avg ${Math.round(pageMs.reduce((s, x) => s + x, 0) / Math.max(1, pageMs.length))} ms/page); rasterise + start-up ${wall - pageMs.reduce((s, x) => s + x, 0)} ms`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
