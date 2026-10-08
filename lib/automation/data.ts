/**
 * lib/automation/data.ts — чтение данных для cron-касаний (service role).
 *
 * Только выборки: решения принимают чистые планировщики (reminders.ts,
 * client-digest.ts, staff-digest.ts), отправку — notifyClient. Так тесты
 * подменяют этот модуль и проверяют всю цепочку без базы.
 *
 * Каждая функция устойчива к отсутствующей таблице: пустой результат вместо
 * исключения, чтобы один неприменённый кусок схемы не ронял весь прогон.
 */

import { createServiceClient } from '@/lib/supabase-service'
import type { SurveyStepRow } from '@/lib/survey/steps'

export interface ClientState {
  user_id: string
  registered_at: string | null
  approved_at: string | null
  status: string | null
  survey_steps: number
  survey_filled_steps: number[] | null
  survey_first_at: string | null
  survey_last_change_at: string | null
  survey_completed: boolean
  point_a_at: string | null
  gri_started_at: string | null
  gri_draft_updated_at: string | null
  gri_completed_at: string | null
}

const IN_CHUNK = 200
const QUERY_LIMIT = 50000

function chunks<T>(arr: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Состояние всех клиентов (RPC из миграции 089). Ошибка → исключение: без этих данных прогон бессмыслен. */
export async function fetchClientStates(): Promise<ClientState[]> {
  const { data, error } = await createServiceClient().rpc('automation_client_state')
  if (error) throw new Error(`automation_client_state: ${error.message}`)
  return (data ?? []) as ClientState[]
}

/** Ответы анкеты по пользователям — для точного «первого незаполненного шага». */
export async function fetchSurveyRows(userIds: string[]): Promise<Map<string, SurveyStepRow[]>> {
  const out = new Map<string, SurveyStepRow[]>()
  const sb = createServiceClient()
  for (const ids of chunks(userIds, 50)) {
    try {
      const { data } = await sb
        .from('survey_answers')
        .select('user_id, question_key, step, answer')
        .in('user_id', ids)
        .limit(QUERY_LIMIT)
      for (const r of (data ?? []) as Array<SurveyStepRow & { user_id: string }>) {
        const list = out.get(r.user_id) ?? []
        list.push({ question_key: r.question_key, step: r.step, answer: r.answer })
        out.set(r.user_id, list)
      }
    } catch (e) {
      console.warn('[automation] survey rows skipped', e)
    }
  }
  return out
}

export interface GriDraft {
  updatedAt: string
  completedSections: Record<string, boolean>
}

export async function fetchGriDrafts(userIds: string[]): Promise<Map<string, GriDraft>> {
  const out = new Map<string, GriDraft>()
  const sb = createServiceClient()
  for (const ids of chunks(userIds)) {
    try {
      const { data } = await sb.from('gri_assessment_drafts').select('user_id, state, updated_at').in('user_id', ids)
      for (const r of (data ?? []) as Array<{ user_id: string; state: unknown; updated_at: string }>) {
        const cs = (r.state as { completedSections?: unknown } | null)?.completedSections
        out.set(r.user_id, {
          updatedAt: r.updated_at,
          completedSections: cs && typeof cs === 'object' ? (cs as Record<string, boolean>) : {},
        })
      }
    } catch (e) {
      console.warn('[automation] GRI drafts skipped', e)
    }
  }
  return out
}

/** week_start пульса за последние ~12 недель. */
export async function fetchPulseWeeks(userIds: string[], sinceDate: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const sb = createServiceClient()
  for (const ids of chunks(userIds)) {
    try {
      const { data } = await sb
        .from('gri_pulse_responses')
        .select('user_id, week_start')
        .in('user_id', ids)
        .gte('week_start', sinceDate)
      for (const r of (data ?? []) as Array<{ user_id: string; week_start: string }>) {
        const list = out.get(r.user_id) ?? []
        list.push(String(r.week_start).slice(0, 10))
        out.set(r.user_id, list)
      }
    } catch (e) {
      console.warn('[automation] pulse weeks skipped', e)
    }
  }
  return out
}

// ─── Еженедельный дайджест ───────────────────────────────────────────────────

export interface GriSnapshot {
  griIndex: number | null
  createdAt: string
  topLimit: { criterionText: string; blockName: string } | null
}

/** Две последние GRI-оценки на пользователя (текущая и предыдущая). */
export async function fetchGriHistory(userIds: string[]): Promise<Map<string, GriSnapshot[]>> {
  const out = new Map<string, GriSnapshot[]>()
  const sb = createServiceClient()
  for (const ids of chunks(userIds)) {
    try {
      const { data } = await sb
        .from('gri_assessments')
        .select('user_id, gri_index, created_at, top_5_limits')
        .in('user_id', ids)
        .order('created_at', { ascending: false })
        .limit(QUERY_LIMIT)
      for (const r of (data ?? []) as Array<{ user_id: string; gri_index: unknown; created_at: string; top_5_limits?: unknown }>) {
        const list = out.get(r.user_id) ?? []
        if (list.length >= 2) continue
        const top = Array.isArray(r.top_5_limits) ? (r.top_5_limits[0] as { criterionText?: string; blockName?: string } | undefined) : undefined
        const idx = Number(r.gri_index)
        list.push({
          griIndex: Number.isFinite(idx) ? idx : null,
          createdAt: r.created_at,
          topLimit: top?.criterionText ? { criterionText: top.criterionText, blockName: top.blockName ?? '' } : null,
        })
        out.set(r.user_id, list)
      }
    } catch (e) {
      console.warn('[automation] GRI history skipped', e)
    }
  }
  return out
}

export interface PlanTask {
  id: string
  title: string
  dueDate: string | null
  status: string
  priority: number | null
}

/** Открытые задачи плана (action_items) — все, отбор по сроку делает планировщик. */
export async function fetchOpenPlanTasks(userIds: string[]): Promise<Map<string, PlanTask[]>> {
  const out = new Map<string, PlanTask[]>()
  const sb = createServiceClient()
  for (const ids of chunks(userIds)) {
    try {
      const { data } = await sb
        .from('action_items')
        .select('id, user_id, title, due_date, status, priority')
        .in('user_id', ids)
        .in('status', ['open', 'in_progress'])
        .limit(QUERY_LIMIT)
      for (const r of (data ?? []) as Array<{ id: string; user_id: string; title: string; due_date: string | null; status: string; priority: number | null }>) {
        const list = out.get(r.user_id) ?? []
        list.push({ id: String(r.id), title: r.title, dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null, status: r.status, priority: r.priority })
        out.set(r.user_id, list)
      }
    } catch (e) {
      console.warn('[automation] plan tasks skipped', e)
    }
  }
  return out
}

export interface ContentPage {
  slug: string
  title: string
  publishedAt: string
}

/** Материалы CMS, опубликованные после `sinceIso` (для всех — видимость «all»). */
export async function fetchPublishedContent(sinceIso: string): Promise<ContentPage[]> {
  try {
    const { data } = await createServiceClient()
      .from('cms_pages')
      .select('slug, title, published_at, visibility')
      .eq('status', 'published')
      .gte('published_at', sinceIso)
      .order('published_at', { ascending: false })
      .limit(20)
    return ((data ?? []) as Array<{ slug: string; title: string; published_at: string; visibility?: { audience?: string } | null }>)
      .filter((p) => !p.visibility?.audience || p.visibility.audience === 'all')
      .map((p) => ({ slug: p.slug, title: p.title, publishedAt: p.published_at }))
  } catch {
    return []
  }
}

/** Ключи NBA, выполненных за последние 7 дней (чтобы не советовать сделанное). */
export async function fetchNbaDone(userIds: string[], sinceIso: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  const sb = createServiceClient()
  for (const ids of chunks(userIds)) {
    try {
      const { data } = await sb
        .from('nba_log')
        .select('user_id, action_key')
        .in('user_id', ids)
        .eq('event', 'done')
        .gte('created_at', sinceIso)
      for (const r of (data ?? []) as Array<{ user_id: string; action_key: string }>) {
        const set = out.get(r.user_id) ?? new Set<string>()
        set.add(r.action_key)
        out.set(r.user_id, set)
      }
    } catch {
      /* nba_log может отсутствовать */
    }
  }
  return out
}

/** Последний дайджест на пользователя (маркер в automation_sends). */
export async function fetchLastDigests(userIds: string[]): Promise<Map<string, { sentAt: string; griIndex: number | null }>> {
  const out = new Map<string, { sentAt: string; griIndex: number | null }>()
  const sb = createServiceClient()
  for (const ids of chunks(userIds)) {
    try {
      const { data } = await sb
        .from('automation_sends')
        .select('user_id, sent_at, metadata')
        .eq('kind', 'client_digest')
        .in('user_id', ids)
        .order('sent_at', { ascending: false })
        .limit(QUERY_LIMIT)
      for (const r of (data ?? []) as Array<{ user_id: string; sent_at: string; metadata?: { gri_index?: unknown } | null }>) {
        if (out.has(r.user_id)) continue
        const idx = Number(r.metadata?.gri_index)
        out.set(r.user_id, { sentAt: r.sent_at, griIndex: r.metadata?.gri_index != null && Number.isFinite(idx) ? idx : null })
      }
    } catch {
      /* журнал может отсутствовать */
    }
  }
  return out
}

// ─── Сводка персоналу ────────────────────────────────────────────────────────

export interface PendingRequest {
  userId: string
  createdAt: string
}

/** Клиенты, ждущие одобрения (profiles.status = pending_approval). */
export async function fetchPendingRequests(): Promise<PendingRequest[]> {
  const { data, error } = await createServiceClient()
    .from('profiles')
    .select('id, created_at')
    .eq('role', 'client')
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true })
    .limit(QUERY_LIMIT)
  if (error) throw new Error(`pending requests: ${error.message}`)
  return ((data ?? []) as Array<{ id: string; created_at: string }>).map((r) => ({ userId: r.id, createdAt: r.created_at }))
}

export interface StaffTask {
  id: string
  assigneeId: string | null
  clientId: string | null
  title: string
  dueAt: string
}

/** Открытые staff_tasks со сроком раньше `beforeIso`. */
export async function fetchOverdueStaffTasks(beforeIso: string): Promise<StaffTask[]> {
  try {
    const { data } = await createServiceClient()
      .from('staff_tasks')
      .select('id, assignee_id, user_id, title, due_at')
      .eq('status', 'open')
      .lt('due_at', beforeIso)
      .order('due_at', { ascending: true })
      .limit(QUERY_LIMIT)
    return ((data ?? []) as Array<{ id: string; assignee_id: string | null; user_id: string | null; title: string; due_at: string }>).map((r) => ({
      id: r.id,
      assigneeId: r.assignee_id,
      clientId: r.user_id,
      title: r.title,
      dueAt: r.due_at,
    }))
  } catch {
    return []
  }
}

/** Имена/компании клиентов для списков задач. */
export async function fetchProfileLabels(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const sb = createServiceClient()
  for (const ids of chunks(userIds)) {
    try {
      const { data } = await sb.from('profiles').select('id, full_name, organization, email').in('id', ids)
      for (const r of (data ?? []) as Array<{ id: string; full_name?: string | null; organization?: string | null; email?: string | null }>) {
        const name = r.full_name?.trim() || r.email?.trim() || 'Клиент'
        out.set(r.id, r.organization?.trim() ? `${name} · ${r.organization.trim()}` : name)
      }
    } catch {
      /* подписи — не критично */
    }
  }
  return out
}

export interface DayCounts {
  registrations: number
  surveysCompleted: number
  griCompleted: number
}

async function countRows(table: string, apply: (q: ReturnType<ReturnType<typeof createServiceClient>['from']>) => unknown): Promise<number> {
  try {
    const base = createServiceClient().from(table)
    const q = apply(base) as PromiseLike<{ count: number | null; error: unknown }>
    const { count, error } = await q
    return error ? 0 : count ?? 0
  } catch {
    return 0
  }
}

/** Регистрации / отправленные анкеты / пройденные GRI за интервал [fromIso, toIso). */
export async function fetchDayCounts(fromIso: string, toIso: string): Promise<DayCounts> {
  const [registrations, surveysCompleted, griCompleted] = await Promise.all([
    countRows('profiles', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('role', 'client').gte('created_at', fromIso).lt('created_at', toIso),
    ),
    // Маркер «анкета отправлена» (lib/survey/completion-notice.ts, миграция 071).
    countRows('app_notifications', (q) =>
      q
        .select('id', { count: 'exact', head: true })
        .eq('category', 'survey')
        .contains('metadata', { event: 'survey_completed' })
        .gte('created_at', fromIso)
        .lt('created_at', toIso),
    ),
    countRows('gri_assessments', (q) =>
      q.select('id', { count: 'exact', head: true }).gte('created_at', fromIso).lt('created_at', toIso),
    ),
  ])
  return { registrations, surveysCompleted, griCompleted }
}
