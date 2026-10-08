/**
 * lib/telegram/bots/dispatcher.ts — update routing shared by the admin and
 * expert bots.
 *
 * One update →
 *   1. callback_query: signature check (callback.ts) → rate limit → access →
 *      permission of the entry → handler. A bad signature changes nothing.
 *   2. message: `/start <payload>` (linking, before access) → rate limit →
 *      access → /cancel → pending multi-step input (state) → /command or a
 *      reply-keyboard label → main menu.
 *
 * Every entry may declare the permission it needs; the dispatcher refuses
 * before the handler runs, so a role without it cannot reach any mutation.
 * Destructive actions go through `ctx.confirm()`: the confirm button carries a
 * one-time nonce kept in the chat state (5 minutes), and the confirmed
 * handlers live in a separate map reachable only through that button.
 */
import { randomBytes } from 'node:crypto'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { recordAdminAction, type AuditEntry } from '@/lib/admin/audit'
import type { StaffRole } from '@/lib/admin/rbac'
import { signCallback, verifyCallback } from './callback'
import {
  answerCallbackQuery, deleteMessage, editMessage, sendMessage,
  type BotId, type BotResult, type InlineButton, type ReplyMarkup,
} from './registry'
import { dbStateStore, type ConversationState, type StateStore } from './store'

export interface TgUser { id: number; username?: string; first_name?: string; is_bot?: boolean }
export interface TgFileRef { file_id: string; file_unique_id?: string; file_size?: number }
export interface TgPhotoSize extends TgFileRef { width?: number; height?: number }
export interface TgMessage {
  message_id: number
  chat: { id: number | string; type?: string }
  from?: TgUser
  text?: string
  /** Caption of a photo / document / voice / audio. */
  caption?: string
  voice?: TgFileRef & { duration?: number; mime_type?: string }
  audio?: TgFileRef & { duration?: number; mime_type?: string; file_name?: string }
  /** Sizes of one photo, smallest first. */
  photo?: TgPhotoSize[]
  document?: TgFileRef & { file_name?: string; mime_type?: string }
}

/** A file the person sent with the message (what the assistant receives). */
export interface IncomingMedia {
  kind: 'voice' | 'audio' | 'photo' | 'document'
  fileId: string
  fileSize: number | null
  fileName: string | null
  mime: string | null
}

/** Input of the bot assistant: free text and/or one file. */
export interface BrainInput {
  text: string
  media: IncomingMedia | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const size = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The file of a message, if any: voice, audio, the LARGEST photo size, or a document. */
export function mediaOf(msg: TgMessage): IncomingMedia | null {
  if (msg.voice?.file_id) return { kind: 'voice', fileId: msg.voice.file_id, fileSize: size(msg.voice.file_size), fileName: 'voice.ogg', mime: str(msg.voice.mime_type) ?? 'audio/ogg' }
  if (msg.audio?.file_id) return { kind: 'audio', fileId: msg.audio.file_id, fileSize: size(msg.audio.file_size), fileName: str(msg.audio.file_name) ?? 'audio.mp3', mime: str(msg.audio.mime_type) ?? 'audio/mpeg' }
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const best = [...msg.photo].filter((p) => p?.file_id).sort((a, b) => (a.file_size ?? (a.width ?? 0) * (a.height ?? 0)) - (b.file_size ?? (b.width ?? 0) * (b.height ?? 0))).pop()
    if (best) return { kind: 'photo', fileId: best.file_id, fileSize: size(best.file_size), fileName: 'photo.jpg', mime: 'image/jpeg' }
  }
  if (msg.document?.file_id) return { kind: 'document', fileId: msg.document.file_id, fileSize: size(msg.document.file_size), fileName: str(msg.document.file_name), mime: str(msg.document.mime_type) }
  return null
}
export interface TgCallbackQuery {
  id: string
  from: TgUser
  data?: string
  message?: { message_id: number; chat: { id: number | string } }
}
export interface TgUpdate {
  update_id?: number
  message?: TgMessage
  edited_message?: TgMessage
  callback_query?: TgCallbackQuery
}

export interface AuditActorLike {
  id: string
  kind: 'telegram'
  role?: StaffRole
  email?: string
}
export type AuditFn = (actor: AuditActorLike, entry: AuditEntry, opts?: { required?: boolean }) => Promise<boolean>

export interface BotDeps {
  fetchImpl?: typeof fetch
  state: StateStore
  audit: AuditFn
  /** true = limited. */
  rateLimit: (key: string) => Promise<boolean>
  now: () => Date
}

export function defaultDeps(overrides: Partial<BotDeps> = {}): BotDeps {
  return {
    state: dbStateStore,
    audit: (actor, entry, opts) => recordAdminAction(actor, entry, null, opts),
    rateLimit: (key) => isRateLimitedKey(key, 'telegram-bot', { max: 40, windowMs: 60_000 }),
    now: () => new Date(),
    ...overrides,
  }
}

export interface BotContext<P> {
  bot: BotId
  chatId: string
  from: TgUser
  principal: P
  /** Message carrying the pressed button (callback) or the incoming message. */
  messageId: number | null
  isCallback: boolean
  text: string
  deps: BotDeps
  /** Send a new message. */
  reply(html: string, markup?: ReplyMarkup): Promise<BotResult<{ message_id: number }>>
  /** Edit the message under the pressed button; send a new one for text input. */
  show(html: string, keyboard?: Array<Array<InlineButton | null>>): Promise<void>
  /** Short popup for a pressed button (no-op for messages). */
  toast(text: string, alert?: boolean): Promise<void>
  /** Delete the incoming message (used for messages carrying a secret). */
  deleteIncoming(): Promise<boolean>
  /** Signed inline button, or null when it cannot be signed. */
  button(text: string, action: string, ...args: Array<string | number>): InlineButton | null
  getState(): Promise<ConversationState | null>
  setState(state: ConversationState, ttlMinutes?: number): Promise<void>
  clearState(): Promise<void>
  /** Ask for an explicit confirmation of `action(args)`; see `confirmed`. */
  confirm(html: string, action: string, args: string[]): Promise<void>
}

export interface Entry<P> {
  /** Permission the principal needs (checked by router.authorize). */
  perm?: string | string[]
  run(ctx: BotContext<P>, args: string[]): Promise<void>
}

export interface StepEntry<P> {
  perm?: string | string[]
  run(ctx: BotContext<P>, state: ConversationState): Promise<void>
}

export interface Router<P> {
  bot: BotId
  /** The person behind a Telegram account, or null (not linked / no access). */
  resolve(from: TgUser, chatId: string): Promise<P | null>
  authorize(principal: P, perm: string): boolean
  permLabel?(perm: string): string
  /** `/start <payload>` before access checks (linking). true = handled. */
  start?(args: { payload: string; from: TgUser; chatId: string; deps: BotDeps }): Promise<boolean>
  /** Raw callbacks that are not signed by callback.ts (e.g. approval cards 'ap:'). */
  rawCallback?(q: TgCallbackQuery, deps: BotDeps): Promise<boolean>
  unlinkedText: string
  welcome(ctx: BotContext<P>): Promise<void>
  /**
   * The assistant: free text that is not a command, a menu label or a
   * pending input, and every voice / audio / photo / document. Without it
   * such messages get the welcome, as before.
   */
  brain?(ctx: BotContext<P>, input: BrainInput): Promise<void>
  commands: Record<string, Entry<P>>
  /** Reply-keyboard labels (exact text). */
  menu: Record<string, Entry<P>>
  callbacks: Record<string, Entry<P>>
  confirmed: Record<string, Entry<P>>
  steps: Record<string, StepEntry<P>>
}

export type Outcome =
  | 'ignored' | 'bad_signature' | 'rate_limited' | 'not_linked' | 'forbidden' | 'start'
  | 'cancelled' | 'step' | 'command' | 'menu' | 'callback' | 'confirmed' | 'confirm_expired' | 'raw' | 'welcome' | 'brain' | 'error'

const CONFIRM_TTL_MINUTES = 5

function chatIdOf(v: unknown): string | null {
  return typeof v === 'number' || typeof v === 'string' ? String(v) : null
}

function makeContext<P>(router: Router<P>, deps: BotDeps, base: {
  chatId: string; from: TgUser; principal: P; messageId: number | null; isCallback: boolean; text: string; callbackId?: string
}, meta: { answered: boolean } = { answered: false }): BotContext<P> {
  const { bot } = router
  const ctx: BotContext<P> = {
    bot,
    chatId: base.chatId,
    from: base.from,
    principal: base.principal,
    messageId: base.messageId,
    isCallback: base.isCallback,
    text: base.text,
    deps,
    reply: (html, markup) => sendMessage(bot, base.chatId, html, markup, deps.fetchImpl),
    async show(html, keyboard = []) {
      const kb = keyboard.map((row) => row.filter((b): b is InlineButton => Boolean(b))).filter((row) => row.length > 0)
      if (base.isCallback && base.messageId) {
        const r = await editMessage(bot, base.chatId, base.messageId, html, kb, deps.fetchImpl)
        // "message is not modified" or a too-old message: fall back to a new one.
        if (r.ok || /not modified/i.test(r.description)) return
      }
      await sendMessage(bot, base.chatId, html, kb.length ? { inline_keyboard: kb } : undefined, deps.fetchImpl)
    },
    async toast(text, alert = false) {
      if (!base.callbackId || meta.answered) return
      meta.answered = true
      await answerCallbackQuery(bot, base.callbackId, text, deps.fetchImpl, alert)
    },
    async deleteIncoming() {
      if (base.isCallback || !base.messageId) return false
      const r = await deleteMessage(bot, base.chatId, base.messageId, deps.fetchImpl)
      return r.ok
    },
    button(text, action, ...args) {
      const data = signCallback(bot, action, ...args)
      return data ? { text, callback_data: data } : null
    },
    getState: () => deps.state.get(bot, base.chatId),
    setState: (state, ttl) => deps.state.set(bot, base.chatId, principalUserId(base.principal), state, ttl),
    clearState: () => deps.state.clear(bot, base.chatId),
    async confirm(html, action, args) {
      const nonce = randomBytes(6).toString('base64url')
      await deps.state.set(bot, base.chatId, principalUserId(base.principal), { step: '__confirm', action, args, nonce }, CONFIRM_TTL_MINUTES)
      await ctx.show(`${html}\n\n<i>Подтвердите действие (ссылка действует ${CONFIRM_TTL_MINUTES} минут).</i>`, [[
        ctx.button('✅ Подтвердить', 'cf', nonce),
        ctx.button('✖️ Отмена', 'cx'),
      ]])
    },
  }
  return ctx
}

function principalUserId(p: unknown): string | null {
  const id = (p as { userId?: unknown } | null)?.userId
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

async function allowed<P>(router: Router<P>, ctx: BotContext<P>, perm: string | string[] | undefined): Promise<boolean> {
  if (!perm) return true
  const needed = Array.isArray(perm) ? perm : [perm]
  const missing = needed.filter((p) => !router.authorize(ctx.principal, p))
  if (!missing.length) return true
  const label = missing.map((p) => router.permLabel?.(p) ?? p).join(', ')
  const text = `⛔ Недостаточно прав: ${label}`
  if (ctx.isCallback) await ctx.toast(text.slice(0, 190), true)
  else await ctx.reply(text)
  return false
}

/** Run a handler; on failure log it (no details to the chat) and tell the person. */
async function safeRun<P>(ctx: BotContext<P>, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (err) {
    console.error(`[telegram/${ctx.bot}] handler failed:`, err instanceof Error ? err.message.split('\n')[0] : err)
    await ctx.toast('Ошибка').catch(() => {})
    await ctx.reply('⚠️ Не удалось выполнить действие. Попробуйте позже.').catch(() => {})
    return false
  }
}

export async function handleUpdate<P>(router: Router<P>, update: TgUpdate, deps: BotDeps): Promise<Outcome> {
  const q = update.callback_query
  if (q?.id) return handleCallback(router, q, deps)
  const msg = update.message
  if (!msg) return 'ignored'
  const chatId = chatIdOf(msg.chat?.id)
  const from = msg.from
  if (!chatId || !from?.id || from.is_bot) return 'ignored'
  // Private chats only: a group would expose cards to people we never checked.
  if (msg.chat?.type && msg.chat.type !== 'private') return 'ignored'
  const text = typeof msg.text === 'string' ? msg.text.trim() : ''
  const media = mediaOf(msg)
  const caption = typeof msg.caption === 'string' ? msg.caption.trim() : ''

  if (await deps.rateLimit(`${router.bot}:${chatId}`)) {
    await sendMessage(router.bot, chatId, 'Слишком много запросов. Подождите минуту.', undefined, deps.fetchImpl)
    return 'rate_limited'
  }

  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/)
  if (start?.[1] && router.start && (await router.start({ payload: start[1], from, chatId, deps }))) return 'start'

  const principal = await router.resolve(from, chatId)
  if (!principal) {
    await sendMessage(router.bot, chatId, router.unlinkedText, { remove_keyboard: true }, deps.fetchImpl)
    return 'not_linked'
  }
  const ctx = makeContext(router, deps, { chatId, from, principal, messageId: msg.message_id ?? null, isCallback: false, text: text || caption })

  // A file (voice, photo, document) always goes to the assistant: menus and
  // multi-step inputs only take text.
  if (media) {
    if (!router.brain) {
      await router.welcome(ctx)
      return 'welcome'
    }
    if (!(await safeRun(ctx, () => router.brain!(ctx, { text: caption, media })))) return 'error'
    return 'brain'
  }

  if (/^\/cancel(@\w+)?$/i.test(text) || /^(отмена|✖️ отмена)$/i.test(text)) {
    await ctx.clearState()
    await router.welcome(ctx)
    return 'cancelled'
  }

  // Commands and menu labels win over a pending input, so a person can always leave.
  const command = text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i)
  const entry = command ? router.commands[command[1].toLowerCase()] : router.menu[text]
  if (entry) {
    if (command?.[1] !== 'start') await ctx.clearState().catch(() => {})
    if (!(await allowed(router, ctx, entry.perm))) return 'forbidden'
    if (!(await safeRun(ctx, () => entry.run(ctx, command?.[2] ? [command[2].trim()] : [])))) return 'error'
    return command ? 'command' : 'menu'
  }

  const state = await ctx.getState().catch(() => null)
  if (state && state.step !== '__confirm') {
    const step = router.steps[state.step]
    if (step) {
      if (!(await allowed(router, ctx, step.perm))) {
        await ctx.clearState()
        return 'forbidden'
      }
      if (!(await safeRun(ctx, () => step.run(ctx, state)))) return 'error'
      return 'step'
    }
  }

  // Free text — a question to the assistant (an unknown /command is not one).
  if (router.brain && text && !text.startsWith('/')) {
    if (!(await safeRun(ctx, () => router.brain!(ctx, { text, media: null })))) return 'error'
    return 'brain'
  }

  await router.welcome(ctx)
  return 'welcome'
}

async function handleCallback<P>(router: Router<P>, q: TgCallbackQuery, deps: BotDeps): Promise<Outcome> {
  const chatId = chatIdOf(q.message?.chat?.id)
  if (q.data?.startsWith('ap:') && router.rawCallback) {
    return (await router.rawCallback(q, deps)) ? 'raw' : 'ignored'
  }
  const parsed = verifyCallback(router.bot, q.data)
  if (!parsed || !chatId) {
    await answerCallbackQuery(router.bot, q.id, 'Кнопка недействительна.', deps.fetchImpl)
    return 'bad_signature'
  }
  if (await deps.rateLimit(`${router.bot}:${chatId}`)) {
    await answerCallbackQuery(router.bot, q.id, 'Слишком много запросов. Подождите минуту.', deps.fetchImpl)
    return 'rate_limited'
  }
  const principal = await router.resolve(q.from, chatId)
  if (!principal) {
    await answerCallbackQuery(router.bot, q.id, router.unlinkedText.slice(0, 190), deps.fetchImpl, true)
    return 'not_linked'
  }
  const meta = { answered: false }
  const ctx = makeContext(router, deps, {
    chatId, from: q.from, principal, messageId: q.message?.message_id ?? null, isCallback: true, text: '', callbackId: q.id,
  }, meta)

  if (parsed.action === 'cx') {
    await ctx.clearState()
    await ctx.toast('Отменено')
    await ctx.show('Действие отменено.')
    return 'cancelled'
  }
  if (parsed.action === 'cf') {
    const state = await ctx.getState()
    if (!state || state.step !== '__confirm' || state.nonce !== parsed.args[0]) {
      await ctx.toast('Подтверждение устарело — повторите действие.', true)
      return 'confirm_expired'
    }
    await ctx.clearState()
    const action = String(state.action)
    const entry = router.confirmed[action]
    const args = Array.isArray(state.args) ? state.args.map(String) : []
    if (!entry) return 'ignored'
    if (!(await allowed(router, ctx, entry.perm))) return 'forbidden'
    if (!(await safeRun(ctx, () => entry.run(ctx, args)))) return 'error'
    if (!meta.answered) await ctx.toast('Готово')
    return 'confirmed'
  }

  const entry = router.callbacks[parsed.action]
  if (!entry) {
    await ctx.toast('Кнопка устарела.')
    return 'ignored'
  }
  if (!(await allowed(router, ctx, entry.perm))) return 'forbidden'
  if (!(await safeRun(ctx, () => entry.run(ctx, parsed.args)))) return 'error'
  // Stop the button spinner if the handler did not answer.
  if (!meta.answered) await ctx.toast('')
  return 'callback'
}
