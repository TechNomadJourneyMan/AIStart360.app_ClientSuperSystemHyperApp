/**
 * Read tools of the bot assistant.
 *
 *   • the 8 MCP tools (lib/mcp/tools.ts) through runTool with the role's MCP
 *     scopes (allowedScopes) and PII only with clients:pii (users.sensitive);
 *   • admin bot: access requests and users, clients stuck on the survey, staff
 *     tasks, escalations (cases), platform events, agents and pending approvals
 *     — each gated by the GIGA permission of the screen it mirrors;
 *   • both bots: client analysis (GRI weak blocks, Point A, dynamics), reports
 *     waiting for the expert and one report version's content.
 * Every tool respects the person's client scope (./scope.ts). Contacts are
 * masked without PII. Results are bounded here and capped again by the engine.
 */
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { maskEmail, maskPhone } from '@/lib/admin/mask'
import { listAgentOverviews, listApprovals } from '@/lib/agents/admin'
import { TOOLS, ToolInputError, parseToolArgs, runTool, type AnyTool } from '@/lib/mcp/tools'
import { clientCard, clientCompanyExists, COMPANY_ID_RE } from '@/lib/mcp/data'
import { freeText } from '@/lib/mcp/pii'
import type { McpPrincipal } from '@/lib/mcp/principal'
import type { McpRole, McpScope } from '@/lib/mcp/scopes'
import { listInReviewVersions } from '@/lib/reports/review-flow'
import { getReportVersion } from '@/lib/reports/versions'
import { SURVEY_TOTAL_STEPS } from '@/lib/survey/steps'
import { pendingRegistrations, searchUsers, userCard } from '../bots/data'
import { companyAllowed, filterResultByScope, NOT_ASSIGNED, userAllowed } from './scope'
import { BrainToolError, roleCan, type BrainRole, type BrainTool, type ToolRunContext } from './types'

const UUID = z.string().uuid()
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const email = (v: string | null | undefined, pii: boolean) => (pii ? v ?? null : maskEmail(v))
const companyId = z.string().regex(COMPANY_ID_RE, 'company_id: идентификатор компании из search_clients')

/** Scopes the expert bot works with: clients only (no agents, no spend). */
export const EXPERT_BOT_SCOPES: readonly McpScope[] = ['clients:read', 'clients:pii', 'diagnostics:read', 'metrics:read', 'reports:read']

/** MCP role of the person (staff RBAC, or expert by profile role). */
export function mcpRoleOf(role: BrainRole): McpRole {
  if (role.bot === 'admin') return { kind: 'staff', staffRole: role.staffRole }
  if (role.staffRole) return { kind: 'staff', staffRole: role.staffRole }
  return { kind: 'expert', profileRole: role.profileRole }
}

function principalOf(t: ToolRunContext): McpPrincipal {
  return { userId: t.role.userId, email: t.role.email, role: mcpRoleOf(t.role), allowed: [...t.mcpScopes] }
}

async function requireCompany(t: ToolRunContext, id: string): Promise<void> {
  if (!companyAllowed(t.scope, id)) throw new BrainToolError(NOT_ASSIGNED)
  if (!(await clientCompanyExists(id))) throw new BrainToolError(`Компания ${id} не найдена среди клиентов`)
}

// ─── MCP tools ───────────────────────────────────────────────────────────────

function mcpTool(tool: AnyTool): BrainTool {
  return {
    name: tool.name,
    description: tool.description,
    kind: 'read',
    input: tool.input as z.ZodTypeAny,
    available: (role, scopes) => scopes.includes(tool.scope) && (role.bot === 'admin' || EXPERT_BOT_SCOPES.includes(tool.scope)),
    async run(raw, t) {
      const parsed = parseToolArgs(tool, raw)
      if (!parsed.ok) throw new BrainToolError(parsed.message)
      const args = parsed.value as { company_id?: string; user_id?: string; group_by?: string }
      if (args.company_id && !companyAllowed(t.scope, args.company_id)) throw new BrainToolError(NOT_ASSIGNED)
      if (args.user_id && !userAllowed(t.scope, args.user_id)) throw new BrainToolError(NOT_ASSIGNED)
      try {
        const data = await runTool(tool, parsed.value, { principal: principalOf(t), scopes: t.mcpScopes, pii: t.pii, now: t.now })
        return filterResultByScope(t.scope, data, { keyIsCompany: tool.name === 'get_ai_spend' && args.group_by === 'company' })
      } catch (err) {
        if (err instanceof ToolInputError) throw new BrainToolError(err.message)
        throw err
      }
    },
  }
}

export const MCP_BRAIN_TOOLS: BrainTool[] = (TOOLS as readonly AnyTool[]).map(mcpTool)

// ─── Admin bot: people and operations ────────────────────────────────────────

export interface StuckClient {
  user_id: string
  survey_steps: number
  survey_updated_at: Date | null
  last_seen_at: Date | null
  full_name: string | null
  email: string | null
  company_name: string | null
}

/**
 * Approved clients who started the survey (the CJM journey of
 * admin_journey_stages) but did not finish it and have not touched it for
 * `minIdleDays` days, oldest first.
 */
export async function findStuckOnSurvey(minIdleDays: number): Promise<StuckClient[]> {
  return prisma.$queryRaw<StuckClient[]>`
    SELECT j.user_id::text, j.survey_steps, j.survey_updated_at, j.last_seen_at, p.full_name, p.email, c.name AS company_name
    FROM public.admin_journey_stages() j
    JOIN public.profiles p ON p.id = j.user_id
    LEFT JOIN public.companies c ON c.user_id = j.user_id
    WHERE j.survey_steps > 0 AND j.survey_steps < ${SURVEY_TOTAL_STEPS}
      AND p.status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = j.user_id)
      AND (j.survey_updated_at IS NULL OR j.survey_updated_at < now() - make_interval(days => ${Math.max(0, Math.min(180, Math.floor(minIdleDays)))}::int))
    ORDER BY j.survey_updated_at ASC NULLS FIRST
    LIMIT 500`
}

const adminWith = (...perms: Parameters<typeof roleCan>[1][]) => (role: BrainRole) => perms.every((p) => roleCan(role, p))

const limitOf = (max: number, def: number) => z.number().int().min(1).max(max).default(def)

export const ADMIN_READ_TOOLS: BrainTool[] = [
  {
    name: 'list_access_requests',
    description: 'Заявки на доступ к платформе, ожидающие решения (новые первыми): user_id, имя, email, организация, дата.',
    kind: 'read',
    input: z.object({ limit: limitOf(20, 10) }).strict(),
    available: adminWith('users.view'),
    async run(raw, t) {
      const a = (raw as { limit: number })
      const { items, hasMore } = await pendingRegistrations(0, a.limit)
      return {
        items: items.map((r) => ({ user_id: r.user_id, full_name: r.full_name, email: email(r.email, t.pii), organization: r.organization, created_at: iso(r.created_at) })),
        has_more: hasMore,
      }
    },
  },
  {
    name: 'find_users',
    description: 'Поиск пользователей платформы по имени, организации или email (email — только с правом на контакты): user_id, роль, статус.',
    kind: 'read',
    input: z.object({ query: z.string().trim().min(2).max(80), limit: limitOf(20, 10) }).strict(),
    available: adminWith('users.view'),
    async run(raw, t) {
      const a = raw as { query: string; limit: number }
      // Without contacts a hit on an e-mail would confirm an address the person cannot read.
      if (!t.pii && a.query.includes('@')) throw new BrainToolError('Поиск по email доступен только с правом на контакты (users.sensitive)')
      const { items, hasMore } = await searchUsers(a.query, 0, a.limit)
      return filterResultByScope(t.scope, {
        items: items.map((u) => ({ user_id: u.id, full_name: u.full_name, email: email(u.email, t.pii), role: u.role, status: u.status, organization: u.organization, created_at: iso(u.created_at) })),
        has_more: hasMore,
      })
    },
  },
  {
    name: 'get_user',
    description: 'Карточка пользователя по user_id: роль, статус, компания, регистрация, последний визит, контакты (маскируются без права на контакты).',
    kind: 'read',
    input: z.object({ user_id: UUID }).strict(),
    available: adminWith('users.view'),
    async run(raw, t) {
      const a = raw as { user_id: string }
      if (!userAllowed(t.scope, a.user_id)) throw new BrainToolError(NOT_ASSIGNED)
      const u = await userCard(a.user_id)
      if (!u) throw new BrainToolError('Пользователь не найден')
      return {
        user_id: u.id, full_name: u.full_name, email: email(u.email, t.pii), phone: t.pii ? u.phone : maskPhone(u.phone),
        role: u.role, staff_role: u.staff_role, status: u.status, organization: u.organization,
        company_id: u.company_id, company_name: u.company_name, created_at: iso(u.created_at), last_seen_at: iso(u.last_seen_at),
      }
    },
  },
  {
    name: 'list_stuck_on_survey',
    description: `Клиенты, которые начали анкету, но не закончили и давно её не трогали: шагов заполнено из ${SURVEY_TOTAL_STEPS}, последнее изменение, последний визит. Для напоминаний.`,
    kind: 'read',
    input: z.object({
      min_idle_days: z.number().int().min(0).max(180).default(3).describe('Анкету не меняли хотя бы столько дней'),
      limit: limitOf(50, 20),
    }).strict(),
    available: adminWith('users.view', 'survey.view'),
    async run(raw, t) {
      const a = raw as { min_idle_days: number; limit: number }
      const scoped = (await findStuckOnSurvey(a.min_idle_days)).filter((r) => userAllowed(t.scope, r.user_id))
      return {
        total_steps: SURVEY_TOTAL_STEPS,
        total: scoped.length,
        items: scoped.slice(0, a.limit).map((r) => ({
          user_id: r.user_id, full_name: r.full_name, email: email(r.email, t.pii), company_name: r.company_name,
          steps_done: Number(r.survey_steps), survey_updated_at: iso(r.survey_updated_at), last_seen_at: iso(r.last_seen_at),
        })),
      }
    },
  },
  {
    name: 'list_staff_tasks',
    description: 'Задачи сотрудников по клиентам: мои (по умолчанию) или всех (нужно право «Эксперты»), открытые или выполненные, можно только просроченные.',
    kind: 'read',
    input: z.object({
      assignee: z.enum(['me', 'all']).default('me'),
      status: z.enum(['open', 'done']).default('open'),
      overdue_only: z.boolean().default(false),
      limit: limitOf(50, 20),
    }).strict(),
    available: adminWith('users.view', 'users.sensitive'),
    async run(raw, t) {
      const a = raw as { assignee: 'me' | 'all'; status: 'open' | 'done'; overdue_only: boolean; limit: number }
      if (a.assignee === 'all' && !roleCan(t.role, 'experts.manage')) throw new BrainToolError('Чужие задачи видит только роль с правом «Эксперты» — запросите свои (assignee = me)')
      const me = a.assignee === 'me' ? t.role.userId : null
      const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT t.id::text, t.title, t.due_at, t.status, t.created_at, t.done_at, t.user_id::text AS client_id,
               cp.full_name AS client_name, c.name AS company_name, ap.full_name AS assignee_name
        FROM public.staff_tasks t
        LEFT JOIN public.profiles cp ON cp.id = t.user_id
        LEFT JOIN public.companies c ON c.user_id = t.user_id
        LEFT JOIN public.profiles ap ON ap.id = t.assignee_id
        WHERE t.status = ${a.status}
          AND (${me}::uuid IS NULL OR t.assignee_id = ${me}::uuid)
          AND (NOT ${a.overdue_only} OR (t.due_at IS NOT NULL AND t.due_at < now()))
        ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC
        LIMIT ${a.limit}`
      return {
        items: rows.map((r) => ({
          task_id: r.id, title: freeText(r.title, true, 300), status: r.status, due_at: iso(r.due_at), done_at: iso(r.done_at),
          overdue: r.status === 'open' && r.due_at instanceof Date && r.due_at < t.now,
          client: { id: r.client_id ?? null, name: r.client_name ?? null, company_name: r.company_name ?? null },
          assignee_name: r.assignee_name ?? null, created_at: iso(r.created_at),
        })),
      }
    },
  },
  {
    name: 'list_cases',
    description: 'Эскалации — обращения клиентов к эксперту со сроком реакции (SLA): статус, приоритет, тема, кто ведёт, просрочена ли реакция.',
    kind: 'read',
    input: z.object({ status: z.enum(['open', 'all']).default('open'), overdue_only: z.boolean().default(false), limit: limitOf(50, 20) }).strict(),
    available: adminWith('users.view'),
    async run(raw, t) {
      const a = raw as { status: 'open' | 'all'; overdue_only: boolean; limit: number }
      const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT k.id::text, k.user_id::text, k.status, k.priority, k.trigger_type, k.title, k.summary, k.user_message,
               k.assignee_id::text, k.sla_due_at, k.first_response_at, k.created_at, p.full_name AS client_name, c.name AS company_name
        FROM public.expert_cases k
        LEFT JOIN public.profiles p ON p.id = k.user_id
        LEFT JOIN public.companies c ON c.user_id = k.user_id
        WHERE (${a.status} = 'all' OR k.status IN ('new', 'in_progress'))
          AND (NOT ${a.overdue_only} OR (k.status IN ('new', 'in_progress') AND k.first_response_at IS NULL AND k.sla_due_at < now()))
        ORDER BY k.created_at DESC
        LIMIT 300`
      // «Только назначенные»: кейсы своих клиентов и назначенные лично (как GET /api/giga-admin/cases).
      const visible = rows.filter((r) => userAllowed(t.scope, String(r.user_id)) || r.assignee_id === t.role.userId)
      return {
        items: visible.slice(0, a.limit).map((r) => ({
          case_id: r.id, status: r.status, priority: r.priority, trigger: r.trigger_type,
          title: freeText(r.title, t.pii, 200), summary: freeText(r.summary, t.pii, 300),
          client: { id: r.user_id, name: r.client_name ?? null, company_name: r.company_name ?? null },
          assigned_to_me: r.assignee_id === t.role.userId, unassigned: !r.assignee_id,
          sla_due_at: iso(r.sla_due_at), responded: Boolean(r.first_response_at),
          sla_overdue: !r.first_response_at && r.sla_due_at instanceof Date && r.sla_due_at < t.now,
          created_at: iso(r.created_at),
        })),
      }
    },
  },
  {
    name: 'list_platform_events',
    description: 'События платформы (анкета завершена, документ загружен, отчёт сгенерирован и т. п.) за последние часы, новые первыми; фильтр по имени события или компании.',
    kind: 'read',
    input: z.object({
      hours: z.number().int().min(1).max(168).default(24),
      name: z.string().regex(/^[A-Z][A-Z_]{2,63}$/).optional().describe('Имя события, например SURVEY_COMPLETED'),
      company_id: companyId.optional(),
      limit: limitOf(50, 30),
    }).strict(),
    available: adminWith('activity.view'),
    async run(raw, t) {
      const a = raw as { hours: number; name?: string; company_id?: string; limit: number }
      if (a.company_id && !companyAllowed(t.scope, a.company_id)) throw new BrainToolError(NOT_ASSIGNED)
      const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT e.name, e.company_id, c.name AS company_name, e.subject_type, e.created_at, e.dispatch_error IS NOT NULL AS failed
        FROM public.platform_events e LEFT JOIN public.companies c ON c.id = e.company_id
        WHERE e.created_at > now() - make_interval(hours => ${a.hours}::int)
          AND (${a.name ?? null}::text IS NULL OR e.name = ${a.name ?? null})
          AND (${a.company_id ?? null}::text IS NULL OR e.company_id = ${a.company_id ?? null})
        ORDER BY e.id DESC
        LIMIT ${a.limit}`
      return filterResultByScope(t.scope, {
        items: rows.map((r) => ({ name: r.name, company_id: r.company_id ?? null, company_name: r.company_name ?? null, subject_type: r.subject_type ?? null, created_at: iso(r.created_at), dispatch_failed: Boolean(r.failed) })),
      })
    },
  },
  {
    name: 'list_agents',
    description: 'ИИ-агенты платформы: включён ли, запуски и ошибки за 7 дней, расход, очередь, ждут одобрения, dead-letter за 24 ч, последний запуск.',
    kind: 'read',
    input: z.object({}).strict(),
    available: adminWith('agents.view'),
    async run() {
      const all = await listAgentOverviews()
      return {
        items: all.map((a) => ({
          key: a.key, name: a.name, enabled: a.enabled, scope: a.scope,
          runs_7d: a.stats.runs7d, failed_7d: a.stats.failed7d, cost_usd_7d: a.stats.costUsd7d, cost_usd_today: a.stats.costUsdToday,
          queued: a.stats.queued, running: a.stats.running, awaiting_approval: a.stats.awaitingApproval, dead_24h: a.stats.dead24h,
          last_run_at: iso(a.stats.lastRunAt), last_run_status: a.stats.lastRunStatus ?? null,
        })),
      }
    },
  },
  {
    name: 'list_pending_approvals',
    description: 'Действия ИИ-агентов, ждущие решения человека: approval_id, агент, компания, инструмент, что собирается сделать, срок.',
    kind: 'read',
    input: z.object({ limit: limitOf(30, 10) }).strict(),
    available: adminWith('agents.view'),
    async run(raw, t) {
      const a = raw as { limit: number }
      const rows = (await listApprovals('pending', 100)).filter((x) => !x.expires_at || new Date(x.expires_at as Date) > t.now)
      return filterResultByScope(t.scope, {
        total: rows.length,
        items: rows.slice(0, a.limit).map((x) => ({
          approval_id: String(x.id), task_id: String(x.task_id), agent_key: x.agent_key, company_id: (x.company_id as string | null) ?? null,
          company_name: x.company_name ?? null, tool: x.tool, permission: x.permission, summary: freeText(x.summary, t.pii, 300),
          requested_at: iso(x.requested_at), expires_at: iso(x.expires_at),
        })),
      })
    },
  },
]

// ─── Client analysis and reports (both bots) ─────────────────────────────────

const clientReader = (role: BrainRole, scopes: readonly McpScope[]) => scopes.includes('diagnostics:read') && (role.bot === 'expert' || roleCan(role, 'users.view'))

function weakest(avgs: unknown, n = 3): Array<{ block: string; score: number }> {
  if (!avgs || typeof avgs !== 'object') return []
  return Object.entries(avgs as Record<string, unknown>)
    .map(([block, v]) => ({ block, score: num(v) }))
    .filter((x): x is { block: string; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
}

export const CLIENT_INSIGHT_TOOLS: BrainTool[] = [
  {
    name: 'analyze_client',
    description: 'Разбор клиента для эксперта: карточка и баллы по направлениям Точки А, ключевые находки и пробелы, GRI (индекс, 3 самых слабых блока, топ ограничений), динамика баллов по прошлым диагностикам и GRI.',
    kind: 'read',
    input: z.object({ company_id: companyId }).strict(),
    available: clientReader,
    async run(raw, t) {
      const a = raw as { company_id: string }
      await requireCompany(t, a.company_id)
      const [card, diagnostics, gri] = await Promise.all([
        clientCard({ companyId: a.company_id, pii: t.pii }),
        prisma.$queryRaw<Array<{ overall_score: unknown; health_index: unknown; calculated_at: Date; is_current: boolean }>>`
          SELECT overall_score, health_index, calculated_at, is_current FROM public.diagnostics
          WHERE company_id = ${a.company_id} ORDER BY calculated_at DESC LIMIT 6`.catch(() => []),
        prisma.$queryRaw<Array<{ gri_index: unknown; section_avgs: unknown; top_5_limits: unknown; created_at: Date }>>`
          SELECT gri_index, section_avgs, top_5_limits, created_at FROM public.gri_assessments
          WHERE company_id = ${a.company_id} ORDER BY created_at DESC LIMIT 5`.catch(() => []),
      ])
      if (!card) throw new BrainToolError('Клиент не найден')
      const scores = diagnostics.map((d) => ({ overall_score: num(d.overall_score), health_index: num(d.health_index), calculated_at: iso(d.calculated_at), current: d.is_current }))
      const first = scores[scores.length - 1]?.overall_score
      const last = scores[0]?.overall_score
      const latestGri = gri[0]
      return {
        client: card,
        point_a_history: scores,
        point_a_change: first != null && last != null && scores.length > 1 ? Math.round((last - first) * 10) / 10 : null,
        gri: latestGri ? {
          index: num(latestGri.gri_index),
          at: iso(latestGri.created_at),
          weakest_blocks: weakest(latestGri.section_avgs),
          top_limits: Array.isArray(latestGri.top_5_limits) ? (latestGri.top_5_limits as unknown[]).slice(0, 5) : null,
          history: gri.map((g) => ({ index: num(g.gri_index), at: iso(g.created_at) })),
        } : null,
      }
    },
  },
  {
    name: 'list_reports_in_review',
    description: 'Версии отчётов, ждущие проверки эксперта (статус in_review): report_version_id, компания, тип, версия, дата.',
    kind: 'read',
    input: z.object({ limit: limitOf(30, 10) }).strict(),
    available: (role, scopes) => scopes.includes('reports:read') && (role.bot === 'expert' || roleCan(role, 'reports.review') || roleCan(role, 'agents.view')),
    async run(raw, t) {
      const a = raw as { limit: number }
      const rows = (await listInReviewVersions(100)).filter((v) => companyAllowed(t.scope, v.company_id))
      return {
        total: rows.length,
        items: rows.slice(0, a.limit).map((v) => ({ report_version_id: v.id, company_id: v.company_id, company_name: v.company_name, report_type: v.report_type, version: v.version, title: v.title, created_at: v.created_at })),
      }
    },
  },
  {
    name: 'get_report_version',
    description: 'Содержание версии отчёта (на проверке или опубликованной) для пересказа: заголовок, статус, выводы, рекомендации, нарратив.',
    kind: 'read',
    input: z.object({ report_version_id: UUID }).strict(),
    available: (role, scopes) => scopes.includes('reports:read') && (role.bot === 'expert' || roleCan(role, 'reports.review') || roleCan(role, 'agents.view')),
    async run(raw, t) {
      const a = raw as { report_version_id: string }
      const v = await getReportVersion(a.report_version_id)
      if (!v || !['in_review', 'published', 'ready'].includes(v.status)) throw new BrainToolError('Версия отчёта не найдена')
      if (!companyAllowed(t.scope, v.company_id)) throw new BrainToolError(NOT_ASSIGNED)
      return {
        report_version_id: v.id, company_id: v.company_id, company_name: v.company_name, report_type: v.report_type,
        version: v.version, status: v.status, title: v.title, confidence: v.confidence, created_at: v.created_at,
        content: v.content,
      }
    },
  },
]
