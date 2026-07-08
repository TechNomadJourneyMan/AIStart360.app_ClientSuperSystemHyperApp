import { DEFAULT_SCORES } from '@/lib/gri-calculator/gri-data'

const CATEGORY_KEYS = Object.keys(DEFAULT_SCORES)

export interface CalcSessionInput {
  name: string
  scores: Record<string, number>
  gri_index: number
  niche: string
  size: string
  note: string | null
}

export type ValidateResult =
  | { ok: true; value: CalcSessionInput }
  | { ok: false; error: string }

export function validateCalcSession(body: unknown): ValidateResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' }
  const b = body as Record<string, unknown>
  const rawScores = b.scores
  if (!rawScores || typeof rawScores !== 'object') return { ok: false, error: 'scores required' }
  const scores: Record<string, number> = {}
  for (const key of CATEGORY_KEYS) {
    const v = (rawScores as Record<string, unknown>)[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 10) {
      return { ok: false, error: `score "${key}" must be a number 1..10` }
    }
    scores[key] = v
  }
  const mean = CATEGORY_KEYS.reduce((s, k) => s + scores[k], 0) / CATEGORY_KEYS.length
  const name = String(b.name ?? '').trim().slice(0, 80)
  const note = b.note == null ? null : String(b.note).trim().slice(0, 500) || null
  const niche = String(b.niche ?? 'general').slice(0, 40)
  const size = String(b.size ?? 'small').slice(0, 40)
  return {
    ok: true,
    value: { name, scores, gri_index: Math.round(mean * 100) / 100, niche, size, note },
  }
}
