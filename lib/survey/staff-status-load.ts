/**
 * lib/survey/staff-status-load.ts — reads the facts of lib/survey/staff-status.ts
 * for a list of clients (service client; the caller has checked the access):
 *   • profiles.preferences (the chosen mode);
 *   • user_events SURVEY_MODE_CHOSEN / SURVEY_EXPRESS_COMPLETED /
 *     QUESTIONNAIRE_COMPLETED — events written from a cabinet opened by staff
 *     («от имени», source impersonation/admin) are not the client's choice;
 *   • the submission of the full questionnaire: admin_survey_completions()
 *     (migration 090 — the one definition of «анкета заполнена»), or
 *     QUESTIONNAIRE_COMPLETED when the RPC is unavailable.
 * Never throws: a failed read leaves the client out of the map (the caller
 * shows no chips instead of wrong ones).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSurveyStaffStatus, type SurveyStaffStatus } from './staff-status'

type Db = Pick<SupabaseClient, 'from' | 'rpc'>

// Ids per `in.(…)` filter: the URL stays short (as in /api/expert/clients).
const CHUNK = 50
const EVENTS_PER_CHUNK = 5000
export const STAFF_STATUS_EVENTS = ['SURVEY_MODE_CHOSEN', 'SURVEY_EXPRESS_COMPLETED', 'QUESTIONNAIRE_COMPLETED'] as const
/** Events from a cabinet opened by staff are not the client's own. */
export const NOT_CLIENT_SOURCES: ReadonlySet<string> = new Set(['impersonation', 'admin'])

interface EventRow { user_id: string; event_name: string; created_at: string; metadata?: unknown; source?: string | null }

function chunks<T>(arr: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** user_id → completed_at of the full questionnaire; null when the RPC failed. */
export async function loadFullSubmissions(sb: Pick<SupabaseClient, 'rpc'>): Promise<Map<string, string> | null> {
  try {
    const { data, error } = await sb.rpc('admin_survey_completions')
    if (error || !Array.isArray(data)) return null
    const out = new Map<string, string>()
    for (const r of data as Array<{ user_id?: string; completed_at?: string | null }>) {
      if (r.user_id && r.completed_at) out.set(r.user_id, String(r.completed_at))
    }
    return out
  } catch {
    return null
  }
}

export async function loadSurveyStaffStatuses(
  sb: Db,
  userIds: readonly string[],
  opts: { fullSubmittedAt?: ReadonlyMap<string, string | null> } = {},
): Promise<Map<string, SurveyStaffStatus>> {
  const out = new Map<string, SurveyStaffStatus>()
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (!ids.length) return out
  try {
    const prefs = new Map<string, unknown>()
    const events = new Map<string, EventRow[]>()
    for (const part of chunks(ids)) {
      const [p, e] = await Promise.all([
        sb.from('profiles').select('id, preferences').in('id', part),
        sb.from('user_events')
          .select('user_id, event_name, created_at, metadata, source')
          .in('user_id', part)
          .in('event_name', [...STAFF_STATUS_EVENTS])
          .order('created_at', { ascending: true })
          .limit(EVENTS_PER_CHUNK),
      ])
      if (p.error || e.error) throw new Error((p.error ?? e.error)?.message ?? 'read failed')
      for (const r of (p.data ?? []) as Array<{ id: string; preferences?: unknown }>) prefs.set(r.id, r.preferences)
      for (const r of (e.data ?? []) as EventRow[]) {
        if (r.source && NOT_CLIENT_SOURCES.has(r.source)) continue
        const list = events.get(r.user_id) ?? []
        list.push(r)
        events.set(r.user_id, list)
      }
    }
    const submissions = opts.fullSubmittedAt ?? (await loadFullSubmissions(sb))
    for (const id of ids) {
      const own = events.get(id) ?? []
      const express = own.find((r) => r.event_name === 'SURVEY_EXPRESS_COMPLETED') ?? null
      const completedEvent = own.find((r) => r.event_name === 'QUESTIONNAIRE_COMPLETED')?.created_at ?? null
      const fullSubmittedAt = submissions ? submissions.get(id) ?? null : completedEvent
      out.set(id, buildSurveyStaffStatus({
        preferences: prefs.get(id),
        expressCompleted: express ? { at: express.created_at, metadata: express.metadata } : null,
        fullSubmittedAt,
        modeEvents: own.filter((r) => r.event_name === 'SURVEY_MODE_CHOSEN').map((r) => ({ at: r.created_at, metadata: r.metadata })),
      }))
    }
  } catch (err) {
    console.error('[survey/staff-status] not loaded', err instanceof Error ? err.message : err)
    return new Map()
  }
  return out
}
