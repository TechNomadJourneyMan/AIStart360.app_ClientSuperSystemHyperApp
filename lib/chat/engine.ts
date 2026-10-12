/**
 * lib/chat/engine.ts — one turn of the unified AI chat (spec 2026-10-12 §6):
 * model → tools → model …, at most MAX_STEPS steps. Tool results go back to
 * the model fenced as untrusted data; a proposal stops the turn (the user
 * decides). Progress is reported through `onEvent` (the route streams it as
 * server-sent events). The llm is a port (chatWithTools in production, a
 * script in tests). Pure apart from the tools it runs.
 */
import { zodToJsonSchema } from 'zod-to-json-schema'
import { fenceUntrusted, UNTRUSTED_DATA_RULES } from '@/lib/ai/gateway'
import type { ChatWithToolsOptions, ChatWithToolsResult, ToolCall, ToolChatMessage, ToolDefinition } from '@/lib/ai/tools-chat'
import { ChatToolError, type ChatTool, type ToolContext } from './tools'

export const MAX_STEPS = 6
const MAX_TOOL_CALLS_PER_STEP = 6
const TOOL_RESULT_MAX_CHARS = 12_000

export type ChatSurface = 'point_a' | 'gri' | 'point_b' | 'dashboard' | 'global'

export interface ChatFocus {
  /** Block of Point A the user is looking at (finance …). */
  block?: string | null
  /** Metric the user asked about. */
  metric?: string | null
}

export type ChatEvent =
  | { type: 'status'; text: string }
  | { type: 'proposal'; actionId: string }
  | { type: 'answer'; text: string }
  | { type: 'error'; text: string }

export type ChatLlm = (opts: Pick<ChatWithToolsOptions, 'messages' | 'tools' | 'toolChoice' | 'tier'>) => Promise<ChatWithToolsResult>

const STATUS_RU: Record<string, string> = {
  get_point_a: 'Смотрю Точку А…',
  explain_block: 'Разбираю раздел…',
  get_metrics: 'Смотрю метрики…',
  get_metric_history: 'Смотрю историю метрики…',
  list_discrepancies: 'Смотрю расхождения…',
  get_goals: 'Смотрю цели…',
  get_gri: 'Смотрю GRI…',
  get_point_b: 'Смотрю Точку Б…',
  search_documents: 'Ищу в документах…',
  propose_metric_value: 'Готовлю изменение…',
  propose_resolve_discrepancy: 'Готовлю решение…',
  propose_goal: 'Готовлю цель…',
}

const SURFACE_RU: Record<ChatSurface, string> = {
  point_a: 'Точка А (текущее состояние бизнеса)',
  gri: 'GRI (готовность к росту)',
  point_b: 'Точка Б (цели и план)',
  dashboard: 'дашборд',
  global: 'портал',
}

export function systemPrompt(surface: ChatSurface, focus: ChatFocus, canManage: boolean, now: Date): string {
  return [
    'Ты — AI-аналитик платформы AIStart360. Отвечаешь владельцу бизнеса по-русски, коротко и по делу (до 8 предложений, списки — где уместно).',
    'Все цифры бери ТОЛЬКО из результатов инструментов. Нет данных — так и скажи и подскажи, где их взять (анкета, документы). Ничего не выдумывай.',
    'Различай факт, расчёт и гипотезу AI. Указывай период и источник важных цифр («66 млн ₸ · 2026 · анкета»).',
    'Точка А — текущее состояние, GRI — готовность к росту (отдельный показатель), Точка Б — цели и план.',
    canManage
      ? 'Менять данные ты не можешь. Если пользователь просит исправить значение, решить расхождение или поставить цель — вызови propose_* инструмент: пользователь увидит карточку и сам нажмёт «Применить». Скажи об этом одной фразой.'
      : 'Менять данные ты не можешь, предложения изменений этому пользователю недоступны — направь к владельцу компании.',
    `Пользователь сейчас на экране: ${SURFACE_RU[surface]}.${focus.block ? ` Открыт раздел: ${focus.block}.` : ''}${focus.metric ? ` Вопрос о метрике: ${focus.metric}.` : ''}`,
    `Сегодня ${now.toISOString().slice(0, 10)}.`,
    UNTRUSTED_DATA_RULES,
  ].join('\n')
}

export function toolSpec(t: ChatTool): ToolDefinition {
  const schema = zodToJsonSchema(t.input, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>
  delete schema.$schema
  return { type: 'function', function: { name: t.name, description: t.description, parameters: schema } }
}

async function runToolCall(call: ToolCall, tools: readonly ChatTool[], t: ToolContext): Promise<{ content: string; proposed: string | null }> {
  const tool = tools.find((x) => x.name === call.function.name)
  if (!tool) return { content: JSON.stringify({ error: 'Нет такого инструмента' }), proposed: null }
  let args: unknown
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
  } catch {
    return { content: JSON.stringify({ error: 'Аргументы не JSON' }), proposed: null }
  }
  const parsed = tool.input.safeParse(args)
  if (!parsed.success) return { content: JSON.stringify({ error: 'Неверные аргументы', issues: parsed.error.issues.slice(0, 3).map((i) => i.message) }), proposed: null }
  try {
    const out = await tool.run(parsed.data, t)
    const json = JSON.stringify(out)
    return {
      content: fenceUntrusted('tool_result', json.length > TOOL_RESULT_MAX_CHARS ? `${json.slice(0, TOOL_RESULT_MAX_CHARS)}…` : json),
      proposed: tool.kind === 'propose' && typeof out.action_id === 'string' ? out.action_id : null,
    }
  } catch (err) {
    const msg = err instanceof ChatToolError ? err.message : 'Не удалось получить данные'
    if (!(err instanceof ChatToolError)) console.error('[chat] tool failed', tool.name, err instanceof Error ? err.message : err)
    return { content: JSON.stringify({ error: msg }), proposed: null }
  }
}

export interface TurnResult {
  answer: string
  proposals: string[]
  toolsUsed: string[]
  outcome: 'answered' | 'proposed' | 'ai_error' | 'step_cap'
}

export async function runChatTurn(args: {
  llm: ChatLlm
  tools: readonly ChatTool[]
  ctx: ToolContext
  surface: ChatSurface
  focus: ChatFocus
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  message: string
  onEvent?: (e: ChatEvent) => void
}): Promise<TurnResult> {
  const { llm, tools, ctx, onEvent } = args
  const messages: ToolChatMessage[] = [
    { role: 'system', content: systemPrompt(args.surface, args.focus, ctx.canManage, ctx.now) },
    ...args.history.slice(-12).map((m): ToolChatMessage => (m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.content })),
    { role: 'user', content: args.message },
  ]
  const specs = tools.map(toolSpec)
  const proposals: string[] = []
  const used: string[] = []

  for (let step = 0; step < MAX_STEPS; step++) {
    const last = step === MAX_STEPS - 1
    const res = await llm({ messages, tools: last ? [] : specs, toolChoice: last ? 'none' : 'auto', tier: 'standard' })
    if (!res.ok) {
      const text = 'AI сейчас недоступен — попробуйте ещё раз через минуту.'
      onEvent?.({ type: 'error', text })
      return { answer: text, proposals, toolsUsed: used, outcome: 'ai_error' }
    }
    const calls = res.message.tool_calls.slice(0, MAX_TOOL_CALLS_PER_STEP)
    if (!calls.length || last) {
      const text = (res.message.content ?? '').trim() || (proposals.length ? 'Подготовил изменение — проверьте карточку и нажмите «Применить».' : 'Не получилось сформулировать ответ — переформулируйте вопрос.')
      onEvent?.({ type: 'answer', text })
      return { answer: text, proposals, toolsUsed: used, outcome: calls.length ? 'step_cap' : proposals.length ? 'proposed' : 'answered' }
    }
    messages.push({ role: 'assistant', content: res.message.content ?? null, tool_calls: calls })
    for (const call of calls) {
      used.push(call.function.name)
      onEvent?.({ type: 'status', text: STATUS_RU[call.function.name] ?? 'Работаю с данными…' })
      const r = await runToolCall(call, tools, ctx)
      if (r.proposed) {
        proposals.push(r.proposed)
        onEvent?.({ type: 'proposal', actionId: r.proposed })
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: r.content })
    }
    // A proposal ends the work of this turn: one short sentence, no more tools.
    if (proposals.length) {
      const fin = await llm({ messages, tools: [], toolChoice: 'none', tier: 'standard' })
      const text = (fin.ok ? fin.message.content?.trim() : '') || 'Подготовил изменение — проверьте карточку и нажмите «Применить».'
      onEvent?.({ type: 'answer', text })
      return { answer: text, proposals, toolsUsed: used, outcome: 'proposed' }
    }
  }
  const text = 'Вопрос оказался слишком большим — разбейте его на части.'
  onEvent?.({ type: 'answer', text })
  return { answer: text, proposals, toolsUsed: used, outcome: 'step_cap' }
}
