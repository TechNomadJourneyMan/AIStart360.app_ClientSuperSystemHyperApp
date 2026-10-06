/**
 * lib/integrations/signals.ts — integration facts → metric signals.
 *
 * The ONE place that turns integration_facts into numbers: the metrics
 * resolver (ResolverContext.externalSignals → public.metrics with source
 * 'external') and the e-commerce dashboard (per-provider block) both call
 * these functions, so a number can never differ between surfaces.
 *
 * Rules:
 *   • Window: the last SIGNAL_WINDOW_DAYS complete days that a provider has
 *     facts for, ending no earlier than MAX_STALENESS_DAYS ago. A flow signal
 *     needs every day of the window (a missing day = no signal, never a
 *     partial sum presented as a month).
 *   • No summing across providers: МойСклад usually already contains the
 *     marketplace orders, GA4 and Метрика count the same visits. Each signal
 *     takes the first provider in its priority list that has a complete window.
 *   • Money signals feed ₸ metrics only when the facts are in KZT.
 *   • Snapshot signals (SKU) take the newest fact not older than 7 days.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, dayOf } from './period'
import type { FactKey } from './facts'
import { isProviderKey, type ProviderKey } from './registry'

export const SIGNAL_WINDOW_DAYS = 30
export const MAX_STALENESS_DAYS = 4
export const SNAPSHOT_MAX_AGE_DAYS = 7
/** Facts read per company (35 days × ~14 keys × a few providers fits easily). */
export const FACTS_READ_LIMIT = 5000

/** External-source systems declared on metrics (lib/metrics/descriptions.ts). */
export const INTEGRATION_SYSTEMS = {
  sessions_month: 'integration:sessions_month',
  aov: 'integration:aov',
  sku_count: 'integration:sku_count',
  sku_in_stock: 'integration:sku_in_stock',
  returns_rate: 'integration:returns_rate',
} as const

export type IntegrationSystem = (typeof INTEGRATION_SYSTEMS)[keyof typeof INTEGRATION_SYSTEMS]

export const INTEGRATION_SYSTEM_PREFIX = 'integration:'

export interface FactLike {
  provider: string
  metric_key: string
  period_start: string
  period_end: string
  value: number | string
  unit: string | null
  fetched_at: string
}

/** Provenance of a signal: copied into public.metrics.provenance.external. */
export interface IntegrationSignal {
  value: number
  unit: string
  provider: ProviderKey
  period_start: string
  period_end: string
  /** Newest fetched_at among the facts used. */
  fetched_at: string
  days: number
  basis: string
}

interface Daily {
  byDay: Map<string, number>
  unit: string | null
  fetchedAt: string
}

type Index = Map<ProviderKey, Map<FactKey | string, Daily>>

const DAY = /^\d{4}-\d{2}-\d{2}$/

function toDay(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const d = v.slice(0, 10)
  return DAY.test(d) ? d : null
}

function numeric(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function index(facts: readonly FactLike[]): Index {
  const out: Index = new Map()
  for (const f of facts) {
    if (!isProviderKey(f.provider)) continue
    const start = toDay(f.period_start)
    const end = toDay(f.period_end)
    const value = numeric(f.value)
    if (!start || !end || start !== end || value === null) continue
    let byKey = out.get(f.provider)
    if (!byKey) out.set(f.provider, (byKey = new Map()))
    let d = byKey.get(f.metric_key)
    if (!d) byKey.set(f.metric_key, (d = { byDay: new Map(), unit: f.unit, fetchedAt: f.fetched_at }))
    d.byDay.set(start, value)
    if (f.unit) d.unit = f.unit
    if (String(f.fetched_at) > String(d.fetchedAt)) d.fetchedAt = String(f.fetched_at)
  }
  return out
}

export interface Window {
  start: string
  end: string
  days: string[]
}

/** The provider's latest complete window for `key`, or null (stale / gaps). */
function windowFor(d: Daily | undefined, now: Date): Window | null {
  if (!d || !d.byDay.size) return null
  const today = dayOf(now)
  const end = [...d.byDay.keys()].filter((k) => k < today).sort().pop()
  if (!end || end < addDays(today, -MAX_STALENESS_DAYS)) return null
  const start = addDays(end, -(SIGNAL_WINDOW_DAYS - 1))
  const days: string[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (!d.byDay.has(day)) return null
    days.push(day)
  }
  return { start, end, days }
}

function sumOver(d: Daily, w: Window): number {
  return w.days.reduce((s, day) => s + (d.byDay.get(day) ?? 0), 0)
}

/** Sum of a flow fact over the provider's complete window. */
export function flowTotal(idx: Index, provider: ProviderKey, key: FactKey, now: Date): { value: number; unit: string | null; window: Window; fetchedAt: string } | null {
  const d = idx.get(provider)?.get(key)
  const w = windowFor(d, now)
  if (!d || !w) return null
  return { value: sumOver(d, w), unit: d.unit, window: w, fetchedAt: d.fetchedAt }
}

/** Ratio of two flow facts over the SAME window. */
function ratioOver(idx: Index, provider: ProviderKey, num: FactKey, den: FactKey, now: Date) {
  const a = idx.get(provider)?.get(num)
  const b = idx.get(provider)?.get(den)
  const w = windowFor(b, now)
  if (!a || !b || !w || w.days.some((day) => !a.byDay.has(day))) return null
  const denominator = sumOver(b, w)
  if (denominator <= 0) return null
  return { numerator: sumOver(a, w), denominator, window: w, unitNum: a.unit, fetchedAt: a.fetchedAt > b.fetchedAt ? a.fetchedAt : b.fetchedAt }
}

function snapshot(idx: Index, provider: ProviderKey, key: FactKey, now: Date): { value: number; day: string; unit: string | null; fetchedAt: string } | null {
  const d = idx.get(provider)?.get(key)
  if (!d) return null
  const day = [...d.byDay.keys()].sort().pop()
  if (!day || day < addDays(dayOf(now), -SNAPSHOT_MAX_AGE_DAYS)) return null
  return { value: d.byDay.get(day) as number, day, unit: d.unit, fetchedAt: d.fetchedAt }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Priority of providers per signal (first complete one wins; no cross-provider sums). */
export const SIGNAL_PROVIDER_PRIORITY: Readonly<Record<keyof typeof INTEGRATION_SYSTEMS, readonly ProviderKey[]>> = {
  sessions_month: ['ga4', 'yandex_metrika'],
  aov: ['shopify', 'ga4', 'kaspi', 'moysklad'],
  sku_count: ['moysklad'],
  sku_in_stock: ['moysklad'],
  returns_rate: ['moysklad', 'wildberries', 'kaspi'],
}

const AOV_FACTS: Partial<Record<ProviderKey, [FactKey, FactKey]>> = {
  shopify: ['orders_amount', 'orders_count'],
  ga4: ['web_revenue', 'web_purchases'],
  kaspi: ['revenue', 'sales_count'],
  moysklad: ['revenue', 'sales_count'],
}

/** Signals keyed by external-source system (ResolverContext.externalSignals). */
export function buildIntegrationSignals(facts: readonly FactLike[], now: Date): Record<string, IntegrationSignal> {
  const idx = index(facts)
  const out: Record<string, IntegrationSignal> = {}

  for (const p of SIGNAL_PROVIDER_PRIORITY.sessions_month) {
    const t = flowTotal(idx, p, 'sessions', now)
    if (!t) continue
    out[INTEGRATION_SYSTEMS.sessions_month] = {
      value: Math.round(t.value), unit: 'count', provider: p, period_start: t.window.start, period_end: t.window.end,
      fetched_at: t.fetchedAt, days: t.window.days.length, basis: `визиты за ${t.window.days.length} дней`,
    }
    break
  }

  for (const p of SIGNAL_PROVIDER_PRIORITY.aov) {
    const pair = AOV_FACTS[p]
    if (!pair) continue
    const r = ratioOver(idx, p, pair[0], pair[1], now)
    if (!r || r.unitNum !== 'KZT') continue
    out[INTEGRATION_SYSTEMS.aov] = {
      value: round2(r.numerator / r.denominator), unit: 'KZT', provider: p, period_start: r.window.start, period_end: r.window.end,
      fetched_at: r.fetchedAt, days: r.window.days.length, basis: `${pair[0]} / ${pair[1]} за ${r.window.days.length} дней`,
    }
    break
  }

  for (const [system, key] of [['sku_count', 'sku_count'], ['sku_in_stock', 'sku_in_stock']] as const) {
    for (const p of SIGNAL_PROVIDER_PRIORITY[system]) {
      const s = snapshot(idx, p, key, now)
      if (!s) continue
      out[INTEGRATION_SYSTEMS[system]] = {
        value: s.value, unit: 'count', provider: p, period_start: s.day, period_end: s.day,
        fetched_at: s.fetchedAt, days: 1, basis: `состояние на ${s.day}`,
      }
      break
    }
  }

  for (const p of SIGNAL_PROVIDER_PRIORITY.returns_rate) {
    const r = ratioOver(idx, p, 'returns_count', 'sales_count', now)
    if (!r) continue
    out[INTEGRATION_SYSTEMS.returns_rate] = {
      value: round2((r.numerator / r.denominator) * 100), unit: '%', provider: p, period_start: r.window.start, period_end: r.window.end,
      fetched_at: r.fetchedAt, days: r.window.days.length, basis: `возвраты / продажи за ${r.window.days.length} дней`,
    }
    break
  }
  return out
}

// ── Dashboard: per-provider 30-day summary (same window rules) ──────────────

export interface ProviderSummary {
  provider: ProviderKey
  periodStart: string | null
  periodEnd: string | null
  fetchedAt: string | null
  /** Flow totals over the provider's complete window: value + unit. */
  totals: Partial<Record<FactKey, { value: number; unit: string | null }>>
  snapshots: Partial<Record<FactKey, { value: number; day: string }>>
  /** returns / sales × 100 over the same window. */
  returnsRatePct: number | null
  /** Average order (money / count) in the facts' currency. */
  averageOrder: { value: number; unit: string | null } | null
  /** Facts exist but no complete 30-day window yet (history still filling). */
  filling: boolean
}

const FLOW_KEYS: FactKey[] = ['orders_count', 'orders_amount', 'sales_count', 'revenue', 'returns_count', 'returns_amount', 'payout', 'commission', 'sessions', 'users', 'web_purchases', 'web_revenue']

export function summarizeProviders(facts: readonly FactLike[], now: Date): ProviderSummary[] {
  const idx = index(facts)
  const out: ProviderSummary[] = []
  for (const [provider, byKey] of idx) {
    const totals: ProviderSummary['totals'] = {}
    let window: Window | null = null
    let fetchedAt: string | null = null
    for (const key of FLOW_KEYS) {
      const t = flowTotal(idx, provider, key, now)
      if (!t) continue
      totals[key] = { value: round2(t.value), unit: t.unit }
      window ??= t.window
      if (!fetchedAt || t.fetchedAt > fetchedAt) fetchedAt = t.fetchedAt
    }
    const snapshots: ProviderSummary['snapshots'] = {}
    for (const key of ['sku_count', 'sku_in_stock'] as const) {
      const s = snapshot(idx, provider, key, now)
      if (s) snapshots[key] = { value: s.value, day: s.day }
    }
    const rr = ratioOver(idx, provider, 'returns_count', 'sales_count', now)
    const pair = AOV_FACTS[provider] ?? (['revenue', 'sales_count'] as [FactKey, FactKey])
    const aov = ratioOver(idx, provider, pair[0], pair[1], now)
    out.push({
      provider,
      periodStart: window?.start ?? null,
      periodEnd: window?.end ?? null,
      fetchedAt,
      totals,
      snapshots,
      returnsRatePct: rr ? round2((rr.numerator / rr.denominator) * 100) : null,
      averageOrder: aov ? { value: round2(aov.numerator / aov.denominator), unit: aov.unitNum } : null,
      filling: byKey.size > 0 && !window && Object.keys(snapshots).length === 0,
    })
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider))
}

// ── Reading facts ───────────────────────────────────────────────────────────

/** PostgREST / Postgres «relation does not exist»: migration 105 not applied yet. */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|relation .* does not exist/i.test(error.message ?? '')
}

const PLAIN_ID = /^[A-Za-z0-9_-]+$/

/**
 * Facts of a company through a Supabase client (service role, or the caller's
 * session — RLS: members and staff). Before migration 105 → []. Any other
 * failure throws: «could not read» must never look like «no facts» (the
 * materialiser would delete the metric rows that came from them).
 */
export async function loadIntegrationFacts(client: SupabaseClient, companyId: string): Promise<FactLike[]> {
  if (!PLAIN_ID.test(companyId)) return []
  const res = await client
    .from('integration_facts')
    .select('provider, metric_key, period_start, period_end, value, unit, fetched_at')
    .eq('company_id', companyId)
    .order('period_end', { ascending: false })
    .limit(FACTS_READ_LIMIT)
  if (res.error) {
    if (isMissingRelation(res.error)) return []
    throw new Error(`integrations: facts read failed (${res.error.code ?? 'unknown'})`)
  }
  return (res.data ?? []) as FactLike[]
}

export async function loadIntegrationSignals(client: SupabaseClient, companyId: string, now: Date): Promise<Record<string, IntegrationSignal>> {
  return buildIntegrationSignals(await loadIntegrationFacts(client, companyId), now)
}

/** Narrow an unknown external signal value to an integration signal. */
export function asIntegrationSignal(v: unknown): IntegrationSignal | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  if (typeof s.value !== 'number' || !Number.isFinite(s.value) || !isProviderKey(s.provider)) return null
  if (typeof s.period_start !== 'string' || typeof s.period_end !== 'string') return null
  return s as unknown as IntegrationSignal
}
