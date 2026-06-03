/**
 * Row-level extractors for sales / CRM documents.
 *
 * Where `extract.ts` produces aggregate `fields[]` (e.g. "total revenue =
 * 12.5M ₸"), THIS module produces the underlying transaction rows that the
 * v3 Point A engines (`lib/point-a/v3/top-table.ts`, `client-base-loader.ts`)
 * need to compute new-vs-repeat splits, RFM, retention curves, etc.
 *
 * Two row shapes are produced, mirroring `scripts/seed-sales-data.js`:
 *
 *   SalesRow:
 *     { client_id, manager_id?, product_id?, amount, occurred_at,
 *       client_name?, manager_name?, product_name?, quantity? }
 *
 *   ClientBaseRow:
 *     { client_id, name, first_purchase_date, last_purchase_date,
 *       total_spent_kzt, purchase_count }
 *
 * Strategy:
 *   1. CSV / XLSX (XLSX is already converted to CSV upstream by `parse.ts`
 *      via `sheet_to_csv`): try a deterministic header-based parser first.
 *      Tolerates Russian column names and several common synonyms.
 *   2. PDF / image / ambiguous CSV: fall back to Claude Sonnet 4.5 via
 *      OpenRouter using a strict Zod-validated JSON tool schema.
 *   3. Empty / missing-required-columns / unparseable: return [].
 *
 * Never throws when called with a string input. Returns [] on degenerate
 * cases so callers can treat the result as authoritative.
 */

import { z } from 'zod'
import {
  chatWithOpenRouter,
  extractJson,
  hasOpenRouterKey,
  OPENROUTER_MODELS,
} from '@/lib/ai/openrouter'

// ─── Public types ────────────────────────────────────────────

export interface SalesRow {
  client_id: string
  manager_id?: string | null
  product_id?: string | null
  amount: number
  occurred_at: string
  client_name?: string | null
  manager_name?: string | null
  product_name?: string | null
  quantity?: number | null
}

export interface ClientBaseRow {
  client_id: string
  name: string
  first_purchase_date: string
  last_purchase_date: string
  total_spent_kzt: number
  purchase_count: number
}

export interface ExtractHints {
  fileName: string
  mimeType: string | null
}

export const EXTRACT_ROWS_VERSION = 'extract-rows@2026-05-21'

// ─── Header synonym maps (Russian + English) ────────────────

const HEADER_SYNONYMS: Record<string, RegExp[]> = {
  client_id: [
    /^client[_\s]?id$/i,
    /^customer[_\s]?id$/i,
    /^id\s*клиента$/i,
    /^клиент[_\s]?id$/i,
  ],
  phone: [
    /^phone$/i,
    /^телефон$/i,
    /^тел\.?$/i,
    /^номер$/i,
    /^номер\s*телефона$/i,
    /^mobile$/i,
  ],
  client_name: [
    /^client$/i,
    /^client[_\s]?name$/i,
    /^customer$/i,
    /^клиент$/i,
    /^покупатель$/i,
    /^наименование$/i,
    /^фио$/i,
    /^имя$/i,
    /^name$/i,
  ],
  manager_id: [
    /^manager[_\s]?id$/i,
    /^менеджер[_\s]?id$/i,
    /^ответственный[_\s]?id$/i,
  ],
  manager_name: [
    /^manager$/i,
    /^менеджер$/i,
    /^ответственный$/i,
    /^seller$/i,
    /^продавец$/i,
  ],
  product_id: [
    /^product[_\s]?id$/i,
    /^товар[_\s]?id$/i,
    /^услуга[_\s]?id$/i,
    /^sku$/i,
  ],
  product_name: [
    /^product$/i,
    /^продукт$/i,
    /^товар$/i,
    /^услуга$/i,
    /^наименование\s*товара$/i,
    /^наименование\s*услуги$/i,
    /^категория$/i,
    /^category$/i,
  ],
  amount: [
    /^amount$/i,
    /^сумма$/i,
    /^цена$/i,
    /^price$/i,
    /^оплата$/i,
    /^total$/i,
    /^итого$/i,
    /^revenue$/i,
    /^выручка$/i,
    /^стоимость$/i,
  ],
  quantity: [
    /^qty$/i,
    /^quantity$/i,
    /^количество$/i,
    /^кол-?во$/i,
  ],
  occurred_at: [
    /^date$/i,
    /^дата$/i,
    /^дата\s*продажи$/i,
    /^дата\s*оплаты$/i,
    /^occurred[_\s]?at$/i,
    /^created[_\s]?at$/i,
    /^datetime$/i,
    /^timestamp$/i,
  ],
  // Client-base specific
  first_purchase_date: [
    /^first[_\s]?purchase[_\s]?date$/i,
    /^первая\s*покупка$/i,
    /^дата\s*первой\s*покупки$/i,
    /^first[_\s]?visit$/i,
  ],
  last_purchase_date: [
    /^last[_\s]?purchase[_\s]?date$/i,
    /^последняя\s*покупка$/i,
    /^дата\s*последней\s*покупки$/i,
    /^last[_\s]?visit$/i,
  ],
  total_spent_kzt: [
    /^total[_\s]?spent$/i,
    /^total[_\s]?spent[_\s]?kzt$/i,
    /^общая\s*сумма$/i,
    /^итого\s*потрачено$/i,
    /^revenue$/i,
    /^lifetime\s*value$/i,
  ],
  purchase_count: [
    /^purchase[_\s]?count$/i,
    /^orders$/i,
    /^visits$/i,
    /^кол-?во\s*покупок$/i,
    /^покупок$/i,
    /^визитов$/i,
    /^frequency$/i,
  ],
}

// ─── CSV helpers ─────────────────────────────────────────────

/**
 * Detect the delimiter of a CSV header line. Returns ',' by default.
 * Picks whichever of `,` `;` `\t` `|` appears most often on the header.
 */
function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestCount = -1
  for (const d of candidates) {
    const c = headerLine.split(d).length
    if (c > bestCount) {
      best = d
      bestCount = c
    }
  }
  return best
}

/**
 * Minimal CSV row tokenizer with quoted-field support.
 */
function parseCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === delim) {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/**
 * Split raw text into CSV rows. Skips blank lines and any lines that
 * appear to be `xlsx` sheet markers (`[Sheet: ...]` injected by `parse.ts`).
 */
function splitCsvLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[Sheet:/i.test(l))
}

function matchHeader(header: string): string | null {
  const trimmed = header.trim().toLowerCase()
  if (!trimmed) return null
  for (const [canonical, patterns] of Object.entries(HEADER_SYNONYMS)) {
    for (const re of patterns) {
      if (re.test(header.trim())) return canonical
      if (re.test(trimmed)) return canonical
    }
  }
  return null
}

// ─── Value normalisers ───────────────────────────────────────

/**
 * Normalise a Kazakhstani / Russian phone number to canonical 11-digit
 * "7XXXXXXXXXX" form. Returns null if the digits don't look like a phone.
 *
 * "8 707 555 1234" → "77075551234"
 * "+7 (707) 555-12-34" → "77075551234"
 * "707 555 1234" → "77075551234"
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '')
  if (!digits) return null
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return '7' + digits.slice(1)
  }
  if (digits.length === 10) return '7' + digits
  if (digits.length === 12 && digits.startsWith('77')) return digits.slice(1)
  return null
}

/**
 * Strip currency tokens and parse a numeric amount.
 *  "1 250 000 ₸" → 1250000
 *  "1.250,50 тг" → 1250.5
 *  "12,500.00 KZT" → 12500
 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null

  // Strip currency tokens. We can't rely on \b for Cyrillic — use explicit
  // boundary classes that match non-letters or string edges.
  let s = raw.replace(/[₸$€£¥]/g, '')
  s = s.replace(/(^|[^a-zA-Zа-яА-Я])(тг|тенге|kzt|руб|rub|usd|eur)(?=[^a-zA-Zа-яА-Я]|$)/gi, '$1')
  s = s.replace(/\s/g, '').trim()
  if (!s) return null

  // Heuristic: if both ',' and '.' are present, the LAST one is the decimal
  // separator (matches both "1,250,000.50" and "1.250.000,50").
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    // Only commas — treat as decimal separator if there's one comma followed
    // by 1-2 digits, else as thousands separator.
    const after = s.length - lastComma - 1
    if (after <= 2 && s.split(',').length === 2) {
      s = s.replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Normalise a date string to ISO 8601. Returns null if unparseable.
 * Tolerates:
 *   "2026-05-21"          (ISO)
 *   "21.05.2026"          (DD.MM.YYYY — Russian)
 *   "21/05/2026"          (DD/MM/YYYY)
 *   "21-05-2026"          (DD-MM-YYYY)
 *   "2026-05-21T10:00:00Z"
 */
export function parseDateIso(raw: unknown): string | null {
  if (raw == null) return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString()
  }
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null

  // ISO-ish — let Date parse it.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  // DD.MM.YYYY  /  DD/MM/YYYY  /  DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2])
    let year = Number(m[3])
    if (year < 100) year += 2000
    const hour = m[4] ? Number(m[4]) : 0
    const min = m[5] ? Number(m[5]) : 0
    const sec = m[6] ? Number(m[6]) : 0
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month - 1, day, hour, min, sec))
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }

  // Last resort: native Date.
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString()
  return null
}

// ─── Header → row mapping ────────────────────────────────────

interface ColumnMap {
  [canonical: string]: number // index into the CSV row array
}

function buildColumnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {}
  headers.forEach((h, idx) => {
    const canonical = matchHeader(h)
    if (canonical && !(canonical in map)) {
      map[canonical] = idx
    }
  })
  return map
}

function cell(row: string[], cols: ColumnMap, key: string): string | undefined {
  const idx = cols[key]
  if (idx == null) return undefined
  const v = row[idx]
  return v == null ? undefined : String(v).trim()
}

// ─── Deterministic CSV → SalesRow[] ──────────────────────────

function csvToSalesRows(text: string): SalesRow[] | null {
  const lines = splitCsvLines(text)
  if (lines.length < 2) return null
  const delim = detectDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delim)
  const cols = buildColumnMap(headers)

  // Required columns: amount + occurred_at + (client_id or client_name or phone).
  const hasAmount = 'amount' in cols
  const hasDate = 'occurred_at' in cols
  const hasIdentity = 'client_id' in cols || 'client_name' in cols || 'phone' in cols
  if (!hasAmount || !hasDate || !hasIdentity) return null

  const out: SalesRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i], delim)
    if (row.every((c) => !c)) continue

    const amount = parseAmount(cell(row, cols, 'amount'))
    const occurred_at = parseDateIso(cell(row, cols, 'occurred_at'))
    if (amount == null || !occurred_at) continue

    let client_id = cell(row, cols, 'client_id') ?? null
    const phoneRaw = cell(row, cols, 'phone')
    const phoneNorm = phoneRaw ? normalizePhone(phoneRaw) : null
    if (!client_id && phoneNorm) client_id = phoneNorm
    if (!client_id) {
      const name = cell(row, cols, 'client_name')
      if (name) client_id = name
    }
    if (!client_id) continue

    const qtyRaw = cell(row, cols, 'quantity')
    const qty = qtyRaw != null ? parseAmount(qtyRaw) : null

    out.push({
      client_id,
      client_name: cell(row, cols, 'client_name') ?? null,
      manager_id: cell(row, cols, 'manager_id') ?? null,
      manager_name: cell(row, cols, 'manager_name') ?? null,
      product_id: cell(row, cols, 'product_id') ?? null,
      product_name: cell(row, cols, 'product_name') ?? null,
      amount,
      quantity: qty,
      occurred_at,
    })
  }
  return out
}

// ─── Deterministic CSV → ClientBaseRow[] ─────────────────────

function csvToClientRows(text: string): ClientBaseRow[] | null {
  const lines = splitCsvLines(text)
  if (lines.length < 2) return null
  const delim = detectDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delim)
  const cols = buildColumnMap(headers)

  const hasFirst = 'first_purchase_date' in cols
  const hasTotal = 'total_spent_kzt' in cols
  const hasCount = 'purchase_count' in cols
  const hasIdentity = 'client_id' in cols || 'client_name' in cols || 'phone' in cols
  if (!hasFirst || !hasTotal || !hasCount || !hasIdentity) return null

  const out: ClientBaseRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i], delim)
    if (row.every((c) => !c)) continue

    const first = parseDateIso(cell(row, cols, 'first_purchase_date'))
    const lastRaw = cell(row, cols, 'last_purchase_date')
    const last = lastRaw ? parseDateIso(lastRaw) ?? first : first
    const total = parseAmount(cell(row, cols, 'total_spent_kzt'))
    const countNum = parseAmount(cell(row, cols, 'purchase_count'))
    if (!first || !last || total == null || countNum == null) continue
    if (countNum < 1) continue

    let client_id = cell(row, cols, 'client_id') ?? null
    const phoneRaw = cell(row, cols, 'phone')
    const phoneNorm = phoneRaw ? normalizePhone(phoneRaw) : null
    if (!client_id && phoneNorm) client_id = phoneNorm
    const name = cell(row, cols, 'client_name') ?? client_id ?? `client-${i}`
    if (!client_id) client_id = name

    out.push({
      client_id,
      name,
      first_purchase_date: first,
      last_purchase_date: last,
      total_spent_kzt: Math.max(0, total),
      purchase_count: Math.max(1, Math.round(countNum)),
    })
  }
  return out
}

// ─── Zod schemas for AI fallback ─────────────────────────────

const salesRowSchema = z.object({
  client_id: z.string().min(1),
  manager_id: z.string().nullable().optional(),
  product_id: z.string().nullable().optional(),
  amount: z.number(),
  occurred_at: z.string().min(4),
  client_name: z.string().nullable().optional(),
  manager_name: z.string().nullable().optional(),
  product_name: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
})

const clientRowSchema = z.object({
  client_id: z.string().min(1),
  name: z.string().min(1),
  first_purchase_date: z.string().min(4),
  last_purchase_date: z.string().min(4),
  total_spent_kzt: z.number(),
  purchase_count: z.number(),
})

const salesEnvelopeSchema = z.object({
  rows: z.array(salesRowSchema).max(2000),
})

const clientEnvelopeSchema = z.object({
  rows: z.array(clientRowSchema).max(5000),
})

// ─── AI fallback (Claude Sonnet 4.5 via OpenRouter) ──────────

async function aiExtractSalesRows(text: string): Promise<SalesRow[]> {
  if (!hasOpenRouterKey()) return []

  const systemPrompt = `You extract raw sales transaction rows from a business document.
Return ONLY a JSON object {"rows":[...]}.
Each row MUST be { "client_id": string, "amount": number (₸/KZT), "occurred_at": ISO-8601 date string }.
Optional fields per row: manager_id, manager_name, product_id, product_name, client_name, quantity.
If the document gives a phone number instead of an id, use the phone digits (E.164 without '+') as client_id.
Do not invent rows. Do not summarise — emit one row per transaction.
Cap at 1000 rows.`

  const userPrompt = `Document text:\n${text.slice(0, 30000)}`

  try {
    const raw = await chatWithOpenRouter({
      model: OPENROUTER_MODELS.sonnet,
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 8000,
      temperature: 0,
      jsonMode: true,
    })
    if (!raw) return []
    const parsed = extractJson<unknown>(raw)
    if (!parsed) return []
    const safe = salesEnvelopeSchema.safeParse(parsed)
    if (!safe.success) {
      console.warn('[extract-rows] sales AI schema mismatch', safe.error.issues.slice(0, 3))
      return []
    }
    return safe.data.rows.map((r) => ({
      ...r,
      occurred_at: parseDateIso(r.occurred_at) ?? r.occurred_at,
    }))
  } catch (err) {
    console.warn('[extract-rows] sales AI failed', err)
    return []
  }
}

async function aiExtractClientRows(text: string): Promise<ClientBaseRow[]> {
  if (!hasOpenRouterKey()) return []

  const systemPrompt = `You extract a client/customer base from a business document.
Return ONLY a JSON object {"rows":[...]}.
Each row MUST be { "client_id": string, "name": string, "first_purchase_date": ISO-8601, "last_purchase_date": ISO-8601, "total_spent_kzt": number, "purchase_count": number }.
If only a phone number is given, use the phone digits (E.164 without '+') as client_id.
Do not invent rows. Skip rows where the required fields are missing.
Cap at 2000 rows.`

  const userPrompt = `Document text:\n${text.slice(0, 30000)}`

  try {
    const raw = await chatWithOpenRouter({
      model: OPENROUTER_MODELS.sonnet,
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 8000,
      temperature: 0,
      jsonMode: true,
    })
    if (!raw) return []
    const parsed = extractJson<unknown>(raw)
    if (!parsed) return []
    const safe = clientEnvelopeSchema.safeParse(parsed)
    if (!safe.success) {
      console.warn('[extract-rows] client AI schema mismatch', safe.error.issues.slice(0, 3))
      return []
    }
    return safe.data.rows.map((r) => ({
      ...r,
      first_purchase_date: parseDateIso(r.first_purchase_date) ?? r.first_purchase_date,
      last_purchase_date: parseDateIso(r.last_purchase_date) ?? r.last_purchase_date,
    }))
  } catch (err) {
    console.warn('[extract-rows] client AI failed', err)
    return []
  }
}

// ─── Public entry points ─────────────────────────────────────

function isLikelyCsv(text: string, hints?: ExtractHints): boolean {
  const ext = (hints?.fileName ?? '').toLowerCase().split('.').pop()
  if (ext === 'csv' || ext === 'xlsx' || ext === 'xls' || ext === 'tsv') return true
  if (hints?.mimeType && /(csv|sheet|excel|spreadsheet)/i.test(hints.mimeType)) return true
  // Heuristic: first non-blank line has at least two separators.
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  return /[,;\t|]/.test(first) && first.split(/[,;\t|]/).length >= 3
}

/**
 * Extract raw SALES transaction rows.
 * Returns [] when no rows can be extracted (do not throw).
 */
export async function extractSalesRows(
  rawText: string,
  hints?: ExtractHints,
): Promise<SalesRow[]> {
  if (!rawText || typeof rawText !== 'string') return []
  const text = rawText.trim()
  if (!text) return []

  if (isLikelyCsv(text, hints)) {
    const det = csvToSalesRows(text)
    if (det && det.length > 0) return det
    // CSV had recognisable headers but produced no rows → empty file. Bail.
    if (det && det.length === 0) return []
    // CSV-like but headers didn't map → fall through to AI.
  }

  return aiExtractSalesRows(text)
}

/**
 * Extract a CLIENT BASE (one row per client).
 * Returns [] when no rows can be extracted (do not throw).
 */
export async function extractClientRows(
  rawText: string,
  hints?: ExtractHints,
): Promise<ClientBaseRow[]> {
  if (!rawText || typeof rawText !== 'string') return []
  const text = rawText.trim()
  if (!text) return []

  if (isLikelyCsv(text, hints)) {
    const det = csvToClientRows(text)
    if (det && det.length > 0) return det
    if (det && det.length === 0) return []
  }

  return aiExtractClientRows(text)
}

// ─── Test-only exports ───────────────────────────────────────
// Exposed for unit tests; not part of the documented public API.
export const __internal = {
  csvToSalesRows,
  csvToClientRows,
  buildColumnMap,
  detectDelimiter,
  parseCsvLine,
  matchHeader,
}
