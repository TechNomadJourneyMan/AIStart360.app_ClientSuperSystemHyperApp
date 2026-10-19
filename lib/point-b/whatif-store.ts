/**
 * lib/point-b/whatif-store.ts — the saved «Что если» scenarios of a client (table pb_saved_scenarios,
 * migration 127) and what the what-if routes need around the engine. Service-role client; the callers
 * authorise the user / the expert first and pass the company they derived on the server.
 *
 * A what-if never changes the plan: the only writes here are the explicit save, the delete and the mark
 * «предложено эксперту». The summary of a saved scenario is calculated HERE, by the engine, from the
 * changes — a summary sent by the client is never read.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadModelForCompany } from './model/load'
import { companyOfUser } from './plan/flow'
import { snapshotGoals } from './plan/goals'
import { loadPlanBundle, type PlanBundle } from './plan/store'
import { defaultProfiles } from './model/profiles'
import {
  DEFAULT_EFFICIENCY, DEFAULT_ELASTICITY, runWhatIf, WHATIF_LABELS, type WhatIfChange, type WhatIfMetrics, type WhatIfResult,
} from './model/whatif'
import { fmtMoney, fmtNum } from './model/format'
import type { DataLevel, ModelInputs, ScenarioProfile } from './model/types'

export const MAX_SAVED_PER_COMPANY = 20
export const NAME_MAX = 80
export const NOTE_MAX = 500
export const COMMENT_MAX = 500

export interface SavedRow {
  id: string
  company_id: string
  user_id: string
  name: string
  note: string | null
  changes: WhatIfChange[]
  summary: WhatIfSummary
  model_version: string
  proposed_at: string | null
  proposal_message_id: string | null
  created_at: string
  updated_at: string
}

/** What the server keeps next to the changes: the data level and the key figures of the calculation. */
export interface WhatIfSummary {
  level: DataLevel
  delta: WhatIfResult['delta']
  baseline: WhatIfMetrics
  changed: WhatIfMetrics
  computedAt: string
}

/** The row as the API shows it (camelCase, no user / company ids). */
export interface SavedView {
  id: string
  name: string
  note: string | null
  changes: WhatIfChange[]
  summary: WhatIfSummary | Record<string, never>
  modelVersion: string
  proposedAt: string | null
  createdAt: string
}

export class SavedStoreError extends Error {
  constructor(message: string, public readonly code: 'db' | 'missing_table' | 'limit') {
    super(message)
    this.name = 'SavedStoreError'
  }
}

const COLUMNS = 'id, company_id, user_id, name, note, changes, summary, model_version, proposed_at, proposal_message_id, created_at, updated_at'
const isMissingTable = (code: string | undefined): boolean => code === '42P01' || code === 'PGRST205'

function dbError(what: string, error: { code?: string; message?: string }): SavedStoreError {
  // The table of migration 127 is not there yet: a distinct code, so the routes answer calmly.
  if (isMissingTable(error.code)) return new SavedStoreError(`whatif ${what}: table pb_saved_scenarios is missing`, 'missing_table')
  return new SavedStoreError(`whatif ${what}: ${error.code ?? 'error'} ${(error.message ?? '').slice(0, 120)}`, 'db')
}

export function toView(row: SavedRow): SavedView {
  return {
    id: row.id,
    name: row.name,
    note: row.note ?? null,
    changes: Array.isArray(row.changes) ? row.changes : [],
    summary: row.summary ?? {},
    modelVersion: row.model_version,
    proposedAt: row.proposed_at ?? null,
    createdAt: row.created_at,
  }
}

// ─── reads and writes ───────────────────────────────────────────────────────

/** The saved scenarios of one owner in one company, the newest first (at most 20). A missing table means «none». */
export async function listSaved(sb: SupabaseClient, input: { companyId: string; userId: string }): Promise<SavedRow[]> {
  const { data, error } = await sb.from('pb_saved_scenarios').select(COLUMNS)
    .eq('company_id', input.companyId).eq('user_id', input.userId)
    .order('created_at', { ascending: false }).limit(MAX_SAVED_PER_COMPANY)
  if (error) {
    const e = dbError('list', error)
    if (e.code === 'missing_table') return []
    throw e
  }
  return (data ?? []) as SavedRow[]
}

export async function countSaved(sb: SupabaseClient, companyId: string): Promise<number> {
  const { data, error } = await sb.from('pb_saved_scenarios').select('id').eq('company_id', companyId)
  if (error) throw dbError('count', error)
  return (data ?? []).length
}

/** One scenario of THIS owner in THIS company; another user’s or another company’s id is null. */
export async function getSaved(sb: SupabaseClient, input: { id: string; companyId: string; userId: string }): Promise<SavedRow | null> {
  const { data, error } = await sb.from('pb_saved_scenarios').select(COLUMNS)
    .eq('id', input.id).eq('company_id', input.companyId).eq('user_id', input.userId).maybeSingle()
  if (error) throw dbError('read', error)
  return (data as SavedRow | null) ?? null
}

/**
 * Saves a scenario. The limit is counted by the application: a check before the insert and one after it, so
 * two requests racing past the first check cannot both stay over the limit (the later one is removed).
 * Throws SavedStoreError('limit').
 */
export async function insertSaved(
  sb: SupabaseClient,
  input: { companyId: string; userId: string; name: string; note: string | null; changes: WhatIfChange[]; summary: WhatIfSummary; modelVersion: string },
): Promise<SavedRow> {
  if ((await countSaved(sb, input.companyId)) >= MAX_SAVED_PER_COMPANY) throw new SavedStoreError('limit', 'limit')
  const { data, error } = await sb.from('pb_saved_scenarios').insert({
    company_id: input.companyId, user_id: input.userId, name: input.name, note: input.note,
    changes: input.changes, summary: input.summary, model_version: input.modelVersion,
  }).select(COLUMNS).single()
  if (error || !data) throw dbError('insert', error ?? {})
  const row = data as SavedRow
  if ((await countSaved(sb, input.companyId)) > MAX_SAVED_PER_COMPANY) {
    await sb.from('pb_saved_scenarios').delete().eq('id', row.id)
    throw new SavedStoreError('limit', 'limit')
  }
  return row
}

/** Deletes the owner’s scenario; false when it is not his (or not there): nothing is deleted. */
export async function deleteSaved(sb: SupabaseClient, input: { id: string; companyId: string; userId: string }): Promise<boolean> {
  const { data, error } = await sb.from('pb_saved_scenarios').delete()
    .eq('id', input.id).eq('company_id', input.companyId).eq('user_id', input.userId).select('id')
  if (error) throw dbError('delete', error)
  return ((data ?? []) as unknown[]).length > 0
}

/**
 * Takes the «proposed» mark with a conditional update (only while proposed_at is empty), so a repeated or
 * parallel proposal of the same scenario is refused: null = somebody already proposed it.
 */
export async function claimProposal(sb: SupabaseClient, input: { id: string; companyId: string; userId: string; at: string }): Promise<SavedRow | null> {
  const { data, error } = await sb.from('pb_saved_scenarios').update({ proposed_at: input.at })
    .eq('id', input.id).eq('company_id', input.companyId).eq('user_id', input.userId).is('proposed_at', null).select(COLUMNS)
  if (error) throw dbError('propose', error)
  return ((data ?? []) as SavedRow[])[0] ?? null
}

export async function setProposalMessage(sb: SupabaseClient, id: string, messageId: string | null): Promise<void> {
  const { error } = await sb.from('pb_saved_scenarios').update({ proposal_message_id: messageId }).eq('id', id)
  if (error) throw dbError('propose message', error)
}

/** Gives the mark back (the message could not be sent). */
export async function releaseProposal(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('pb_saved_scenarios').update({ proposed_at: null, proposal_message_id: null }).eq('id', id)
  if (error) throw dbError('release proposal', error)
}

// ─── the model of the client ────────────────────────────────────────────────

const EMPTY_BUNDLE: PlanBundle = { plan: null, versions: [], open: null, published: null }
const missingTableText = (message: string): boolean => /\((42P01|PGRST205)\)/.test(message)

/**
 * The inputs of the client’s model, built exactly like the page state (`loadPointBState`) builds them, so the lab
 * and the overview never disagree: the same goal (the primary goal of the published plan, if there is one), the
 * same levers, history and finmodel. Reads only.
 */
export async function loadWhatIfInputs(sb: SupabaseClient, userId: string, now: Date = new Date()): Promise<{ inputs: ModelInputs; companyId: string | null }> {
  const company = await companyOfUser(sb, userId)
  let bundle = EMPTY_BUNDLE
  if (company) {
    try {
      bundle = await loadPlanBundle(sb, company.id)
    } catch (err) {
      if (!missingTableText(err instanceof Error ? err.message : String(err))) throw err
    }
  }
  const goals = company
    ? await snapshotGoals(sb, company.id, bundle.published?.goals?.primary ?? undefined).catch((err) => {
        console.error('[point-b/whatif] goals not read — the calculation runs without a goal', err instanceof Error ? err.message : err)
        return null
      })
    : null
  const { inputs } = await loadModelForCompany(sb, { userId, companyId: company?.id ?? null, goals, now })
  return { inputs, companyId: company?.id ?? null }
}

export const SCENARIO_KEYS = ['cautious', 'moderate', 'aggressive'] as const
export type ScenarioKey = (typeof SCENARIO_KEYS)[number]

export function profileOf(inputs: ModelInputs, key: ScenarioKey | undefined): ScenarioProfile | undefined {
  return key ? defaultProfiles(inputs.template).find((p) => p.key === key) : undefined
}

/** The key figures stored with a saved scenario. */
export function summaryOf(result: WhatIfResult): WhatIfSummary {
  return { level: result.level, delta: result.delta, baseline: result.baseline, changed: result.changed, computedAt: result.computedAt }
}

// ─── texts ──────────────────────────────────────────────────────────────────

const sgn = (n: number, digits = 0): string => `${n > 0 ? '+' : ''}${fmtNum(n, digits).replace(digits > 0 ? /,?0+$/ : /^$/, '')}`
/** 0,30 → «0,3», 1,00 → «1». */
const plain = (n: number): string => fmtNum(n, 2).replace(/,?0+$/, '')

/** «маркетинг +20%, средний чек +10%, найм 2 чел. с месяца 3» — for the message to the expert. */
export function describeChanges(changes: WhatIfChange[]): string {
  const parts = changes.map((c) => {
    switch (c.kind) {
      case 'marketing':
        return `${WHATIF_LABELS.marketing.toLowerCase()} ${sgn(c.budgetPct)}% (эффективность ${plain(c.efficiency ?? DEFAULT_EFFICIENCY)})`
      case 'hire':
        return `найм ${fmtNum(c.count)} чел. с месяца ${c.startMonth}${c.revenueEffectPct ? ` (эффект на выручку ${fmtNum(c.revenueEffectPct * 100)}%)` : ''}`
      case 'avg_check':
        return `средний чек ${sgn(c.pct)}% (эластичность ${plain(c.demandElasticity ?? DEFAULT_ELASTICITY)})`
      case 'conversion':
        return `конверсия ${sgn(c.pp, 1)} п.п.`
      case 'revenue_shock':
        return `падение выручки ${sgn(c.pct)}% на ${fmtNum(c.durationMonths)} мес. с месяца ${c.startMonth}`
      case 'fixed_costs':
        return `постоянные расходы −${fmtNum(c.cutPct)}% с месяца ${c.startMonth}${c.oneOffCost ? `, разовые затраты ${fmtMoney(c.oneOffCost)}` : ''}`
    }
  })
  return parts.join(', ')
}

/** The inbound message to the expert (becomes the client’s message in «Сообщения»). */
export function proposalText(input: { name: string; changes: WhatIfChange[]; comment: string | null }): string {
  const what = describeChanges(input.changes)
  const base = `Предлагаю учесть в плане сценарий «${input.name}»: ${what}${what.endsWith('.') ? '' : '.'}`
  return input.comment ? `${base} ${input.comment}` : base
}
