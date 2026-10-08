export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { assignedClientIds, isUuid, scopedClientIds } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { DAY_MS, bucketTasks, groupCases, summarizeChanges, type DiagPoint, type DocPoint, type GriPoint, type SurveyChange } from '@/lib/admin/today'

/**
 * GET /api/giga-admin/me/today?tz=<Date#getTimezoneOffset> — «Мой день».
 *
 *  tasks   — мои открытые задачи (staff_tasks.assignee_id = я): просрочено /
 *            сегодня / ближайшие 7 дней (+ позже и без срока);
 *  cases   — открытые обращения к эксперту (expert_cases new/in_progress):
 *            все, если я вижу всех клиентов, иначе только по моим клиентам;
 *            сгруппированы по приоритету;
 *  changes — клиенты в моей области видимости, у которых после моего
 *            последнего просмотра карточки (staff_client_views) изменились
 *            анкета, GRI, Точка А или документы. Кандидаты — клиенты, которых
 *            я открывал, и назначенные мне (для ни разу не открытых — за 7 дней).
 */

const MAX_VIEWED = 200
const NEW_ASSIGNMENT_WINDOW_DAYS = 7

type Sb = ReturnType<typeof createServiceClient>

async function labels(sb: Sb, ids: string[]): Promise<Map<string, { name: string; email: string | null }>> {
  const uniq = Array.from(new Set(ids.filter(isUuid)))
  if (!uniq.length) return new Map()
  const [{ data: people }, { data: companies }] = await Promise.all([
    sb.from('profiles').select('id, full_name, email, organization').in('id', uniq),
    sb.from('companies').select('user_id, name').in('user_id', uniq),
  ])
  const company = new Map(((companies ?? []) as Array<{ user_id: string; name: string | null }>).map((c) => [c.user_id, c.name]))
  return new Map(((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null; organization: string | null }>).map((p) => [
    p.id,
    { name: company.get(p.id) || p.organization || p.full_name || p.email || `Пользователь ${p.id.slice(0, 8)}`, email: p.email },
  ]))
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const me = guard.actor
  const tzRaw = Number(req.nextUrl.searchParams.get('tz'))
  // По умолчанию — Казахстан (UTC+5).
  const tz = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 14 * 60 ? tzRaw : -300
  const now = Date.now()
  const sb = createServiceClient()

  const allowed = await scopedClientIds(me)
  const allowedSet = allowed ? new Set(allowed) : null
  const inScope = (id: string | null | undefined) => !!id && (!allowedSet || allowedSet.has(id))

  // ── 1. Мои задачи ────────────────────────────────────────────────────────
  const tasksRes = isUuid(me.id)
    ? await sb.from('staff_tasks').select('id, user_id, title, due_at, status, created_at').eq('assignee_id', me.id).eq('status', 'open').order('due_at', { ascending: true, nullsFirst: false }).limit(300)
    : { data: [], error: null }
  const tasks = (tasksRes.data ?? []) as Array<{ id: string; user_id: string | null; title: string; due_at: string | null; status: string; created_at: string }>

  // ── 2. Открытые кейсы ────────────────────────────────────────────────────
  let casesQ = sb
    .from('expert_cases')
    .select('id, user_id, status, priority, trigger_type, title, summary, created_at, updated_at')
    .in('status', ['new', 'in_progress'])
    .order('created_at', { ascending: true })
    .limit(300)
  if (allowed) casesQ = casesQ.in('user_id', allowed.length ? allowed : ['00000000-0000-0000-0000-000000000000'])
  const casesRes = await casesQ
  const cases = (casesRes.data ?? []) as Array<{ id: string; user_id: string; status: string; priority: string; trigger_type: string; title: string; summary: string | null; created_at: string; updated_at: string }>

  // ── 3. Что изменилось ────────────────────────────────────────────────────
  const [viewsRes, mine] = await Promise.all([
    isUuid(me.id)
      ? sb.from('staff_client_views').select('user_id, last_viewed_at').eq('staff_id', me.id).order('last_viewed_at', { ascending: false }).limit(MAX_VIEWED)
      : Promise.resolve({ data: [], error: null }),
    assignedClientIds(me.id),
  ])
  const sinceBy = new Map<string, { since: string; viewed: boolean }>()
  for (const v of (viewsRes.data ?? []) as Array<{ user_id: string; last_viewed_at: string }>) {
    if (inScope(v.user_id)) sinceBy.set(v.user_id, { since: v.last_viewed_at, viewed: true })
  }
  const fallbackSince = new Date(now - NEW_ASSIGNMENT_WINDOW_DAYS * DAY_MS).toISOString()
  for (const id of mine) if (!sinceBy.has(id) && inScope(id)) sinceBy.set(id, { since: fallbackSince, viewed: false })

  const candidateIds = Array.from(sinceBy.keys())
  let changes: Array<{ userId: string; lines: string[]; changedAt: string | null; lastViewedAt: string | null; counts: Record<string, number> }> = []
  if (candidateIds.length) {
    const minSince = Array.from(sinceBy.values()).map((v) => v.since).sort()[0]
    const [surveyRes, griRes, diagRes, docsRes] = await Promise.all([
      sb.from('survey_answer_history').select('user_id, question_key, created_at, changed_by').in('user_id', candidateIds).gt('created_at', minSince).limit(5000),
      sb.from('gri_assessments').select('user_id, gri_index, created_at').in('user_id', candidateIds).order('created_at', { ascending: false }).limit(3000),
      sb.from('diagnostics').select('user_id, overall_score, calculated_at').in('user_id', candidateIds).order('calculated_at', { ascending: false }).limit(3000),
      sb.from('documents').select('user_id, file_name, uploaded_at').in('user_id', candidateIds).gt('uploaded_at', minSince).limit(2000),
    ])
    const group = <T extends { user_id: string }>(rows: T[] | null) => {
      const m = new Map<string, T[]>()
      for (const r of rows ?? []) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r])
      return m
    }
    const survey = group((surveyRes.data ?? []) as Array<SurveyChange & { user_id: string }>)
    const gri = group((griRes.data ?? []) as Array<GriPoint & { user_id: string }>)
    const diag = group((diagRes.data ?? []) as Array<DiagPoint & { user_id: string }>)
    const docs = group((docsRes.data ?? []) as Array<DocPoint & { user_id: string }>)

    changes = candidateIds
      .map((userId) => {
        const s = sinceBy.get(userId)!
        const sum = summarizeChanges({
          since: s.since,
          selfId: me.id,
          survey: survey.get(userId) ?? [],
          gri: (gri.get(userId) ?? []).map((g) => ({ gri_index: Number(g.gri_index), created_at: g.created_at })),
          diag: diag.get(userId) ?? [],
          docs: docs.get(userId) ?? [],
        })
        return { userId, lines: sum.lines, changedAt: sum.changedAt, lastViewedAt: s.viewed ? s.since : null, counts: sum.counts }
      })
      .filter((c) => c.lines.length > 0)
      .sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt)))
      .slice(0, 100)
  }

  const names = await labels(sb, [
    ...tasks.map((t) => t.user_id ?? ''),
    ...cases.map((c) => c.user_id),
    ...changes.map((c) => c.userId),
  ])
  const who = (id: string | null) => (id ? { id, name: names.get(id)?.name ?? `Пользователь ${id.slice(0, 8)}` } : null)

  // Задачи по клиентам вне моей области видимости не прячем (задача МОЯ), но
  // и имя такого клиента не раскрываем.
  const taskView = tasks.map((t) => ({ ...t, user: t.user_id && inScope(t.user_id) ? who(t.user_id) : null }))
  const buckets = bucketTasks(taskView, now, tz)

  return NextResponse.json({
    ok: true,
    data: {
      clientScope: me.clientScope ?? 'all',
      generatedAt: new Date(now).toISOString(),
      tasks: buckets,
      cases: {
        total: cases.length,
        groups: groupCases(cases.map((c) => ({ ...c, user: who(c.user_id) }))),
        unavailable: !!casesRes.error,
      },
      changes: changes.map((c) => ({ ...c, user: who(c.userId) })),
      unavailable: { tasks: !!tasksRes.error, views: !!viewsRes.error },
    },
  })
}
