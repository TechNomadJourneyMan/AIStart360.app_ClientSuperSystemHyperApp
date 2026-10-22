/**
 * lib/point-b/invites/run.ts — the rule runner of the personal invites (spec §12.1; plan Ф6a, Task 5).
 *
 *   runInviteRules                   the client's model (the APPROVED plan's goals, pace and profiles) →
 *                                    evaluateInsightRules → createInvites → deliverInvite for the new ones
 *   inviteFromVerifiedRecommendation «Эксперт подтвердил рекомендацию: …» (dedupe by the recommendation)
 *
 * Neither throws (a failure is logged and counted as nothing done). Nothing is created:
 *   - while somebody drives the cabinet «от имени» (impersonation);
 *   - for a client without Point B (free tier while the access gates are on);
 *   - without a published plan (the plan of the experts is what the invites speak about — spec §6), at level 0
 *     or without scenarios (the rules are silent then);
 *   - without migration 129 (the tables are not there) — quietly { created: 0, skipped: 0 }.
 * Batches: one plan read, one model, one read and at most a few inserts per user.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { activeImpersonation } from '@/lib/impersonation/server'
import { evaluateInsightRules, type InsightCandidate } from '../insights/rules'
import { tabHref } from '../insights/scenario'
import { computeModel } from '../model/compute'
import { loadModelForCompany } from '../model/load'
import { normalizeProfiles } from '../model/profiles'
import type { ScenarioProfile } from '../model/types'
import { snapshotGoals } from '../plan/goals'
import { loadPlanBundle } from '../plan/store'
import type { Recommendation } from '../recs/types'
import { hasPointB } from './access'
import { deliverInvite } from './deliver'
import { createInvites } from './store'

const NONE = { created: 0, skipped: 0 }
const isMissingTable = (message: string): boolean => /\((42P01|PGRST205)\)/.test(message)
const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export { hasPointB }

async function impersonated(userId: string, given?: boolean): Promise<boolean> {
  if (given !== undefined) return given
  try {
    return !!(await activeImpersonation(userId))
  } catch {
    return false
  }
}

async function deliverCreated(
  sb: SupabaseClient, userId: string, now: Date, created: Array<{ id: string; ruleKey: string }>, byRule: Map<string, InsightCandidate>,
): Promise<void> {
  for (const c of created) {
    const cand = byRule.get(c.ruleKey)
    if (!cand) continue
    await deliverInvite(sb, {
      invite: { id: c.id, title: cand.title, body: cand.body, href: cand.href, kind: cand.kind }, userId, now, pro: true, impersonating: false,
    })
  }
}

export async function runInviteRules(
  sb: SupabaseClient, input: { userId: string; companyId: string; now: Date; impersonating?: boolean },
): Promise<{ created: number; skipped: number }> {
  try {
    if (await impersonated(input.userId, input.impersonating)) return NONE
    if (!(await hasPointB(sb, input.userId))) return NONE

    const bundle = await loadPlanBundle(sb, input.companyId)
    const published = bundle.published
    if (!published) return NONE

    const goals = await snapshotGoals(sb, input.companyId, published.goals?.primary ?? undefined)
    const { inputs } = await loadModelForCompany(sb, { userId: input.userId, companyId: input.companyId, goals, now: input.now })
    let profiles: ScenarioProfile[] | undefined
    try {
      profiles = published.assumptions?.profiles ? normalizeProfiles(published.assumptions.profiles, inputs.template) : undefined
    } catch {
      profiles = undefined // stored profiles that do not validate any more: the defaults of the template
    }
    const result = computeModel(inputs, profiles)
    if (result.level === 0) return NONE

    const candidates = evaluateInsightRules({
      result,
      selectedScenario: published.selected_scenario ?? null,
      finmodelMissing: inputs.finmodel?.missing.length ?? 0,
      pendingCorrection: goals.items.some((i) => i.reviewStatus === 'corrected'),
    })
    if (!candidates.length) return NONE

    const r = await createInvites(sb, { companyId: input.companyId, userId: input.userId, candidates, now: input.now })
    await deliverCreated(sb, input.userId, input.now, r.created, new Map(candidates.map((c) => [c.ruleKey, c])))
    return { created: r.created.length, skipped: r.skipped.length }
  } catch (err) {
    if (!isMissingTable(msg(err))) console.error('[point-b/invites] rules not run', msg(err))
    return NONE
  }
}

const fmtDate = (isoDate: string | null): string | null => {
  if (!isoDate) return null
  const d = new Date(isoDate)
  return Number.isFinite(d.getTime()) ? `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}` : null
}

/** The invite «Эксперт подтвердил рекомендацию» — one per recommendation (dedupe key = its id). */
export function verifiedRecommendationCandidate(rec: Recommendation): InsightCandidate {
  const who = rec.reviewerName?.trim() || 'Эксперт AIStart360'
  const date = fmtDate(rec.reviewedAt)
  return {
    ruleKey: 'rec_verified',
    dedupeKey: `rec_verified:${rec.id}`,
    kind: 'recommendation',
    title: `Эксперт подтвердил рекомендацию: ${rec.title}`.slice(0, 200),
    body: `${rec.essence?.trim() ? `${rec.essence.trim()} ` : ''}Посмотреть?`,
    href: tabHref('recs'),
    priority: 2,
    display: 'card',
    why: [`${who}${rec.reviewerSpecialty ? ` (${rec.reviewerSpecialty})` : ''} проверил рекомендацию${date ? ` ${date}` : ''}.`, rec.scopeNote ? `Область применимости: ${rec.scopeNote}` : null]
      .filter(Boolean).join(' '),
    sourceRefs: rec.sourceRefs,
    expiresInDays: 30,
  }
}

export async function inviteFromVerifiedRecommendation(
  sb: SupabaseClient, input: { rec: Recommendation; userId: string; now: Date; impersonating?: boolean },
): Promise<void> {
  try {
    if (input.rec.status !== 'expert_verified') return
    if (await impersonated(input.userId, input.impersonating)) return
    if (!(await hasPointB(sb, input.userId))) return
    const cand = verifiedRecommendationCandidate(input.rec)
    const r = await createInvites(sb, { companyId: input.rec.companyId, userId: input.userId, candidates: [cand], now: input.now, sourceRecId: input.rec.id })
    await deliverCreated(sb, input.userId, input.now, r.created, new Map([[cand.ruleKey, cand]]))
  } catch (err) {
    if (!isMissingTable(msg(err))) console.error('[point-b/invites] verified recommendation invite failed', msg(err))
  }
}
