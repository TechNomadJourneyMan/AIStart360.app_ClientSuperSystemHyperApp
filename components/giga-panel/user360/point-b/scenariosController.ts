/**
 * components/giga-panel/user360/point-b/scenariosController.ts — the brain of the expert's
 * scenario calculation in a plan draft (plan Phase 2 Task 9), free of React and of the DOM so
 * it can be tested with a fetch double (same approach as planController.ts).
 *
 * Contract (plan Task 7), under /api/giga-admin/users/:id/point-b/plan/versions/:versionId/scenarios:
 *   POST  { profiles?: ScenarioProfile[] } → { ok, data: { result: ModelResult } }
 *         400 invalid profile / model input, 403 not your client, 409 { error: 'not_editable' } when the version is not a draft
 *   PATCH { selectedScenario: 'cautious'|'moderate'|'aggressive'|null } → { ok }
 * Errors are `{ ok:false, error }`; the text of the server is shown as it is.
 *
 * The server is the authority on the profile ranges (normalizeProfiles); the form mirrors them
 * only to avoid obviously doomed requests and to explain the field. Nothing here computes a
 * scenario: the numbers on the screen are the server's.
 */
import type { ModelResult, ScenarioProfile } from '@/lib/point-b/model/types'
import { parseModelResult } from '@/components/point-b/overviewModel'

export type ScenarioKey = ScenarioProfile['key']
export const SCENARIO_KEYS: readonly ScenarioKey[] = ['cautious', 'moderate', 'aggressive']

export type LeverKey = keyof ScenarioProfile['leverMix']
export const LEVER_KEYS: readonly LeverKey[] = ['leads', 'conversion', 'avgCheck', 'repeat']
export const LEVER_LABEL: Record<LeverKey, string> = {
  leads: 'Заявки',
  conversion: 'Конверсия',
  avgCheck: 'Средний чек',
  repeat: 'Повторные покупки',
}

/** Ranges of plan Task 5 (`normalizeProfiles`), in the units of the model. */
export const PROFILE_LIMITS = {
  rampMonths: { min: 1, max: 36 },
  reserveMonths: { min: 0, max: 12 },
  growthCapAnnual: { min: 0.05, max: 3 },
  productivityGain: { min: 0, max: 0.5 },
} as const

/**
 * The three paces of plan Task 5 (`defaultProfiles`). The shares of the levers depend on the
 * industry template on the server (equal shares here); the form seeds from the version's saved
 * profiles as soon as a calculation has stored them.
 */
export const DEFAULT_PROFILES: ScenarioProfile[] = [
  { key: 'cautious', label: 'Осторожный', rampMonths: 18, reserveMonths: 3, productivityGain: 0, growthCapAnnual: 0.25, leverMix: { leads: 0.25, conversion: 0.25, avgCheck: 0.25, repeat: 0.25 } },
  { key: 'moderate', label: 'Умеренный', rampMonths: 12, reserveMonths: 2, productivityGain: 0.05, growthCapAnnual: 0.5, leverMix: { leads: 0.25, conversion: 0.25, avgCheck: 0.25, repeat: 0.25 } },
  { key: 'aggressive', label: 'Ускоренный', rampMonths: 6, reserveMonths: 1, productivityGain: 0.1, growthCapAnnual: 1, leverMix: { leads: 0.25, conversion: 0.25, avgCheck: 0.25, repeat: 0.25 } },
]

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Saved profiles of a draft (`assumptions.profiles`); anything unusable → null (use the defaults). */
export function parseProfiles(v: unknown): ScenarioProfile[] | null {
  if (!Array.isArray(v)) return null
  const out: ScenarioProfile[] = []
  for (const def of DEFAULT_PROFILES) {
    const raw = v.find((p) => isObj(p) && p.key === def.key)
    if (!isObj(raw)) return null
    const mix = isObj(raw.leverMix) ? raw.leverMix : null
    if (!mix || !LEVER_KEYS.every((k) => finite(mix[k]) && (mix[k] as number) >= 0)) return null
    if (![raw.rampMonths, raw.reserveMonths, raw.productivityGain, raw.growthCapAnnual].every(finite)) return null
    out.push({
      key: def.key,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : def.label,
      rampMonths: raw.rampMonths as number,
      reserveMonths: raw.reserveMonths as number,
      productivityGain: raw.productivityGain as number,
      growthCapAnnual: raw.growthCapAnnual as number,
      leverMix: { leads: mix.leads as number, conversion: mix.conversion as number, avgCheck: mix.avgCheck as number, repeat: mix.repeat as number },
    })
  }
  return out
}

// ── The profile form ────────────────────────────────────────────────────

/** Every field is the text of an input; shares and rates are in percent. */
export interface ProfileForm {
  key: ScenarioKey
  label: string
  rampMonths: string
  reserveMonths: string
  growthCapPct: string
  productivityGainPct: string
  mix: Record<LeverKey, string>
}

export type ProfileField = 'rampMonths' | 'reserveMonths' | 'growthCapPct' | 'productivityGainPct' | 'mix'
export type ProfileErrors = Partial<Record<ProfileField, string>>

const txt = (n: number): string => String(Math.round(n * 1000) / 1000)

export function profileToForm(p: ScenarioProfile): ProfileForm {
  return {
    key: p.key,
    label: p.label,
    rampMonths: txt(p.rampMonths),
    reserveMonths: txt(p.reserveMonths),
    growthCapPct: txt(p.growthCapAnnual * 100),
    productivityGainPct: txt(p.productivityGain * 100),
    mix: {
      leads: txt(p.leverMix.leads * 100),
      conversion: txt(p.leverMix.conversion * 100),
      avgCheck: txt(p.leverMix.avgCheck * 100),
      repeat: txt(p.leverMix.repeat * 100),
    },
  }
}

const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')))

export function mixSum(mix: Record<LeverKey, string>): number {
  return LEVER_KEYS.reduce((a, k) => a + (Number.isFinite(num(mix[k])) ? num(mix[k]) : 0), 0)
}

/** Shares in percent that sum to exactly 100 (one decimal); null when nothing can be normalised. */
export function normalizeMixPercent(mix: Record<LeverKey, string>): Record<LeverKey, number> | null {
  const raw = LEVER_KEYS.map((k) => num(mix[k]))
  if (raw.some((x) => !Number.isFinite(x) || x < 0)) return null
  const total = raw.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  const shares = raw.map((x) => Math.round((x / total) * 1000) / 10)
  const diff = Math.round((100 - shares.reduce((a, b) => a + b, 0)) * 10) / 10
  if (diff !== 0) {
    const i = shares.indexOf(Math.max(...shares))
    shares[i] = Math.round((shares[i] + diff) * 10) / 10
  }
  return { leads: shares[0], conversion: shares[1], avgCheck: shares[2], repeat: shares[3] }
}

/** The form with its lever shares brought to 100%. */
export function normalizeForm(f: ProfileForm): ProfileForm {
  const n = normalizeMixPercent(f.mix)
  return n ? { ...f, mix: { leads: txt(n.leads), conversion: txt(n.conversion), avgCheck: txt(n.avgCheck), repeat: txt(n.repeat) } } : f
}

function rangeError(v: number, min: number, max: number, unit: string, label: string): string | undefined {
  if (!Number.isFinite(v)) return `${label}: введите число`
  if (v < min || v > max) return `${label}: от ${min} до ${max}${unit}`
  return undefined
}

export function validateProfileForm(f: ProfileForm): { ok: true; profile: ScenarioProfile } | { ok: false; errors: ProfileErrors } {
  const L = PROFILE_LIMITS
  const ramp = num(f.rampMonths)
  const reserve = num(f.reserveMonths)
  const cap = num(f.growthCapPct)
  const gain = num(f.productivityGainPct)
  const errors: ProfileErrors = {}
  const e1 = rangeError(ramp, L.rampMonths.min, L.rampMonths.max, ' мес.', 'Срок выхода')
  const e2 = rangeError(reserve, L.reserveMonths.min, L.reserveMonths.max, ' мес.', 'Резерв')
  const e3 = rangeError(cap, L.growthCapAnnual.min * 100, L.growthCapAnnual.max * 100, '%', 'Потолок роста')
  const e4 = rangeError(gain, L.productivityGain.min * 100, L.productivityGain.max * 100, '%', 'Прирост производительности')
  if (e1) errors.rampMonths = e1
  if (e2) errors.reserveMonths = e2
  if (e3) errors.growthCapPct = e3
  if (e4) errors.productivityGainPct = e4
  const mix = normalizeMixPercent(f.mix)
  if (!mix) errors.mix = 'Доли вклада рычагов: числа не меньше нуля, сумма больше нуля'
  if (Object.keys(errors).length || !mix) return { ok: false, errors }
  return {
    ok: true,
    profile: {
      key: f.key,
      label: f.label,
      rampMonths: ramp,
      reserveMonths: reserve,
      productivityGain: gain / 100,
      growthCapAnnual: cap / 100,
      leverMix: { leads: mix.leads / 100, conversion: mix.conversion / 100, avgCheck: mix.avgCheck / 100, repeat: mix.repeat / 100 },
    },
  }
}

/** All three forms → the profiles to send; the first problems otherwise. */
export function validateForms(forms: ProfileForm[]): { ok: true; profiles: ScenarioProfile[] } | { ok: false; errors: Partial<Record<ScenarioKey, ProfileErrors>> } {
  const profiles: ScenarioProfile[] = []
  const errors: Partial<Record<ScenarioKey, ProfileErrors>> = {}
  for (const f of forms) {
    const r = validateProfileForm(f)
    if (r.ok) profiles.push(r.profile)
    else errors[f.key] = r.errors
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, profiles }
}

// ── Requests ────────────────────────────────────────────────────────────

export interface ScenarioError { message: string; status: number }

const DEFAULT_ERROR: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  400: 'Сервер отклонил параметры темпа — проверьте значения',
  401: 'Сессия закончилась — войдите заново',
  403: 'Недостаточно прав или клиент вам не назначен',
  404: 'Версия не найдена',
  409: 'Сценарии можно менять только в черновике — обновите страницу',
}

export interface ScenariosSnapshot {
  busy: 'compute' | 'select' | null
  /** Result of the last calculation, for the version it was made for. */
  result: { versionId: string; model: ModelResult } | null
  /** A pace chosen in this session (the version on the server follows after the reload); undefined = nothing chosen here. */
  selected: { versionId: string; key: ScenarioKey | null } | null
  notice: string | null
  error: ScenarioError | null
}

export class ScenariosController {
  private snap: ScenariosSnapshot = { busy: null, result: null, selected: null, notice: null, error: null }
  private listeners = new Set<() => void>()

  constructor(private readonly userId: string, private readonly fetchFn: typeof fetch) {}

  private url(versionId: string): string {
    return `/api/giga-admin/users/${this.userId}/point-b/plan/versions/${encodeURIComponent(versionId)}/scenarios`
  }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): ScenariosSnapshot => this.snap

  private set(patch: Partial<ScenariosSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  setError(message: string): void { this.set({ error: { message, status: 400 }, notice: null }) }
  dismiss(): void { this.set({ error: null, notice: null }) }

  private async call(method: 'POST' | 'PATCH', versionId: string, json: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
    try {
      const res = await this.fetchFn(this.url(versionId), {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      })
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return { ok: res.ok && body?.ok !== false, status: res.status, body }
    } catch {
      return { ok: false, status: 0, body: null }
    }
  }

  private toError(r: { status: number; body: Record<string, unknown> | null }): ScenarioError {
    const text = typeof r.body?.error === 'string' && r.body.error.trim() ? r.body.error : typeof r.body?.message === 'string' ? r.body.message : ''
    return { message: text || DEFAULT_ERROR[r.status] || `Ошибка сервера (${r.status})`, status: r.status }
  }

  /** «Рассчитать сценарии». `profiles` are sent only when the expert edited them; otherwise the server uses the template defaults. */
  async compute(versionId: string, profiles?: ScenarioProfile[]): Promise<boolean> {
    if (this.snap.busy) return false
    this.set({ busy: 'compute', error: null, notice: null })
    const r = await this.call('POST', versionId, profiles ? { profiles } : {})
    const model = r.ok && isObj(r.body?.data) ? parseModelResult((r.body!.data as Record<string, unknown>).result) : null
    if (!model) {
      this.set({ busy: null, error: r.ok ? { message: 'Сервер вернул расчёт, который не удалось прочитать', status: r.status } : this.toError(r) })
      return false
    }
    this.set({ busy: null, result: { versionId, model }, notice: 'Сценарии рассчитаны и сохранены в черновике' })
    return true
  }

  /** «Выбрать темп для плана» (null — снять выбор). */
  async select(versionId: string, key: ScenarioKey | null): Promise<boolean> {
    if (key !== null && !SCENARIO_KEYS.includes(key)) {
      this.set({ error: { message: 'Выберите один из трёх темпов', status: 400 }, notice: null })
      return false
    }
    if (this.snap.busy) return false
    this.set({ busy: 'select', error: null, notice: null })
    const r = await this.call('PATCH', versionId, { selectedScenario: key })
    if (!r.ok) {
      this.set({ busy: null, error: this.toError(r) })
      return false
    }
    this.set({ busy: null, selected: { versionId, key }, notice: key ? 'Темп выбран для плана' : 'Выбор темпа снят' })
    return true
  }
}
