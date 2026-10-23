export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { scopedClientIds } from '@/lib/admin/client-scope'
import { hasPermission } from '@/lib/admin/rbac'
import { loadFullSubmissions } from '@/lib/survey/staff-status-load'
import { FUNNEL_EVENT_NAMES, computeModeFunnel, scopeFunnelLists, type FunnelEvent } from '@/lib/survey/mode-funnel'

/**
 * GET /api/giga-admin/surveys/modes?days=30 — the funnel of the questionnaire
 * modes (survey Ф5, spec §15): «выбор режима → экспресс → снимок → блок →
 * полная анкета отправлена», the mode split, the express and chat metrics, the
 * clients stuck on the express. Definitions: lib/survey/mode-funnel.ts.
 *
 * Access: survey.view. The aggregates are platform-wide and anonymous (like
 * /api/giga-admin/surveys); the client lists are cut to the staff member's
 * scope (an expert with the «assigned» scope sees only his clients).
 */
const PAGE = 1000
const MAX_PAGES = 20
const LIST_LIMIT = 50

type Sb = ReturnType<typeof createServiceClient>

/** Every matching event, page by page (PostgREST caps a response at 1000 rows). */
async function readEvents(sb: Sb, names: readonly string[], sinceIso: string | null): Promise<FunnelEvent[]> {
  const out: FunnelEvent[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = sb.from('user_events').select('id, user_id, event_name, created_at, metadata, source').in('event_name', [...names])
    if (sinceIso) q = q.gte('created_at', sinceIso)
    const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as FunnelEvent[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
  console.warn('[giga-admin/surveys/modes] event read capped at', MAX_PAGES * PAGE)
  return out
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'survey.view')
  if (guard.response) return guard.response
  const days = Math.min(180, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30))
  const until = new Date()
  const since = new Date(until.getTime() - days * 86_400_000)
  const sb = createServiceClient()

  try {
    const [period, allTime, submissions, allowed] = await Promise.all([
      // Everything of the funnel within the period…
      readEvents(sb, FUNNEL_EVENT_NAMES, since.toISOString()),
      // …and the rare once-per-client facts of all time: the FIRST choice decides
      // the cohort, the express decides «застряли на экспрессе».
      readEvents(sb, ['SURVEY_MODE_CHOSEN', 'SURVEY_EXPRESS_COMPLETED', 'QUESTIONNAIRE_COMPLETED'], null),
      loadFullSubmissions(sb),
      scopedClientIds(guard.actor),
    ])
    const funnel = scopeFunnelLists(
      computeModeFunnel({ events: [...allTime, ...period], submissions, since, until, listLimit: Number.MAX_SAFE_INTEGER }),
      allowed,
      LIST_LIMIT,
    )

    // Names for the lists only (a few dozen ids at most).
    const ids = Array.from(new Set([...funnel.stuck.map((s) => s.userId), ...funnel.pending.map((p) => p.userId)]))
    const people: Record<string, { name: string; company: string | null }> = {}
    // An email is shown only to staff with users.sensitive (as in the neighbour report).
    const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
    if (ids.length) {
      const [{ data: profiles }, { data: companies }] = await Promise.all([
        sb.from('profiles').select('id, full_name, email, organization').in('id', ids),
        sb.from('companies').select('user_id, name').in('user_id', ids),
      ])
      const companyOf = new Map(((companies ?? []) as Array<{ user_id: string; name: string | null }>).map((c) => [c.user_id, c.name]))
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null; organization: string | null }>) {
        people[p.id] = { name: p.full_name?.trim() || (sensitive ? p.email : null) || `Пользователь ${p.id.slice(0, 8)}`, company: companyOf.get(p.id) || p.organization || null }
      }
    }
    return NextResponse.json({ ok: true, data: { days, ...funnel, people, submissionsSource: submissions ? 'completions' : 'events' } })
  } catch (e) {
    console.error('[giga-admin/surveys/modes]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'Не удалось посчитать воронку способов заполнения' }, { status: 500 })
  }
}
