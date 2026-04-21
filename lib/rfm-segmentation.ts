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

import crypto from 'crypto'
import { parseFileBuffer } from '@/lib/data-quality'

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
    vip_ltv_kzt: number       // 80 000 ₸ for Sau Zhurek
    recency_active_days: number    // 90
    recency_sleeping_days: number  // 180
  }
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

function parseDateLenient(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v
  if (typeof v === 'number' && v > 25000 && v < 60000) {
    // Excel serial
    const epoch = new Date(Date.UTC(1899, 11, 30))
    return new Date(epoch.getTime() + v * 86_400_000)
  }
  const s = String(v).trim()
  const iso = Date.parse(s)
  if (!isNaN(iso)) return new Date(iso)
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (m) {
    const [, d, mo, y] = m
    const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10)
    return new Date(year, parseInt(mo, 10) - 1, parseInt(d, 10))
  }
  return null
}

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/\s/g, '').replace(/[,₸]/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

interface ColumnMap {
  name_col: string | null
  phone_col: string | null
  last_visit_col: string | null
  visits_col: string | null
  sum_col: string | null
}

function detectColumns(headers: string[]): ColumnMap {
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
  const find = (patterns: RegExp[]): string | null => {
    for (const h of headers) if (patterns.some((p) => p.test(norm(h)))) return h
    return null
  }
  return {
    name_col:       find([/фио|имя.*фам|full.*name|клиент/]),
    phone_col:      find([/телефон|phone|mobile|моб/]),
    last_visit_col: find([/последни[йе].*при|last.*visit|последн.*посещен|дата.*визит/]),
    visits_col:     find([/кол.во.*при|приём|визит.*всего|count.*visit|frequency/]),
    sum_col:        find([/общая.*сумма|сумма|всего|total|ltv|monetary/]),
  }
}

function classifySegment(
  visits: number,
  recencyDays: number | null,
  ltv: number,
  vipThreshold: number,
  activeCutoff: number,
  sleepingCutoff: number,
): PatientSegmentId {
  // S5: 0 visits (dead lead)
  if (visits === 0 || recencyDays === null) return 'dead_lead'

  // VIP lane: high LTV
  if (ltv >= vipThreshold) {
    return recencyDays <= activeCutoff ? 'vip_retention' : 'vip_reactivation'
  }

  // Sleeping (>180d)
  if (recencyDays > sleepingCutoff) return 'sleeping'

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
  const vip = opts.vipThreshold ?? DEFAULT_VIP_LTV_KZT
  const activeDays = opts.activeDays ?? DEFAULT_ACTIVE_DAYS
  const sleepingDays = opts.sleepingDays ?? DEFAULT_SLEEPING_DAYS
  const now = opts.now ?? new Date()

  const parsed = parseFileBuffer(buf, filename)
  if (parsed.error || parsed.headers.length === 0) return null

  const cols = detectColumns(parsed.headers)
  if (!cols.phone_col) return null // can't segment without phones

  const patients: SegmentedPatient[] = []
  const seenHashes = new Set<string>()

  for (const row of parsed.rows) {
    const phoneDigits = cols.phone_col ? parsePhoneDigits(row[cols.phone_col]) : null
    if (!phoneDigits) continue
    const hash = hashPhone(phoneDigits)
    if (seenHashes.has(hash)) continue  // dedupe
    seenHashes.add(hash)

    const lastVisit = cols.last_visit_col ? parseDateLenient(row[cols.last_visit_col]) : null
    const visits = cols.visits_col ? (parseNumber(row[cols.visits_col]) ?? 0) : 0
    const sum = cols.sum_col ? (parseNumber(row[cols.sum_col]) ?? 0) : 0
    const nameRaw = cols.name_col ? String(row[cols.name_col] ?? '').trim() : null
    const displayName = nameRaw && nameRaw.length > 0 ? nameRaw.slice(0, 80) : null

    const recency = lastVisit ? Math.max(0, daysBetween(now, lastVisit)) : null
    const segment = classifySegment(Math.max(0, Math.floor(visits)), recency, sum, vip, activeDays, sleepingDays)

    patients.push({
      patient_hash: hash,
      display_name: displayName,
      recency_days: recency ?? 99999,
      frequency: Math.max(0, Math.floor(visits)),
      monetary_kzt: Math.round(sum),
      segment,
      priority: SEGMENT_PRIORITY[segment],
    })
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
    avg_check_kzt: withLtv.length > 0
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
    },
  }
}
