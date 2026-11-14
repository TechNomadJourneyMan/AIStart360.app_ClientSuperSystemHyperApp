/**
 * lib/format/gri.ts — the ONE scale, formatter and zones of the GRI index (R-036).
 *
 * The GRI index is 0–10: the canonical formula (lib/gri-assessment/score.ts —
 * mean of the 7 section means, criteria scored 1–10) stores
 * gri_assessments.gri_index on that scale. Every screen, report, bot message
 * and AI prompt shows it through formatGri(): one decimal, a dot, «нет данных»
 * instead of 0, and colours / statuses from GRI_ZONES only.
 *
 * Other instruments that used to be called «GRI» on a 0–100 scale (the public
 * Mini-GRI, lib/gri/logic.ts) are converted explicitly with griFromPercent();
 * Point A (diagnostics.overall_score, 0–100) is NOT GRI and must never be shown
 * under a GRI label.
 *
 * Client-safe: no server-only imports.
 */

export const GRI_SCALE_MAX = 10

export type GriZoneKey = 'critical' | 'developing' | 'strong' | 'excellent'
export type GriTone = 'red' | 'amber' | 'green'

export interface GriZone {
  key: GriZoneKey
  /** Lower bound on the 0–10 scale, inclusive. */
  min: number
  label: string
  tone: GriTone
}

/**
 * THE GRI thresholds — the only place they are defined. Ascending by `min`:
 * < 4 critical, 4–6 developing, 6–8 strong, ≥ 8 excellent (the bands
 * /api/admin/overview and the portfolio distribution already used).
 */
export const GRI_ZONES: readonly GriZone[] = [
  { key: 'critical', min: 0, label: 'Критично', tone: 'red' },
  { key: 'developing', min: 4, label: 'Развивается', tone: 'amber' },
  { key: 'strong', min: 6, label: 'Устойчиво', tone: 'green' },
  { key: 'excellent', min: 8, label: 'Отлично', tone: 'green' },
] as const

/** «Требует внимания»: GRI below this value (the critical zone). */
export const GRI_ATTENTION_BELOW = 4

/** Colours of the tones (brand tokens used across the portal). */
export const GRI_TONE_HEX: Record<GriTone, string> = {
  red: '#ff6b6b',
  amber: '#ffbd60',
  green: '#6effc0',
}

/** Tailwind text classes of the tones (dark theme tokens). */
export const GRI_TONE_TEXT_CLASS: Record<GriTone, string> = {
  red: 'text-error',
  amber: 'text-amber-300',
  green: 'text-primary',
}

export const GRI_NO_DATA = 'нет данных'

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v.replace(',', '.'))
  return NaN
}

/**
 * A GRI value on the 0–10 scale, or null for «нет данных».
 * 0 is «not answered» in the canonical formula, so it is null too; negatives,
 * values above 10 and non-numbers are null (never silently rescaled).
 */
export function toGri(value: unknown): number | null {
  const n = toNumber(value)
  return Number.isFinite(n) && n > 0 && n <= GRI_SCALE_MAX ? n : null
}

/**
 * Explicit conversion of a 0–100 score (Mini-GRI, lib/gri/logic.ts) to the GRI
 * scale: 62 → 6.2. Null for missing / out-of-range values. 0 stays 0 — in the
 * 0–100 engines it is a real (worst) result; show it with
 * formatGri(v, { allowZero: true }).
 */
export function griFromPercent(value: unknown): number | null {
  const n = toNumber(value)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n) / 10
}

/** Round to the display precision (one decimal). */
export function roundGri(value: number): number {
  return Math.round(value * 10) / 10
}

export interface FormatGriOptions {
  /** Append « / 10». Default false. */
  scale?: boolean
  /** Text for «нет данных». Default «нет данных». */
  empty?: string
  /**
   * Treat 0 as a score (0.0), not as «нет данных». Only for converted 0–100
   * instruments (Mini-GRI); in the canonical formula 0 means «not answered».
   */
  allowZero?: boolean
}

/**
 * THE GRI formatter: «6.2», with `scale` — «6.2 / 10»; null / 0 / garbage →
 * «нет данных» (or `empty`).
 */
export function formatGri(value: unknown, opts: FormatGriOptions = {}): string {
  const v = opts.allowZero && toNumber(value) === 0 ? 0 : toGri(value)
  if (v === null) return opts.empty ?? GRI_NO_DATA
  const s = roundGri(v).toFixed(1)
  return opts.scale ? `${s} / ${GRI_SCALE_MAX}` : s
}

/** A change of the index: «+0.3», «−0.2», «0.0». Null / non-finite → empty. */
export function formatGriDelta(delta: unknown, opts: { empty?: string } = {}): string {
  const n = toNumber(delta)
  if (!Number.isFinite(n)) return opts.empty ?? GRI_NO_DATA
  const r = roundGri(n)
  if (r === 0) return '0.0'
  return r > 0 ? `+${r.toFixed(1)}` : `−${Math.abs(r).toFixed(1)}`
}

/** The zone of a GRI value, or null for «нет данных». */
export function griZone(value: unknown): GriZone | null {
  const v = toGri(value)
  if (v === null) return null
  let zone = GRI_ZONES[0]
  for (const z of GRI_ZONES) if (v >= z.min) zone = z
  return zone
}

/** Tone of a GRI value (null for «нет данных»). */
export function griTone(value: unknown): GriTone | null {
  return griZone(value)?.tone ?? null
}

/** Hex colour of a GRI value; `fallback` for «нет данных». */
export function griColor(value: unknown, fallback = 'rgba(255,255,255,0.4)'): string {
  const t = griTone(value)
  return t ? GRI_TONE_HEX[t] : fallback
}

/** Share of the scale, 0–100 (bar widths, gauges); 0 for «нет данных». */
export function griPercentOfScale(value: unknown): number {
  const v = toGri(value)
  return v === null ? 0 : Math.round((v / GRI_SCALE_MAX) * 100)
}

/** «Требует внимания» — has a GRI and it is in the critical zone. */
export function griNeedsAttention(value: unknown): boolean {
  const v = toGri(value)
  return v !== null && v < GRI_ATTENTION_BELOW
}

/** Mean of the GRI values that have data (null when none), at full precision. */
export function meanGri(values: ReadonlyArray<unknown>): number | null {
  const xs = values.map(toGri).filter((v): v is number => v !== null)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}
