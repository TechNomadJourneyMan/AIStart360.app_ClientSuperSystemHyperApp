// RFM (Recency, Frequency, Monetary) segmentation for clinic patient bases.
// Thresholds calibrated on the Sau Zhurek reference case (2 747 patients,
// LTV ₸61.1M, март–апрель 2026) — see docs/drive-download/2.*.docx.
//
// 8 segments, priority-ordered for call-center outreach:
//   S1 · VIP удержание        (36 у SZ)   LTV ≥80k, ≤90d          — plановый контроль
//   S2 · VIP реактивация      (18)         LTV ≥80k, >90d          — возврат VIP
//   S3 · Лояльные активные    (504)        2+ визитов, ≤90d        — cross-sell
//   S4 · Риск оттока          (626)        2+ визитов, 91–180d     — контрольный визит
//   S6 · Спящие              (104)        >180d с последнего       — сезонный скрининг
//   S7 · Разовые свежие      (422)        1 визит, ≤90d           — второй визит
//   S8 · Разовые старые      (412)        1 визит, >90d           — годовой контроль
//   S5 · Мёртвые лиды        (625)        0 визитов                — верификация + акция
//
// R-042 (BI-54/55):
//   • dates are day-first (ДД.ММ.ГГГГ) or ISO (ГГГГ-ММ-ДД); «03.04.2026» is
//     3 April (Date.parse read it as 4 March, US order) — parseDayFirstDate;
//   • numbers are locale-aware: «45 000,50 ₸» = 45000.5 (was 4 500 050),
//     spaces / NBSP / apostrophes are thousands, a single comma is decimal —
//     parseLocaleNumber;
//   • the VIP cut-off is the base's own 98th percentile of spend (top 2 %, as
//     calibrated on Sau Zhurek) when the base is large enough; the 80 000 ₸ of
//     one clinic is only the fallback for a small base;
//   • without a visit-count column frequency is UNKNOWN, not 0: patients are
//     segmented by recency + spend and the result carries a quality warning
//     (was: the whole base became «Мёртвые лиды» and the check said «ok»).

import crypto from 'crypto'
import * as XLSX from 'xlsx'

export type PatientSegmentId =
  | 'vip_retention'
  | 'vip_reactivation'
  | 'loyal_active'
  | 'churn_risk'
  | 'sleeping'
  | 'one_time_fresh'
  | 'one_time_old'
  | 'dead_lead'

export interface SegmentedPatient {
  patient_hash: string
  display_name: string | null
  recency_days: number
  frequency: number
  monetary_kzt: number
  segment: PatientSegmentId
  priority: number      // 1..8 per segment
}

export interface SegmentationSummary {
  segment: PatientSegmentId
  label: string
  count: number
  total_ltv_kzt: number
  avg_ltv_kzt: number
  avg_recency_days: number
  priority: number
}

export interface SegmentationResult {
  patients: SegmentedPatient[]
  summary: SegmentationSummary[]
  totals: {
    total_patients: number
    total_ltv_kzt: number
    avg_check_kzt: number
    active_last_90d: number
    sleeping_180d_plus: number
    dead_leads: number
  }
  thresholds: {
    vip_ltv_kzt: number       // the base's p98 of spend (80 000 ₸ for Sau Zhurek)
    recency_active_days: number    // 90
    recency_sleeping_days: number  // 180
    /** Where the VIP cut-off came from. */
    vip_source?: 'option' | 'quantile' | 'default'
  }
  /** Data quality of the segmentation itself (R-042). */
  quality?: SegmentationQuality
}

export interface SegmentationQuality {
  status: 'ok' | 'warning'
  /** The file has a visit-count column (F). Without it frequency is unknown. */
  frequency_known: boolean
  /** Rows whose last-visit cell could not be read as a date. */
  unparsed_dates: number
  /** Rows whose spend cell could not be read as a number. */
  unparsed_amounts: number
  warnings: string[]
}

export const SEGMENT_LABELS: Record<PatientSegmentId, string> = {
  vip_retention:    'VIP удержание',
  vip_reactivation: 'VIP реактивация',
  loyal_active:     'Лояльные активные',
  churn_risk:       'Риск оттока',
  sleeping:         'Спящие',
  one_time_fresh:   'Разовые свежие',
  one_time_old:     'Разовые старые',
  dead_lead:        'Мёртвые лиды',
}

const SEGMENT_PRIORITY: Record<PatientSegmentId, number> = {
  vip_retention:    1,
  vip_reactivation: 2,
  loyal_active:     3,
  churn_risk:       4,
  sleeping:         5,
  one_time_fresh:   6,
  one_time_old:     7,
  dead_lead:        8,
}

// ── Thresholds (calibrated on Sau Zhurek) ───────────────────────────────────
// These are sensible defaults — a clinic can override via growth_bundles data
// later (Phase 2). For Sau Zhurek base-line:
//   VIP cutoff    = 80 000 ₸ (top 2% of monetary distribution)
//   Active       = within 90 days of last visit
//   Sleeping     = 180+ days
const DEFAULT_VIP_LTV_KZT = 80_000
/** VIP = top 2 % of spend (the Sau Zhurek calibration), from the base's own distribution. */
const VIP_QUANTILE = 0.98
/** Below this many paying patients a 98th percentile is noise: the default stands. */
const MIN_PAYING_FOR_QUANTILE = 50
const DEFAULT_ACTIVE_DAYS = 90
const DEFAULT_SLEEPING_DAYS = 180

function hashPhone(phone: string): string {
  return crypto.createHash('sha256').update(phone).digest('hex').slice(0, 32)
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000)
}

function parsePhoneDigits(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const digits = String(v).replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits
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
 * day-first reader would take it for 4 March. CSV is decoded as UTF-8 and read
 * without value guessing (SheetJS would read «03/04/2026» as 4 March).
 */
export function readPatientSheet(
  buf: ArrayBuffer | Uint8Array | Buffer,
  filename: string,
): { headers: string[]; rows: Array<Record<string, unknown>>; error: string | null } {
  try {
    const ext = (filename.split('.').pop() ?? '').toLowerCase()
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf
    const wb = ext === 'csv' || ext === 'txt'
      ? XLSX.read(new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
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

/** Nearest-rank quantile of a non-empty list. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[idx]
}

interface ColumnMap {
  name_col: string | null
  phone_col: string | null
  last_visit_col: string | null
  visits_col: string | null
  sum_col: string | null
}

function detectColumns(headers: string[]): ColumnMap {
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim()
  const find = (patterns: RegExp[]): string | null => {
    for (const h of headers) if (patterns.some((p) => p.test(norm(h)))) return h
    return null
  }
  // YCLIENTS export columns: Имя, Телефон, Потратил ₸, Количество посещений, Последний визит
  return {
    name_col:       find([/^имя$|фио|имя.*фам|full.*name|клиент/]),
    phone_col:      find([/^телефон$|phone|^mobile|^моб/]),
    last_visit_col: find([/последни[йе].*визит|последни[йе].*при|last.*visit|последн.*посещен|дата.*визит/]),
    visits_col:     find([/количество.*посещ|кол.во.*при|кол.во.*визит|^приём|count.*visit|frequency/]),
    // «всего» alone also matched «Визитов всего»: a visit / count header is never the spend.
    sum_col:        find([/потратил|оплатил|общая.*сумма|^сумма$|сумма.*всего|всего.*сумм|total|ltv|monetary/].map((re) => new RegExp(`^(?!.*(визит|посещ|приём|прием|кол)).*(?:${re.source})`))),
  }
}

function classifySegment(
  /** null = unknown (no visit-count column): recency + spend decide. */
  visits: number | null,
  recencyDays: number | null,
  ltv: number,
  vipThreshold: number,
  activeCutoff: number,
  sleepingCutoff: number,
): PatientSegmentId {
  // S5: 0 visits (dead lead) — known to be 0, or nothing at all (no date, no spend).
  if (visits === 0) return 'dead_lead'
  if (recencyDays === null) {
    // No readable last visit, but visits / spend prove the patient came: not a
    // dead lead — a lapsed patient to reactivate.
    return (visits ?? 0) > 0 || ltv > 0 ? 'sleeping' : 'dead_lead'
  }

  // VIP lane: high LTV
  if (ltv >= vipThreshold) {
    return recencyDays <= activeCutoff ? 'vip_retention' : 'vip_reactivation'
  }

  // Sleeping (>180d)
  if (recencyDays > sleepingCutoff) return 'sleeping'

  // Frequency unknown: recency decides (R + M scheme).
  if (visits === null) return recencyDays <= activeCutoff ? 'loyal_active' : 'churn_risk'

  // Multi-visit path
  if (visits >= 2) {
    return recencyDays <= activeCutoff ? 'loyal_active' : 'churn_risk'
  }

  // Single visit
  return recencyDays <= activeCutoff ? 'one_time_fresh' : 'one_time_old'
}

export interface SegmentPatientsOptions {
  vipThreshold?: number
  activeDays?: number
  sleepingDays?: number
  /** Reference date (default: now). Useful for tests. */
  now?: Date
}

export function segmentPatients(
  buf: ArrayBuffer | Uint8Array | Buffer,
  filename: string,
  opts: SegmentPatientsOptions = {},
): SegmentationResult | null {
  const activeDays = opts.activeDays ?? DEFAULT_ACTIVE_DAYS
  const sleepingDays = opts.sleepingDays ?? DEFAULT_SLEEPING_DAYS
  const now = opts.now ?? new Date()

  const parsed = readPatientSheet(buf, filename)
  if (parsed.error || parsed.headers.length === 0) return null

  const cols = detectColumns(parsed.headers)
  if (!cols.phone_col) return null // can't segment without phones

  // Parse every row first: the VIP cut-off comes from the base's own spend.
  interface ParsedRow { hash: string; displayName: string | null; lastVisit: Date | null; visits: number | null; sum: number }
  const rows: ParsedRow[] = []
  const seenHashes = new Set<string>()
  let unparsedDates = 0
  let unparsedAmounts = 0
  const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== ''

  for (const row of parsed.rows) {
    const phoneDigits = cols.phone_col ? parsePhoneDigits(row[cols.phone_col]) : null
    if (!phoneDigits) continue
    const hash = hashPhone(phoneDigits)
    if (seenHashes.has(hash)) continue  // dedupe
    seenHashes.add(hash)

    const rawDate = cols.last_visit_col ? row[cols.last_visit_col] : null
    const lastVisit = parseDayFirstDate(rawDate)
    if (filled(rawDate) && !lastVisit) unparsedDates++
    const rawSum = cols.sum_col ? row[cols.sum_col] : null
    const parsedSum = parseLocaleNumber(rawSum)
    if (filled(rawSum) && parsedSum === null) unparsedAmounts++
    const visitsRaw = cols.visits_col ? parseLocaleNumber(row[cols.visits_col]) : null
    const visits = cols.visits_col ? Math.max(0, Math.floor(visitsRaw ?? 0)) : null
    const nameRaw = cols.name_col ? String(row[cols.name_col] ?? '').trim() : null
    rows.push({ hash, displayName: nameRaw && nameRaw.length > 0 ? nameRaw.slice(0, 80) : null, lastVisit, visits, sum: Math.max(0, parsedSum ?? 0) })
  }

  const paying = rows.map((r) => r.sum).filter((v) => v > 0)
  const vipSource: 'option' | 'quantile' | 'default' = opts.vipThreshold !== undefined ? 'option' : paying.length >= MIN_PAYING_FOR_QUANTILE ? 'quantile' : 'default'
  const vip = vipSource === 'option' ? (opts.vipThreshold as number) : vipSource === 'quantile' ? quantile(paying, VIP_QUANTILE) : DEFAULT_VIP_LTV_KZT

  const patients: SegmentedPatient[] = rows.map((r) => {
    const recency = r.lastVisit ? Math.max(0, daysBetween(now, r.lastVisit)) : null
    const segment = classifySegment(r.visits, recency, r.sum, vip, activeDays, sleepingDays)
    return {
      patient_hash: r.hash,
      display_name: r.displayName,
      recency_days: recency ?? 99999,
      // Unknown frequency is stored as 1 when the patient demonstrably came (date / spend), else 0.
      frequency: r.visits ?? (recency !== null || r.sum > 0 ? 1 : 0),
      monetary_kzt: Math.round(r.sum),
      segment,
      priority: SEGMENT_PRIORITY[segment],
    }
  })

  const warnings: string[] = []
  if (!cols.visits_col) warnings.push('Нет колонки с количеством посещений: частота неизвестна, сегменты построены по давности визита и сумме (R+M), «Лояльные активные» и «Риск оттока» — без учёта числа визитов')
  if (!cols.last_visit_col) warnings.push('Нет колонки с датой последнего визита: давность неизвестна, пациенты с оплатами отнесены к «Спящим»')
  if (!cols.sum_col) warnings.push('Нет колонки с суммой оплат: VIP-сегменты не выделяются')
  if (unparsedDates > 0) warnings.push(`Даты визита не распознаны: ${unparsedDates} (ожидается ДД.ММ.ГГГГ или ГГГГ-ММ-ДД)`)
  if (unparsedAmounts > 0) warnings.push(`Суммы не распознаны: ${unparsedAmounts}`)
  if (vipSource === 'default') warnings.push(`Мало пациентов с оплатами (${paying.length} < ${MIN_PAYING_FOR_QUANTILE}) для порога VIP по своей базе — взят порог по умолчанию ${DEFAULT_VIP_LTV_KZT.toLocaleString('ru-RU')} ₸`)
  const quality: SegmentationQuality = {
    status: warnings.length ? 'warning' : 'ok',
    frequency_known: !!cols.visits_col,
    unparsed_dates: unparsedDates,
    unparsed_amounts: unparsedAmounts,
    warnings,
  }

  // ── Aggregate summary per segment ────────────────────────────────────────
  const summary: SegmentationSummary[] = []
  for (const id of Object.keys(SEGMENT_LABELS) as PatientSegmentId[]) {
    const inSeg = patients.filter((p) => p.segment === id)
    const totalLtv = inSeg.reduce((s, p) => s + p.monetary_kzt, 0)
    const avgRecency = inSeg.length > 0
      ? inSeg.reduce((s, p) => s + (p.recency_days < 99999 ? p.recency_days : 0), 0) / inSeg.length
      : 0
    summary.push({
      segment: id,
      label: SEGMENT_LABELS[id],
      count: inSeg.length,
      total_ltv_kzt: totalLtv,
      avg_ltv_kzt: inSeg.length > 0 ? Math.round(totalLtv / inSeg.length) : 0,
      avg_recency_days: Math.round(avgRecency),
      priority: SEGMENT_PRIORITY[id],
    })
  }
  summary.sort((a, b) => a.priority - b.priority)

  const withLtv = patients.filter((p) => p.monetary_kzt > 0)
  const totals = {
    total_patients: patients.length,
    total_ltv_kzt: patients.reduce((s, p) => s + p.monetary_kzt, 0),
    // Without a visit count the check is unknown (spend / visits): 0 = «нет данных»,
    // never the whole spend of a patient taken as one check.
    avg_check_kzt: cols.visits_col && withLtv.length > 0
      ? Math.round(withLtv.reduce((s, p) => s + p.monetary_kzt / Math.max(1, p.frequency), 0) / withLtv.length)
      : 0,
    active_last_90d: patients.filter((p) => p.recency_days <= activeDays).length,
    sleeping_180d_plus: patients.filter((p) => p.recency_days > sleepingDays && p.recency_days < 99999).length,
    dead_leads: patients.filter((p) => p.segment === 'dead_lead').length,
  }

  return {
    patients,
    summary,
    totals,
    thresholds: {
      vip_ltv_kzt: vip,
      recency_active_days: activeDays,
      recency_sleeping_days: sleepingDays,
      vip_source: vipSource,
    },
    quality,
  }
}
