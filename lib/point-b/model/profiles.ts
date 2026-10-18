/**
 * lib/point-b/model/profiles.ts — the three pace profiles (spec §9.4): vectors of parameters, not
 * coefficients. The defaults are documented here; the expert edits them per client and
 * `normalizeProfiles` checks what he sends. Pure.
 */
import { ModelInputError, type ScenarioProfile, type TemplateKey } from './types'

type Mix = ScenarioProfile['leverMix']

/** Shares of the contribution of each lever to the growth, by industry template (sum 1). */
const LEVER_MIX: Record<TemplateKey, Mix> = {
  ecommerce: { leads: 0.35, conversion: 0.25, avgCheck: 0.15, repeat: 0.25 },
  services: { leads: 0.3, conversion: 0.35, avgCheck: 0.2, repeat: 0.15 },
  production: { leads: 0.25, conversion: 0.25, avgCheck: 0.25, repeat: 0.25 },
  default: { leads: 0.25, conversion: 0.25, avgCheck: 0.25, repeat: 0.25 },
}

export const PROFILE_KEYS: ReadonlyArray<ScenarioProfile['key']> = ['cautious', 'moderate', 'aggressive']

/** Allowed ranges of what the expert may edit (spec §9.4). */
export const PROFILE_LIMITS = {
  rampMonths: { min: 1, max: 36 },
  reserveMonths: { min: 0, max: 12 },
  growthCapAnnual: { min: 0.05, max: 3 },
  productivityGain: { min: 0, max: 0.5 },
} as const

export function defaultProfiles(template: TemplateKey): ScenarioProfile[] {
  const mix = LEVER_MIX[template] ?? LEVER_MIX.default
  const make = (key: ScenarioProfile['key'], label: string, rampMonths: number, reserveMonths: number, productivityGain: number, growthCapAnnual: number): ScenarioProfile => ({
    key, label, rampMonths, reserveMonths, productivityGain, growthCapAnnual, leverMix: { ...mix },
  })
  return [
    make('cautious', 'Осторожный', 18, 3, 0, 0.25),
    make('moderate', 'Умеренный', 12, 2, 0.05, 0.5),
    make('aggressive', 'Агрессивный', 6, 1, 0.1, 1.0),
  ]
}

const NAME: Record<string, string> = {
  rampMonths: 'Срок выхода рычагов на целевой уровень',
  reserveMonths: 'Резерв ликвидности',
  growthCapAnnual: 'Потолок годового роста',
  productivityGain: 'Прирост производительности',
}

function numberIn(raw: unknown, key: keyof typeof PROFILE_LIMITS, profile: string, integer: boolean): number {
  const { min, max } = PROFILE_LIMITS[key]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new ModelInputError(`${NAME[key]} («${profile}»): нужно число`)
  if (integer && !Number.isInteger(raw)) throw new ModelInputError(`${NAME[key]} («${profile}»): нужно целое число`)
  if (raw < min || raw > max) throw new ModelInputError(`${NAME[key]} («${profile}»): допустимо от ${min} до ${max}`)
  return raw
}

function mixOf(raw: unknown, profile: string, fallback: Mix): Mix {
  if (raw === undefined || raw === null) return { ...fallback }
  if (typeof raw !== 'object') throw new ModelInputError(`Доли вклада рычагов («${profile}»): нужен объект`)
  const o = raw as Record<string, unknown>
  const out: Mix = { leads: 0, conversion: 0, avgCheck: 0, repeat: 0 }
  let sum = 0
  for (const k of ['leads', 'conversion', 'avgCheck', 'repeat'] as const) {
    const v = o[k] === undefined ? fallback[k] : o[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new ModelInputError(`Доли вклада рычагов («${profile}»): значения не могут быть отрицательными`)
    out[k] = v
    sum += v
  }
  if (!(sum > 0)) throw new ModelInputError(`Доли вклада рычагов («${profile}»): хотя бы один рычаг должен давать вклад`)
  return { leads: out.leads / sum, conversion: out.conversion / sum, avgCheck: out.avgCheck / sum, repeat: out.repeat / sum }
}

/**
 * What the expert sent → three valid profiles. `input` is an array of (partial) profiles with a
 * `key`, or an object keyed by the profile key; nothing at all gives the defaults, a profile that is
 * not mentioned keeps its defaults, a missing field keeps the default of that profile. Labels are
 * fixed (not editable). Anything out of range → ModelInputError with a text for the user.
 */
export function normalizeProfiles(input: unknown, template: TemplateKey): ScenarioProfile[] {
  const defaults = defaultProfiles(template)
  if (input === undefined || input === null) return defaults

  let items: Array<Record<string, unknown>>
  if (Array.isArray(input)) {
    items = input as Array<Record<string, unknown>>
  } else if (typeof input === 'object') {
    items = Object.entries(input as Record<string, unknown>).map(([key, v]) => ({ ...(v as Record<string, unknown>), key }))
  } else {
    throw new ModelInputError('Профили темпа: нужен список профилей')
  }

  const byKey = new Map<string, Record<string, unknown>>()
  for (const it of items) {
    if (!it || typeof it !== 'object' || typeof it.key !== 'string' || !(PROFILE_KEYS as readonly string[]).includes(it.key)) {
      throw new ModelInputError('Профили темпа: допустимы осторожный, умеренный и агрессивный')
    }
    if (byKey.has(it.key)) throw new ModelInputError('Профили темпа: профиль указан дважды')
    byKey.set(it.key, it)
  }

  return defaults.map((d) => {
    const given = byKey.get(d.key)
    if (!given) return d
    const pick = <K extends keyof typeof PROFILE_LIMITS>(key: K, integer: boolean): number =>
      given[key] === undefined ? d[key] : numberIn(given[key], key, d.label, integer)
    return {
      key: d.key,
      label: d.label,
      rampMonths: pick('rampMonths', true),
      reserveMonths: pick('reserveMonths', true),
      productivityGain: pick('productivityGain', false),
      growthCapAnnual: pick('growthCapAnnual', false),
      leverMix: mixOf(given.leverMix, d.label, d.leverMix),
    }
  })
}
