/**
 * lib/mcp/tools.ts — the MCP tools (all READ-ONLY).
 *
 * Tool definitions follow MCP «Tools» (revision 2026-07-28,
 * https://modelcontextprotocol.io/specification/2026-07-28/server/tools):
 * name, title, description, inputSchema (JSON Schema; generated from the zod
 * schema that also validates the call), annotations. Input validation errors
 * are TOOL execution errors (`isError: true`) so the model can correct itself;
 * an unknown tool is a protocol error (-32602).
 *
 * Every tool names ONE scope it needs (lib/mcp/scopes.ts). The server checks
 * it against the credential AND the caller's current role before `run`.
 * Results are plain JSON objects, bounded in size (lists ≤ 50 rows, strings
 * truncated, and a final byte cap in lib/mcp/server.ts).
 */
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { createServiceClient } from '@/lib/supabase-service'
import { loadCompanyMetrics } from '@/lib/metrics/company-metrics'
import { loadPointAOverview } from '@/lib/point-a/overview'
import { listTasks, parseTaskCursor } from '@/lib/agents/admin'
import { spendSummary } from '@/lib/ai/providers/service'
import {
  clientCard, clientCompanyExists, companyNames, COMPANY_ID_RE, decodeOffsetCursor, encodeOffsetCursor,
  listDiagnostics, listPublishedReports, searchClients,
} from './data'
import { freeText } from './pii'
import type { McpScope } from './scopes'
import type { McpPrincipal } from './principal'

export interface ToolContext {
  principal: McpPrincipal
  /** Scopes of the credential ∩ scopes of the current role. */
  scopes: readonly McpScope[]
  /** May contacts be shown unmasked (scope clients:pii)? */
  pii: boolean
  now: Date
}

/** A failure the model can act on (bad argument, unknown company): becomes `isError: true`. */
export class ToolInputError extends Error {}

interface ToolDef<S extends z.ZodTypeAny> {
  name: string
  title: string
  description: string
  scope: McpScope
  input: S
  run(args: z.infer<S>, ctx: ToolContext): Promise<Record<string, unknown>>
}

const companyId = z.string().regex(COMPANY_ID_RE, 'company_id: идентификатор компании из search_clients').describe('Идентификатор компании (company_id из search_clients)')
const cursor = z.string().max(200).optional().describe('Курсор следующей страницы (next_cursor из предыдущего ответа)')
const limit = (max: number, def: number) => z.number().int().min(1).max(max).default(def).describe(`Сколько записей вернуть (1–${max}, по умолчанию ${def})`)

function offsetOf(c: string | undefined): number {
  const o = decodeOffsetCursor(c)
  if (o === null) throw new ToolInputError('Некорректный cursor — передайте next_cursor из предыдущего ответа')
  return o
}

function page<T>(items: T[], hasMore: boolean, offset: number, limitN: number) {
  return { items, next_cursor: hasMore ? encodeOffsetCursor(offset + limitN) : null }
}

async function requireClientCompany(id: string): Promise<void> {
  if (!(await clientCompanyExists(id))) throw new ToolInputError(`Компания ${id} не найдена среди клиентов`)
}

function def<S extends z.ZodTypeAny>(d: ToolDef<S>): ToolDef<S> {
  return d
}

export const TOOLS = [
  def({
    name: 'search_clients',
    title: 'Поиск клиентов',
    description: 'Ищет клиентов (компании) по названию компании или имени владельца; с правом на контакты — и по email. Без query возвращает недавно обновлённые. Возвращает company_id для остальных инструментов.',
    scope: 'clients:read',
    input: z.object({
      query: z.string().trim().min(2).max(80).optional().describe('Название компании, имя владельца или email (не короче 2 символов)'),
      limit: limit(50, 20),
      cursor,
    }).strict(),
    async run(a, ctx) {
      const offset = offsetOf(a.cursor)
      const r = await searchClients({ query: a.query ?? null, pii: ctx.pii, limit: a.limit, offset })
      return page(r.items, r.hasMore, offset, a.limit)
    },
  }),
  def({
    name: 'get_client',
    title: 'Карточка клиента',
    description: 'Карточка клиента: компания, владелец, контактное лицо, текущая диагностика (баллы по направлениям, пробелы в данных), последняя сессия, ключевые находки. Укажите company_id или user_id владельца.',
    scope: 'clients:read',
    input: z.object({
      company_id: companyId.optional(),
      user_id: z.string().uuid().optional().describe('UUID владельца-клиента (owner.user_id)'),
    }).strict().refine((v) => (v.company_id ? 1 : 0) + (v.user_id ? 1 : 0) === 1, { message: 'Укажите ровно одно: company_id или user_id' }),
    async run(a, ctx) {
      const card = await clientCard({ companyId: a.company_id, userId: a.user_id, pii: ctx.pii })
      if (!card) throw new ToolInputError('Клиент не найден')
      return card
    },
  }),
  def({
    name: 'get_point_a',
    title: 'Точка А компании',
    description: 'Обзор Точки А: общий балл, индекс здоровья, зрелость, GRI, полнота данных и что добавить, проблемные зоны, ключевые риски, сильные стороны, критичные пробелы, источники данных.',
    scope: 'diagnostics:read',
    input: z.object({ company_id: companyId }).strict(),
    async run(a, ctx) {
      await requireClientCompany(a.company_id)
      // Same builder as GET /api/v1/point-a/overview; read with the service
      // role after the MCP authorisation (the caller has no Supabase session).
      const sb = createServiceClient()
      const overview = await loadPointAOverview(sb, { companyId: a.company_id }, ctx.now, { ownerCountsClient: sb })
      return { point_a: overview }
    },
  }),
  def({
    name: 'list_diagnostics',
    title: 'Диагностики компании',
    description: 'Сессии диагностики компании (новые первыми): статус, полнота, источники, ошибка, и рассчитанная диагностика сессии (балл, индекс здоровья, стадия).',
    scope: 'diagnostics:read',
    input: z.object({ company_id: companyId, limit: limit(20, 10), cursor }).strict(),
    async run(a, ctx) {
      await requireClientCompany(a.company_id)
      const offset = offsetOf(a.cursor)
      const r = await listDiagnostics({ companyId: a.company_id, pii: ctx.pii, limit: a.limit, offset })
      return page(r.items, r.hasMore, offset, a.limit)
    },
  }),
  def({
    name: 'get_metrics',
    title: 'Метрики компании',
    description: 'Текущие значения метрик компании (тот же источник, что страница «Метрики», дашборд и Точка А): значение, единица, источник, уверенность, период, время расчёта.',
    scope: 'metrics:read',
    input: z.object({
      company_id: companyId,
      metric_ids: z.array(z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/)).max(50).optional()
        .describe('Только эти метрики (идентификаторы вида biz.finance.revenue); по умолчанию все'),
      limit: limit(200, 100),
    }).strict(),
    async run(a) {
      await requireClientCompany(a.company_id)
      const metrics = await loadCompanyMetrics(createServiceClient(), a.company_id, a.metric_ids)
      const all = [...metrics.values()].sort((x, y) => x.metricId.localeCompare(y.metricId))
      return {
        company_id: a.company_id,
        total: all.length,
        truncated: all.length > a.limit,
        metrics: all.slice(0, a.limit).map((m) => ({
          metric_id: m.metricId,
          label: m.label,
          value: m.value,
          unit: m.unit,
          source: m.source,
          confidence: m.confidence,
          period_year: m.periodYear,
          period_quarter: m.periodQuarter,
          computed_at: m.computedAt,
        })),
      }
    },
  }),
  def({
    name: 'list_reports',
    title: 'Опубликованные отчёты',
    description: 'Опубликованные версии отчётов (Точка А, полный, GRI, Точка Б) — по компании или по всем клиентам, новые первыми. Черновики и версии на проверке не показываются.',
    scope: 'reports:read',
    input: z.object({ company_id: companyId.optional(), limit: limit(50, 20), cursor }).strict(),
    async run(a) {
      if (a.company_id) await requireClientCompany(a.company_id)
      const offset = offsetOf(a.cursor)
      const r = await listPublishedReports({ companyId: a.company_id ?? null, limit: a.limit, offset })
      return page(r.items, r.hasMore, offset, a.limit)
    },
  }),
  def({
    name: 'list_agent_tasks',
    title: 'Задачи ИИ-агентов',
    description: 'Задачи ИИ-агентов (новые первыми) с фильтрами по статусу, агенту и компании: попытки, код и текст ошибки, стоимость.',
    scope: 'agents:read',
    input: z.object({
      status: z.enum(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'dead', 'cancelled']).optional(),
      agent_key: z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/).optional().describe('Ключ агента, например diagnostic_orchestrator'),
      company_id: companyId.optional(),
      limit: limit(50, 20),
      cursor,
    }).strict(),
    async run(a, ctx) {
      if (a.cursor && !parseTaskCursor(a.cursor)) throw new ToolInputError('Некорректный cursor — передайте next_cursor из предыдущего ответа')
      const r = await listTasks({ status: a.status ?? null, agentKey: a.agent_key ?? null, companyId: a.company_id ?? null, limit: a.limit, before: a.cursor ?? null })
      const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
      const t = (v: unknown) => (v instanceof Date ? v.toISOString() : s(v))
      return {
        items: r.items.map((x) => ({
          task_id: s(x.id),
          agent_key: s(x.agent_key),
          company_id: s(x.company_id),
          company_name: s(x.company_name),
          trigger: s(x.trigger),
          status: s(x.status),
          attempts: Number(x.attempts ?? 0),
          max_attempts: Number(x.max_attempts ?? 0),
          last_error_code: s(x.last_error_code),
          last_error: freeText(x.last_error, ctx.pii, 300),
          cost_usd: Number(x.cost_usd ?? 0),
          created_at: t(x.created_at),
          started_at: t(x.started_at),
          finished_at: t(x.finished_at),
        })),
        next_cursor: r.nextCursor,
      }
    },
  }),
  def({
    name: 'get_ai_spend',
    title: 'Расходы на ИИ',
    description: 'Расходы на ИИ за период (функции платформы и агенты) с группировкой по провайдеру, модели, функции или компании; самые дорогие первыми.',
    scope: 'spend:read',
    input: z.object({
      days: z.number().int().min(1).max(90).default(7).describe('Период в днях (1–90, по умолчанию 7)'),
      group_by: z.enum(['provider', 'model', 'feature', 'company']).default('provider'),
    }).strict(),
    async run(a) {
      const s = await spendSummary({ days: a.days, groupBy: a.group_by })
      const rows = s.rows.slice(0, 50)
      const names = a.group_by === 'company' ? await companyNames(rows.map((r) => r.key).filter((k): k is string => Boolean(k))) : new Map<string, string>()
      return {
        days: s.days,
        group_by: s.groupBy,
        total_usd: Math.round(s.totalUsd * 1e6) / 1e6,
        truncated: s.rows.length > rows.length,
        rows: rows.map((r) => ({
          key: r.key,
          ...(a.group_by === 'company' ? { company_name: r.key ? names.get(r.key) ?? null : null } : {}),
          cost_usd: Math.round(r.costUsd * 1e6) / 1e6,
          calls: r.calls,
          tokens_in: r.tokensIn,
          tokens_out: r.tokensOut,
        })),
      }
    },
  }),
] as const

export type AnyTool = (typeof TOOLS)[number]

export function findTool(name: string): AnyTool | null {
  return (TOOLS as readonly AnyTool[]).find((t) => t.name === name) ?? null
}

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

/** JSON Schema of a tool's input (no $schema: MCP defaults to 2020-12, which these simple schemas satisfy). */
function inputSchemaOf(t: AnyTool): Record<string, unknown> {
  const schema = zodToJsonSchema(t.input, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>
  delete schema.$schema
  return schema
}

/** Tool definitions for tools/list, in a deterministic order (MCP: SHOULD, for client caching). */
export function toolDefinitions(allowed: readonly McpScope[]): Array<Record<string, unknown>> {
  return (TOOLS as readonly AnyTool[])
    .filter((t) => allowed.includes(t.scope))
    .map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: inputSchemaOf(t),
      annotations: { title: t.title, ...READ_ONLY_ANNOTATIONS },
    }))
}

/** Validate arguments; a readable message on failure. */
export function parseToolArgs(t: AnyTool, args: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const r = (t.input as z.ZodTypeAny).safeParse(args ?? {})
  if (r.success) return { ok: true, value: r.data }
  const msg = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'аргументы'}: ${i.message}`).join('; ')
  return { ok: false, message: `Некорректные аргументы — ${msg}` }
}

export async function runTool(t: AnyTool, value: unknown, ctx: ToolContext): Promise<Record<string, unknown>> {
  return (t.run as (a: unknown, c: ToolContext) => Promise<Record<string, unknown>>)(value, ctx)
}
