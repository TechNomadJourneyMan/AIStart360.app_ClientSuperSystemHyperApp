/**
 * lib/survey/chat/budget.ts — how much AI the questionnaire helper may spend
 * (PO decision 2026-10-23, spec §18.3 item 2):
 *
 *   • new and free clients — a cap of $0.5 PER CLIENT for all time (sum of
 *     ai_usage.cost_usd with feature 'survey_assistant'; setting
 *     survey_ai_budget_usd_per_client), plus the usual daily AI limit;
 *   • PRO — no limit while the full questionnaire is not submitted (marker /
 *     QUESTIONNAIRE_COMPLETED, lib/survey/completion.ts); after the submit —
 *     the normal daily PRO limit (assertAiBudget);
 *   • platform staff — the normal daily staff limit.
 *
 * When the budget is spent the chat answers with a clear Russian line (HTTP
 * 200) and keeps the registry explanations; the form modes keep working.
 * Fail-OPEN like lib/ai/budget.ts: a broken meter does not take the helper
 * down (the per-user rate limits still bound the spend).
 */
import { assertAiBudget, isAiBudgetError, type AiBudgetTier } from '@/lib/ai/budget'
import type { ChatBudgetDTO } from './types'

export const SURVEY_FEATURE = 'survey_assistant' as const

export const SURVEY_CAP_MESSAGE =
  'Лимит ИИ-помощника на анкету для вашего тарифа исчерпан. Продолжите в форме — быстрый старт или полная анкета: всё, что вы записали, сохранено. Объяснения вопросов и «где взять цифру» по-прежнему работают.'
export const SURVEY_DAILY_MESSAGE =
  'Помощник на сегодня устал. Продолжите в форме — всё сохранится. Объяснения вопросов и «где взять цифру» по-прежнему работают.'

export interface SurveyBudgetDeps {
  readTier: (userId: string) => Promise<AiBudgetTier>
  /** The full questionnaire was submitted. */
  fullSubmitted: (userId: string) => Promise<boolean>
  readCapUsd: () => Promise<number>
  /** All-time spend of the helper for this client. */
  readSpentUsd: (userId: string) => Promise<number>
  /** The daily per-user limit (throws AiBudgetExceededError). */
  assertDaily: (userId: string) => Promise<void>
}

// The same staff list as lib/ai/budget.ts (profiles.role).
const STAFF_PROFILE_ROLES = new Set([
  'super_admin', 'admin', 'owner', 'expert', 'manager', 'analyst',
  'super_expert', 'crm_manager', 'content_manager', 'support',
])

const defaultDeps: SurveyBudgetDeps = {
  async readTier(userId) {
    const { createServiceClient } = await import('@/lib/supabase-service')
    const { data } = await createServiceClient().from('profiles').select('role, tier').eq('id', userId).maybeSingle()
    const row = data as { role?: unknown; tier?: unknown } | null
    if (typeof row?.role === 'string' && STAFF_PROFILE_ROLES.has(row.role)) return 'staff'
    return row?.tier === 'pro' ? 'pro' : 'free'
  },
  async fullSubmitted(userId) {
    const { createServiceClient } = await import('@/lib/supabase-service')
    const { isSurveyCompleted, loadSurveyCompletionMarkers } = await import('@/lib/survey/completion')
    return isSurveyCompleted(await loadSurveyCompletionMarkers(createServiceClient(), userId))
  },
  async readCapUsd() {
    const { getSetting } = await import('@/lib/settings/store')
    return Number(await getSetting('survey_ai_budget_usd_per_client'))
  },
  async readSpentUsd(userId) {
    const { createServiceClient } = await import('@/lib/supabase-service')
    const { data, error } = await createServiceClient().from('ai_usage').select('cost_usd').eq('user_id', userId).eq('feature', SURVEY_FEATURE)
    if (error) throw new Error(error.message)
    return sumCost(data)
  },
  assertDaily: (userId) => assertAiBudget(userId, SURVEY_FEATURE),
}

export function sumCost(rows: unknown): number {
  if (!Array.isArray(rows)) return 0
  return rows.reduce((s: number, r) => {
    const v = Number((r as { cost_usd?: unknown } | null)?.cost_usd)
    return Number.isFinite(v) && v > 0 ? s + v : s
  }, 0)
}

let injected: SurveyBudgetDeps | null = null

/** Test hook: replace the readers (null restores). */
export function __setSurveyBudgetDeps(deps: SurveyBudgetDeps | null): void {
  injected = deps
}

const OK: ChatBudgetDTO = { exhausted: false, reason: null, message: null }

/** May the helper call the model for this client now? */
export async function checkSurveyAssistantBudget(userId: string, deps?: SurveyBudgetDeps): Promise<ChatBudgetDTO & { tier: AiBudgetTier | null; unlimited: boolean }> {
  // Under the test runner the real readers would talk to the DB from .env.
  const d = deps ?? injected ?? (process.env.NODE_ENV === 'test' ? null : defaultDeps)
  if (!d) return { ...OK, tier: null, unlimited: false }
  let tier: AiBudgetTier
  try {
    tier = await d.readTier(userId)
  } catch (err) {
    console.warn('[survey-chat/budget] tier read failed (fail-open):', err instanceof Error ? err.message : err)
    return { ...OK, tier: null, unlimited: false }
  }

  if (tier === 'pro') {
    let submitted = false
    try { submitted = await d.fullSubmitted(userId) } catch { submitted = false }
    if (!submitted) return { ...OK, tier, unlimited: true } // PO: PRO is unlimited until the full questionnaire is sent
  }

  if (tier === 'free') {
    try {
      const [cap, spent] = await Promise.all([d.readCapUsd(), d.readSpentUsd(userId)])
      if (Number.isFinite(cap) && Number.isFinite(spent) && spent >= cap) {
        return { exhausted: true, reason: 'cap', message: SURVEY_CAP_MESSAGE, tier, unlimited: false }
      }
    } catch (err) {
      console.warn('[survey-chat/budget] cap check skipped (fail-open):', err instanceof Error ? err.message : err)
    }
  }

  try {
    await d.assertDaily(userId)
  } catch (err) {
    if (isAiBudgetError(err)) return { exhausted: true, reason: 'daily', message: SURVEY_DAILY_MESSAGE, tier, unlimited: false }
  }
  return { ...OK, tier, unlimited: false }
}
