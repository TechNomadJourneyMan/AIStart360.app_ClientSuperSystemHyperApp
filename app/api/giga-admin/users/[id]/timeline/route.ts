export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { hasPermission } from '@/lib/admin/rbac'
import { createServiceClient } from '@/lib/supabase-service'
import { GIGA_BASE, SUPER_EXPERT_BASE } from '@/lib/admin/nav'
import {
  NOISY_EVENTS, fromAudit, fromCases, fromComments, fromEmails, fromEvents, fromNotes, fromSurveyHistory, fromTasks,
  isTimelineKind, mergeTimeline, type TimelineEntry, type TimelineKind,
} from '@/lib/admin/timeline'

/**
 * GET /api/giga-admin/users/:id/timeline?cursor=<iso>&limit=<n>&all=1&kinds=event,audit,…
 *
 * Единая лента клиента: ключевые события, действия персонала, письма,
 * заметки, задачи, эскалации, комментарии экспертов и правки анкеты — одним
 * списком по времени. Каждый источник закрыт своим правом: без
 * `audit.view` сотрудник видит в ленте только СВОИ действия с клиентом,
 * без `users.sensitive` — не видит письма, заметки и задачи.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LIMIT = 100

type Rows<T> = { data: T[] | null; error: { message: string } | null }

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const actor = guard.actor
  const sp = req.nextUrl.searchParams
  const limit = Math.min(MAX_LIMIT, Math.max(5, Number(sp.get('limit')) || 40))
  const cursorRaw = sp.get('cursor')
  const cursor = cursorRaw && !Number.isNaN(new Date(cursorRaw).getTime()) ? new Date(cursorRaw).toISOString() : null
  const all = sp.get('all') === '1'
  const kindsParam = (sp.get('kinds') ?? '').split(',').map((k) => k.trim()).filter(isTimelineKind)
  const want = (k: TimelineKind) => !kindsParam.length || kindsParam.includes(k)

  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(actor.role, p)
  const sensitive = can('users.sensitive')
  // Каждого источника берём с запасом — страница режется после слияния.
  const per = limit + 1
  const sb = createServiceClient()
  const before = <Q extends { lt: (c: string, v: string) => Q }>(q: Q, col = 'created_at'): Q => (cursor ? q.lt(col, cursor) : q)

  const jobs: Array<Promise<TimelineEntry[]>> = []
  const available: TimelineKind[] = []
  const safe = async <T,>(p: PromiseLike<Rows<T>>, map: (rows: T[]) => TimelineEntry[]): Promise<TimelineEntry[]> => {
    try {
      const { data, error } = await p
      if (error) return []
      return map(data ?? [])
    } catch {
      return []
    }
  }

  if (can('activity.view')) {
    available.push('event')
    if (want('event')) {
      let q = sb.from('user_events').select('id, event_name, page, source, created_at').eq('user_id', params.id)
      if (!all) q = q.not('event_name', 'in', `(${Array.from(NOISY_EVENTS).join(',')})`)
      jobs.push(safe(before(q).order('created_at', { ascending: false }).limit(per), fromEvents))
    }
  }

  available.push('audit')
  if (want('audit')) {
    let q = sb.from('admin_audit_log').select('id, action, actor_id, actor_email, actor_role, metadata, created_at').eq('target_user_id', params.id)
    // Без права на журнал — только собственные действия сотрудника.
    if (!can('audit.view')) q = q.eq('actor_id', actor.id)
    jobs.push(safe(before(q).order('created_at', { ascending: false }).limit(per), fromAudit))
  }

  if (sensitive) {
    available.push('email', 'note', 'task')
    if (want('email')) {
      jobs.push(safe(
        before(sb.from('email_deliveries').select('id, kind, subject, status, created_at').eq('user_id', params.id))
          .order('created_at', { ascending: false }).limit(per),
        fromEmails,
      ))
    }
    if (want('note')) {
      jobs.push(safe(
        before(sb.from('user_notes').select('id, body, author_email, author_role, created_at').eq('user_id', params.id))
          .order('created_at', { ascending: false }).limit(per),
        fromNotes,
      ))
    }
    if (want('task')) {
      // Задача даёт два пункта (создана / выполнена) — отбор по курсору после нормализации.
      jobs.push(safe(
        sb.from('staff_tasks').select('id, title, status, created_at, done_at').eq('user_id', params.id)
          .order('created_at', { ascending: false }).limit(200),
        fromTasks,
      ))
    }
  }

  available.push('case')
  if (want('case')) {
    const casesHref = `${actor.role === 'super_expert' ? SUPER_EXPERT_BASE : GIGA_BASE}/cases`
    jobs.push(safe(
      sb.from('expert_cases').select('id, title, status, priority, created_at, updated_at').eq('user_id', params.id)
        .order('created_at', { ascending: false }).limit(200),
      (rows: Parameters<typeof fromCases>[0]) => fromCases(rows, casesHref),
    ))
  }

  available.push('comment')
  if (want('comment')) {
    jobs.push(safe(
      before(sb.from('expert_comments').select('id, text, author_title, block_key, created_at').eq('client_id', params.id))
        .order('created_at', { ascending: false }).limit(per),
      fromComments,
    ))
  }

  if (can('survey.view')) {
    available.push('survey')
    if (want('survey')) {
      jobs.push(safe(
        before(sb.from('survey_answer_history').select('id, question_key, source, created_at').eq('user_id', params.id))
          .order('created_at', { ascending: false }).limit(500),
        fromSurveyHistory,
      ))
    }
  }

  const sources = await Promise.all(jobs)
  const { items, nextCursor } = mergeTimeline(sources, { limit, cursor })
  return NextResponse.json({ ok: true, data: items, nextCursor, kinds: available })
}
