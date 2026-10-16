/**
 * lib/comm/bot-rules.ts — the rules of the client bot (pure, no IO)
 * (docs/superpowers/specs/2026-10-16-user-communications-design.md §6.5).
 *
 *   intents          «вы человек?/бот?», «позовите человека», жалоба,
 *                    «оформите заявку» — recognised without the LLM, so the
 *                    important answers do not depend on the model;
 *   disclosure       the first bot message of a conversation and every answer
 *                    to «вы человек?» say it is the AIStart360 bot — written
 *                    into the prompt AND enforced on the reply
 *                    (ensureBotDisclosure). Anti-goal: a bot posing as a human;
 *   delay            a human-like pause of 2–8 s («печатает…»);
 *   cap              at most BOT_REPLIES_PER_HOUR bot replies per conversation;
 *   prompt           live-chat tone, Russian, knowledge base + the user's own
 *                    data only, everything from the user fenced as untrusted;
 *   keyword search   the knowledge-base fallback when there are no embeddings.
 */
import { z } from 'zod'
import { fenceUntrusted, UNTRUSTED_DATA_RULES } from '@/lib/ai/gateway'
import { findProfanity } from '@/lib/moderation/profanity'

export const COMM_BOT_REPLY_EVENT = 'comm/bot.reply.requested'

export interface BotJob {
  threadId: string
  messageId: string
  /** The inbound opened an unanswered stretch: tell staff if the bot does not answer. */
  notifyOnSkip: boolean
}

export const BOT_NAME = 'Бот AIStart360'
export const BOT_INTRO = 'Здравствуйте! Это бот AIStart360.'
export const HANDOFF_TEXT = 'Позову эксперта — он ответит, как только освободится.'
export const CASE_TEXT = 'Оформил заявку — эксперт свяжется с вами, как только освободится.'
/** At most this many bot replies per conversation per hour. */
export const BOT_REPLIES_PER_HOUR = 10
export const BOT_MIN_DELAY_MS = 2_000
export const BOT_MAX_DELAY_MS = 8_000
/** Longest bot reply sent to the user. */
export const BOT_REPLY_MAX = 1_500

export type HandoffReason = 'human_requested' | 'complaint' | 'unknown' | 'case_requested' | 'llm_unavailable' | 'send_failed'

export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  human_requested: 'Пользователь просит человека',
  complaint: 'Жалоба',
  unknown: 'Бот не знает ответа',
  case_requested: 'Пользователь просит оформить заявку',
  llm_unavailable: 'AI сейчас недоступен',
  send_failed: 'Ответ бота не доставлен',
}

// ─── Intents ────────────────────────────────────────────────────────────────

const W = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'
const re = (src: string) => new RegExp(src, 'iu')

const ASKS_HUMAN = [
  re(`${W}(?:вы|ты)\\s+(?:что\\s+|вообще\\s+)?(?:живой\\s+|настоящий\\s+|реальный\\s+)?(?:человек|бот|робот|программа|нейросеть|ии|ai|автоответчик)${E}`),
  re(`${W}(?:это|со\\s+мной|мне)\\s+(?:сейчас\\s+)?(?:говорит|пишет|отвечает|общается)?\\s*(?:бот|робот|человек|нейросеть)\\s*\\?`),
  re(`${W}с\\s+кем\\s+я\\s+(?:говорю|общаюсь|переписываюсь)`),
  re(`${W}(?:бот|робот)\\s*\\?\\s*$`),
  /\bare\s+you\s+(?:a\s+)?(?:human|bot|robot|real|person)\b/i,
]

const WANTS_HUMAN = [
  re(`${W}(?:позов|позв|зов|соедин|переключ|свяж|подключ|дайте|нужен|нужна|хочу|можно|пригласи)\\S*\\s+(?:\\S+\\s+){0,2}(?:человек|оператор|эксперт|менеджер|специалист|сотрудник|консультант|живо)`),
  re(`${W}живо(?:й|го|му)\\s+человек`),
  re(`^\\s*(?:оператор|человек|эксперт|менеджер|специалист)\\S*\\s*[!?.]*\\s*$`),
  /\b(?:talk|speak)\s+to\s+(?:a\s+)?(?:human|person|operator|manager)\b/i,
]

const COMPLAINT = [
  re(`${W}(?:жалоб|пожалова|претензи|обманул|обман${E}|мошенни|безобрази)`),
  re(`${W}(?:верните|вернуть)\\s+(?:мне\\s+)?(?:деньг|оплат|средств)`),
  re(`${W}возврат\\S*\\s+(?:денег|средств|оплаты)`),
]

const WANTS_CASE = [
  re(`${W}(?:оформ|созда|остав|завед|пода|отправ|зарегистрир)\\S*\\s+(?:\\S+\\s+){0,2}(?:заявк|обращени|тикет|запрос\\s+эксперт)`),
  re(`${W}(?:нужна|хочу)\\s+(?:\\S+\\s+)?заявк`),
]

export function asksIfHuman(text: string): boolean {
  return ASKS_HUMAN.some((r) => r.test(text))
}

export function wantsHuman(text: string): boolean {
  return WANTS_HUMAN.some((r) => r.test(text))
}

export function isComplaint(text: string): boolean {
  return COMPLAINT.some((r) => r.test(text))
}

export function wantsCase(text: string): boolean {
  return WANTS_CASE.some((r) => r.test(text))
}

/** Nothing but profanity (and punctuation): the bot does not answer it (the warning is enough). */
export function isProfanityOnly(text: string): boolean {
  const found = findProfanity(text)
  if (!found.length) return false
  let rest = ''
  let pos = 0
  for (const f of found) {
    rest += text.slice(pos, f.start)
    pos = f.end
  }
  rest += text.slice(pos)
  return !/[\p{L}\p{N}]/u.test(rest)
}

// ─── Disclosure, delay, cap ─────────────────────────────────────────────────

/** The reply says it is a bot (first bot message, «вы человек?»): prefixes BOT_INTRO when the model forgot. */
export function ensureBotDisclosure(reply: string, required: boolean): string {
  const text = reply.trim()
  if (!required) return text
  if (/(?<![\p{L}])бот(?![\p{L}])|(?<![\p{L}])бот\s+AIStart360/iu.test(text)) return text
  return `${BOT_INTRO} ${text}`.trim()
}

/** «Печатает…» like a person: 2 s + ~40 ms per character + up to 1 s, at most 8 s. */
export function botDelayMs(text: string, rng: () => number = Math.random): number {
  const r = Math.min(Math.max(rng(), 0), 1)
  const ms = BOT_MIN_DELAY_MS + Math.min(5_000, text.length * 40) + Math.floor(r * 1_000)
  return Math.max(BOT_MIN_DELAY_MS, Math.min(BOT_MAX_DELAY_MS, ms))
}

/** Bot replies of the last hour (created_at of the latest ones) reached the cap. */
export function overHourlyCap(botReplyTimes: string[], now: Date, cap = BOT_REPLIES_PER_HOUR): boolean {
  const since = now.getTime() - 3_600_000
  return botReplyTimes.filter((t) => new Date(t).getTime() > since).length >= cap
}

export function clipReply(text: string, max = BOT_REPLY_MAX): string {
  const flat = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// ─── Knowledge base, keyword fallback ───────────────────────────────────────

export interface KbHit {
  id: string
  title: string
  body: string
  tags?: string[] | null
  similarity?: number | null
}

const STOP = new Set(['как', 'что', 'где', 'когда', 'почему', 'зачем', 'для', 'это', 'мне', 'меня', 'вас', 'нас', 'или', 'так', 'уже', 'еще', 'ещё', 'можно', 'нужно', 'есть', 'про', 'при', 'над', 'под', 'без', 'the', 'and', 'for', 'what', 'how'])

/** Lower-case word stems (first 5 letters) of the meaningful words. */
export function keywordStems(text: string): string[] {
  const words = text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? []
  return Array.from(new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.slice(0, 5))))
}

/** Articles ranked by stem overlap: title ×3, tags ×2, body ×1; only those with a hit. */
export function rankKbByKeywords(query: string, articles: KbHit[], limit = 4): KbHit[] {
  const stems = keywordStems(query)
  if (!stems.length) return []
  const scored = articles.map((a) => {
    const title = new Set(keywordStems(a.title))
    const tags = new Set(keywordStems((a.tags ?? []).join(' ')))
    const body = new Set(keywordStems(a.body.slice(0, 20_000)))
    const score = stems.reduce((s, w) => s + (title.has(w) ? 3 : 0) + (tags.has(w) ? 2 : 0) + (body.has(w) ? 1 : 0), 0)
    return { a, score }
  })
  return scored.filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, limit).map((x) => x.a)
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export const BotDecisionSchema = z.object({
  action: z.enum(['answer', 'handoff', 'case']),
  reply: z.string().max(4000).optional(),
  case_summary: z.string().max(1000).nullable().optional(),
})
export type BotDecision = z.infer<typeof BotDecisionSchema>

export interface BotPromptInput {
  /** No bot message in this conversation yet. */
  firstReply: boolean
  /** The user asks whether he talks to a person or a bot. */
  askedIfHuman: boolean
  kb: KbHit[]
  /** Facts about THIS user only (questionnaire status, Point A summary …). */
  userFacts: string[]
  /** Recent messages, oldest first. */
  history: Array<{ who: 'user' | 'staff' | 'bot'; text: string }>
  message: string
}

const KB_CHARS = 6_000
const HISTORY_CHARS = 4_000

export function buildBotPrompt(input: BotPromptInput): { system: string; user: string } {
  const disclosure = [
    'Ты — бот AIStart360 и никогда не выдаёшь себя за человека.',
    input.firstReply
      ? 'Это твоё ПЕРВОЕ сообщение в этом диалоге: начни ответ с того, что ты бот AIStart360 (например: «Здравствуйте! Это бот AIStart360.»).'
      : null,
    input.askedIfHuman
      ? 'Пользователь спрашивает, человек ты или бот: прямо ответь, что ты бот AIStart360, и предложи позвать эксперта, если нужен человек.'
      : 'На любой вопрос «вы человек?/вы бот?» прямо отвечай, что ты бот AIStart360.',
  ].filter(Boolean).join('\n')

  const system = [
    'Ты отвечаешь пользователю платформы AIStart360 (диагностика и рост бизнеса: анкета, Точка А, GRI, отчёты, эксперты) в чате — Telegram, WhatsApp или кабинет.',
    disclosure,
    'Стиль: по-русски, как живая переписка — коротко (1–4 предложения), дружелюбно, без канцелярита, без markdown, заголовков и таблиц.',
    'Отвечай только по базе знаний и данным пользователя ниже. Не выдумывай цены, сроки, обещания, ссылки и факты. Не обсуждай других пользователей.',
    'Если ответа нет в базе знаний, вопрос сложный или личный, пользователь просит человека/эксперта/менеджера или жалуется — action "handoff" (эксперта позовёт система, текст для этого случая напишет она сама).',
    'Если пользователь просит оформить заявку или обращение — action "case", в case_summary кратко суть заявки, в reply — короткое подтверждение.',
    'Иначе — action "answer" и ответ в reply.',
    'Ответ — строго JSON без пояснений: {"action":"answer"|"handoff"|"case","reply":"…","case_summary":null}',
    UNTRUSTED_DATA_RULES,
  ].join('\n\n')

  let kbText = ''
  for (const a of input.kb) {
    const piece = `### ${a.title}\n${a.body.trim()}\n\n`
    if (kbText.length + piece.length > KB_CHARS) {
      kbText += piece.slice(0, Math.max(0, KB_CHARS - kbText.length))
      break
    }
    kbText += piece
  }
  const who = { user: 'Пользователь', staff: 'Эксперт', bot: 'Бот' } as const
  let history = input.history.map((h) => `${who[h.who]}: ${h.text.replace(/\s+/g, ' ').trim()}`).join('\n')
  if (history.length > HISTORY_CHARS) history = history.slice(history.length - HISTORY_CHARS)

  const user = [
    'База знаний AIStart360 (статьи, опубликованные командой):',
    kbText.trim() ? fenceUntrusted('kb', kbText.trim(), KB_CHARS) : '(подходящих статей не нашлось)',
    'Что известно об этом пользователе (только его собственные данные):',
    fenceUntrusted('user_data', input.userFacts.length ? input.userFacts.join('\n') : 'нет данных', 2_000),
    'Последние сообщения диалога:',
    fenceUntrusted('chat', history || 'это начало диалога', HISTORY_CHARS),
    'Новое сообщение пользователя, на которое нужно ответить:',
    fenceUntrusted('message', input.message, 4_000),
  ].join('\n\n')
  return { system, user }
}
