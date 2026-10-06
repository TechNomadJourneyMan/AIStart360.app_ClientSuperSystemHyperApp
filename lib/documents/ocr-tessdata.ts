/**
 * Offline Tesseract language data for OCR (lib/documents/ocr.ts).
 *
 * The data ships as npm packages — `@tesseract.js-data/{rus,eng,kaz}` — so it
 * is installed with the app and traced into the serverless bundle
 * (next.config.mjs → experimental.outputFileTracingIncludes). Nothing is ever
 * downloaded: tesseract.js would otherwise fetch it from cdn.jsdelivr.net on
 * first use, which our containers cannot reach.
 *
 * Each package holds two variants:
 *   4.0.0/<lang>.traineddata.gz           legacy + LSTM ("best"), 4–11 MB
 *   4.0.0_best_int/<lang>.traineddata.gz  LSTM only, integer-quantised, 2–3 MB
 * We run tesseract with OEM.LSTM_ONLY, so only `4.0.0_best_int` is used (and
 * only that directory is traced into the bundle).
 *
 * tesseract.js reads `<langPath>/<lang>.traineddata.gz` from ONE directory,
 * while the packages live in one directory per language. `stageLangData`
 * therefore links (or copies) the files into a single directory under the OS
 * temp dir (writable on Vercel: /tmp). When every file already sits in one
 * directory (DOCUMENT_OCR_LANG_PATH), that directory is used as is.
 *
 * Paths are resolved from `process.cwd()` (the project root locally, /var/task
 * on Vercel) — never via `require.resolve`, which webpack rewrites into module
 * ids inside server bundles.
 */
import { copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Environment lookup (process.env or a plain object in tests). */
export type OcrEnv = Readonly<Record<string, string | undefined>>

export const TESSDATA_PACKAGE_SCOPE = '@tesseract.js-data'
/** LSTM-only integer models: matches OEM.LSTM_ONLY and keeps the bundle small. */
export const TESSDATA_VARIANT = '4.0.0_best_int'
/** Languages whose data is installed as a dependency. */
export const BUNDLED_OCR_LANGS = ['rus', 'eng', 'kaz'] as const
export const DEFAULT_OCR_LANGS: readonly string[] = ['rus', 'eng']

const LANG_CODE = /^[a-z]{3}(?:_[a-z]{2,8})?$/

/**
 * Parse DOCUMENT_OCR_LANGS ("rus,eng", "rus+eng+kaz", "rus eng"). Unknown
 * shapes are dropped; an empty result falls back to the default rus+eng.
 */
export function parseOcrLangs(raw: string | null | undefined): string[] {
  const langs = String(raw ?? '')
    .toLowerCase()
    .split(/[\s,+;]+/)
    .map((s) => s.trim())
    .filter((s) => LANG_CODE.test(s))
  const unique = Array.from(new Set(langs))
  return unique.length ? unique : [...DEFAULT_OCR_LANGS]
}

export function isUrlLike(p: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith('//')
}

export interface LangDataFile {
  lang: string
  file: string
  source: 'env' | 'package'
}

export type LangDataResolution =
  | { ok: true; files: LangDataFile[] }
  | { ok: false; files: LangDataFile[]; missing: string[]; message: string }

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** node_modules directories to search: cwd and its parents (scripts may run from a subdir). */
function nodeModulesRoots(cwd: string): string[] {
  const out: string[] = []
  let dir = path.resolve(cwd)
  for (let i = 0; i < 6; i += 1) {
    out.push(path.join(dir, 'node_modules'))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return out
}

/** Every place a language file may live, in priority order. */
export function langDataCandidates(
  lang: string,
  env: OcrEnv = process.env,
  cwd: string = process.cwd(),
): Array<Omit<LangDataFile, 'lang'>> {
  const out: Array<Omit<LangDataFile, 'lang'>> = []
  const custom = env.DOCUMENT_OCR_LANG_PATH?.trim()
  if (custom && !isUrlLike(custom)) {
    const dir = path.resolve(cwd, custom)
    out.push({ file: path.join(dir, `${lang}.traineddata.gz`), source: 'env' })
    out.push({ file: path.join(dir, `${lang}.traineddata`), source: 'env' })
  }
  for (const root of nodeModulesRoots(cwd)) {
    out.push({ file: path.join(root, TESSDATA_PACKAGE_SCOPE, lang, TESSDATA_VARIANT, `${lang}.traineddata.gz`), source: 'package' })
  }
  return out
}

/** Find the local file for every language. Never touches the network. */
export function resolveLangData(
  langs: readonly string[],
  env: OcrEnv = process.env,
  cwd: string = process.cwd(),
): LangDataResolution {
  const custom = env.DOCUMENT_OCR_LANG_PATH?.trim()
  if (custom && isUrlLike(custom)) {
    return {
      ok: false,
      files: [],
      missing: [...langs],
      message: `DOCUMENT_OCR_LANG_PATH должен быть локальной папкой, а не URL (${custom.slice(0, 80)}): языковые данные OCR не загружаются из сети`,
    }
  }
  const files: LangDataFile[] = []
  const missing: string[] = []
  for (const lang of langs) {
    if (!LANG_CODE.test(lang)) {
      missing.push(lang)
      continue
    }
    const hit = langDataCandidates(lang, env, cwd).find((c) => isFile(c.file))
    if (hit) files.push({ lang, ...hit })
    else missing.push(lang)
  }
  if (missing.length) {
    return {
      ok: false,
      files,
      missing,
      message: `нет языковых данных OCR для: ${missing.join(', ')} — установите ${missing.map((l) => `${TESSDATA_PACKAGE_SCOPE}/${l}`).join(', ')} или задайте DOCUMENT_OCR_LANG_PATH`,
    }
  }
  return { ok: true, files }
}

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}

export function defaultStageDir(): string {
  return path.join(tmpdir(), 'aistart360-tessdata', TESSDATA_VARIANT)
}

/**
 * Return a local directory (never a URL) that contains `<lang>.traineddata.gz`
 * for every file. A plain `.traineddata` staged under the `.gz` name is fine:
 * tesseract.js checks the gzip magic bytes before inflating.
 */
export function stageLangData(files: readonly LangDataFile[], stageDir: string = defaultStageDir()): string {
  if (!files.length) throw new Error('stageLangData: no language files')
  const dirs = new Set(files.map((f) => path.dirname(f.file)))
  const allGz = files.every((f) => path.basename(f.file) === `${f.lang}.traineddata.gz`)
  if (dirs.size === 1 && allGz) return [...dirs][0]

  mkdirSync(stageDir, { recursive: true })
  for (const f of files) {
    const dest = path.join(stageDir, `${f.lang}.traineddata.gz`)
    if (existsSync(dest) && sameFile(dest, f.file)) continue
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`
    try {
      symlinkSync(f.file, tmp)
    } catch {
      copyFileSync(f.file, tmp)
    }
    try {
      renameSync(tmp, dest)
    } catch (err) {
      rmSync(tmp, { force: true })
      // Another invocation staged the same file concurrently.
      if (!(existsSync(dest) && sameFile(dest, f.file))) throw err
    }
  }
  return stageDir
}
