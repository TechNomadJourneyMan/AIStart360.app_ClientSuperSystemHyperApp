/**
 * lib/telegram/brain — the assistant («мозг») of the admin and expert bots
 * (docs/superpowers/specs/2026-10-08-ai-providers-automation-bot-brain-design.md, Part B).
 *
 * A free-text question, a voice message, a photo or a document that is not a
 * menu label, a command or a pending input reaches `runAdminBrain` /
 * `runExpertBrain` (router.brain). Per turn:
 *   rate limit (20 turns / 10 min per chat) → personal daily AI budget →
 *   «печатает…» → media → model ↔ tools loop (./engine.ts) → answer → memory.
 *
 *   ./llm-port.ts  the ONE binding to the AI layer (chatWithTools, transcribe, vision, budget)
 *   ./toolset.ts   tools per role; ./tools-read.ts read tools; ./actions.ts propose_* + execution
 *   ./memory.ts    last ~10 turns / 24 h (migration 109); `/new` clears it
 *   ./scope.ts     the person's client scope (all / assigned)
 */
import type { BotContext, BrainInput } from '../bots/dispatcher'
import type { StaffPrincipal } from '../bots/admin/context'
import type { ExpertPrincipal } from '../bots/expert/link'
import { startTyping } from '../bots/registry'
import { brainDeps } from './deps'
import { runTurn } from './engine'
import { prepareMedia } from './media'
import type { MemoryBot } from './memory'
import { mcpScopesFor, toolsFor } from './toolset'
import type { BrainDeps, BrainRole, ToolRunContext } from './types'

export { __setBrainDeps } from './deps'

export const BRAIN_RATE_LIMITED_TEXT = '⏳ Слишком много вопросов ассистенту подряд. Подождите несколько минут — меню и команды работают как обычно.'
export const BRAIN_BUDGET_TEXT = '💸 Ваш дневной лимит ИИ исчерпан — попробуйте завтра. Меню и команды работают как обычно.'
export const BRAIN_ERROR_TEXT = '⚠️ Не удалось обработать вопрос. Попробуйте позже.'

export function adminRole(p: StaffPrincipal): BrainRole {
  return { bot: 'admin', userId: p.userId, email: p.email, staffRole: p.role }
}

export function expertRole(p: ExpertPrincipal): BrainRole {
  return { bot: 'expert', userId: p.userId, email: p.email, profileRole: p.role, staffRole: p.role === 'super_expert' ? 'super_expert' : null }
}

async function runBrain(ctx: BotContext<unknown>, role: BrainRole, input: BrainInput, deps: BrainDeps = brainDeps()): Promise<void> {
  const bot = ctx.bot as MemoryBot
  if (await deps.rateLimit(`${bot}:${ctx.chatId}`)) {
    await ctx.reply(BRAIN_RATE_LIMITED_TEXT)
    return
  }
  if (!(await deps.llm.withinBudget(role.userId))) {
    await ctx.reply(BRAIN_BUDGET_TEXT)
    return
  }
  const stopTyping = startTyping(ctx.bot, ctx.chatId, ctx.deps.fetchImpl)
  try {
    const mcpScopes = mcpScopesFor(role)
    const t: ToolRunContext = {
      role,
      scope: await deps.scope(role.userId),
      pii: mcpScopes.includes('clients:pii'),
      mcpScopes,
      now: deps.now(),
      ctx,
      deps,
      turn: { proposed: false, file: null },
    }
    let turnInput: Parameters<typeof runTurn>[0]['input']
    if (input.media) {
      const prepared = await prepareMedia(ctx, deps, role, input.media, input.text)
      if (prepared.kind === 'done') return
      turnInput = prepared.input
      t.turn.file = prepared.file
    } else {
      const text = input.text.slice(0, 4000)
      turnInput = { text, display: text }
    }
    if (!t.turn.file && role.bot === 'admin') t.turn.file = await deps.memory.lastFile(bot, ctx.chatId)
    await runTurn({ ctx, role, tools: toolsFor(role, mcpScopes), t, deps, input: turnInput })
  } catch (err) {
    console.error(`[telegram/brain/${bot}] turn failed:`, err instanceof Error ? err.message.split('\n')[0] : err)
    await ctx.reply(BRAIN_ERROR_TEXT).catch(() => {})
  } finally {
    stopTyping()
  }
}

export function runAdminBrain(ctx: BotContext<StaffPrincipal>, input: BrainInput): Promise<void> {
  return runBrain(ctx as BotContext<unknown>, adminRole(ctx.principal), input)
}

export function runExpertBrain(ctx: BotContext<ExpertPrincipal>, input: BrainInput): Promise<void> {
  return runBrain(ctx as BotContext<unknown>, expertRole(ctx.principal), input)
}

/** `/new`: forget the conversation (and remembered files) of this chat. */
export async function resetBrainMemory(ctx: BotContext<unknown>): Promise<void> {
  try {
    await brainDeps().memory.reset(ctx.bot as MemoryBot, ctx.chatId)
    await ctx.reply('🧹 Начинаем заново: ассистент забыл прошлый разговор. Задайте вопрос.')
  } catch {
    await ctx.reply('Не удалось очистить историю. Попробуйте позже.')
  }
}
