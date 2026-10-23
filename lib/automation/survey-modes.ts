/**
 * lib/automation/survey-modes.ts — the questionnaire mode of each client for
 * the reminders (survey Ф5): the chosen mode and whether the express is done.
 * Read through lib/survey/staff-status-load.ts (preferences + user_events).
 * Never throws: without these facts the reminder keeps the classic text.
 */
import { createServiceClient } from '@/lib/supabase-service'
import { loadSurveyStaffStatuses } from '@/lib/survey/staff-status-load'
import type { SurveyMode } from '@/lib/survey/modes'

export interface SurveyModeFacts {
  mode: SurveyMode | null
  expressCompletedAt: string | null
}

export async function fetchSurveyModes(userIds: string[]): Promise<Map<string, SurveyModeFacts>> {
  const out = new Map<string, SurveyModeFacts>()
  if (!userIds.length) return out
  try {
    // The reminders run only for clients whose questionnaire is not submitted: no RPC needed.
    const statuses = await loadSurveyStaffStatuses(createServiceClient(), userIds, { fullSubmittedAt: new Map() })
    for (const [id, s] of statuses) out.set(id, { mode: s.mode, expressCompletedAt: s.express?.completedAt ?? null })
  } catch (e) {
    console.warn('[automation] survey modes skipped', e instanceof Error ? e.message : e)
  }
  return out
}
