/**
 * lib/tabular-parse.ts — reading client spreadsheets (patient bases, CRM
 * exports) the way Kazakhstan / Russia files are written. Shared by the RFM
 * segmentation (lib/rfm-segmentation.ts, R-042) and the data-quality check
 * (lib/data-quality.ts), so the check judges the file exactly as the analysis
 * will read it:
 *   • dates day-first (ДД.ММ.ГГГГ, Excel date cells / serials), never the US
 *     M/D order of Date.parse;
 *   • numbers with spaces / NBSP as thousands and «,» as the decimal mark;
 *   • CSV text in UTF-8 (with or without BOM), UTF-16 (BOM) or Windows-1251 —
 *     a Cyrillic export from Excel is usually 1251, and read as UTF-8 its
 *     headers become «���».
 */
import * as XLSX from 'xlsx'

/**
 * The text of an uploaded CSV / TXT: a BOM decides (UTF-8, UTF-16 LE/BE);
 * otherwise strict UTF-8, and bytes that are not valid UTF-8 are read as
 * Windows-1251 (Excel «CSV» on a Russian-locale Windows).
 */
export function decodeTextFile(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

/** Excel serial day → UTC date (1900 system). */
function excelSerialDate(v: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000)
}

function utcDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null
}

/**
 * A visit date from an export: Date, Excel serial, ДД.ММ.ГГГГ (also ДД/ММ/ГГГГ,
 * ДД-ММ-ГГГГ, two-digit years, an optional time) or ISO ГГГГ-ММ-ДД[Thh:mm…].
 * Day-first always (Kazakhstan / Russia exports) — never the US M/D order of
 * Date.parse. Anything else → null.
 */
export function parseDayFirstDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') return v > 25000 && v < 60000 ? excelSerialDate(v) : null
  const s = String(v).trim()
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:[ T,]+\d{1,2}:\d{2}(?::\d{2})?)?$/)
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10)
    return utcDate(year, parseInt(dmy[2], 10), parseInt(dmy[1], 10))
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/)
  if (iso) return utcDate(parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10))
  return null
}

/**
 * A money / count cell: «45 000,50 ₸» → 45000.5, «45,000.50» → 45000.5,
 * «1 234 567» → 1234567, «1.234.567,8» → 1234567.8, «12,5» → 12.5.
 * Spaces, NBSP, thin spaces and apostrophes are thousands separators; with
 * both «.» and «,» the last one is the decimal mark; a single «,» or «.» is
 * decimal, a repeated one is thousands. Currency signs / words are dropped.
 */
export function parseLocaleNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).replace(/[\s\u00A0\u202F\u2009'’]/g, '').replace(/₸|тг\.?|тенге|kzt|руб\.?|₽|\$|€/gi, '')
  if (!s) return null
  const neg = /^[-−]/.test(s)
  s = s.replace(/^[-−+]/, '')
  if (!/^[\d.,]+$/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ','
    const thou = dec === '.' ? ',' : '.'
    s = s.split(thou).join('').replace(dec, '.')
  } else {
    const sep = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : null
    if (sep) {
      const parts = s.split(sep)
      // Repeated, or one group of exactly 3 digits after a non-zero integer
      // part («45,000», «1.500»): thousands — money never has 3 decimals.
      const thousands = parts.length > 2 || (parts[1].length === 3 && parts[0] !== '0' && parts[0] !== '')
      s = thousands ? parts.join('') : `${parts[0]}.${parts[1]}`
    }
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

/**
 * Headers + rows with TYPED cells (R-042): a date cell is a Date, a number
 * cell a number, text stays text. lib/data-quality.ts parseFileBuffer formats
 * cells (raw: false), which turns a real date cell into the US «4/3/26» — a
 * day-first reader would take it for 4 March. CSV text is decoded by
 * decodeTextFile (UTF-8 / UTF-16 / Windows-1251) and read without value
 * guessing (SheetJS would read «03/04/2026» as 4 March).
 */
export function readPatientSheet(
  buf: ArrayBuffer | Uint8Array | Buffer,
  filename: string,
): { headers: string[]; rows: Array<Record<string, unknown>>; error: string | null } {
  try {
    const ext = (filename.split('.').pop() ?? '').toLowerCase()
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf
    const wb = ext === 'csv' || ext === 'txt'
      ? XLSX.read(decodeTextFile(bytes), { type: 'string', raw: true })
      : XLSX.read(bytes, { type: Buffer.isBuffer(bytes) ? 'buffer' : 'array', cellDates: true })
    const first = wb.SheetNames[0]
    if (!first) return { headers: [], rows: [], error: 'No sheets found' }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], { header: 1, defval: '', raw: true })
    if (aoa.length === 0) return { headers: [], rows: [], error: 'Файл пуст' }
    const headers = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim())
    const rows = aoa.slice(1).map((row) => {
      const r: Record<string, unknown> = {}
      headers.forEach((h, i) => { r[h] = (row as unknown[])[i] })
      return r
    })
    return { headers, rows, error: null }
  } catch (e) {
    return { headers: [], rows: [], error: e instanceof Error ? e.message : 'parse error' }
  }
}
