/**
 * lib/survey/chat/turn.ts — one client turn about ONE question (spec §8.2–§8.6).
 *
 * The question is given by the server (the chat queue or the field the
 * helper was opened on); nothing the client or the model says can change it.
 * Quick buttons and standard phrases («что это?», «где взять?», «не знаю»,
 * «пропустить», «позовите эксперта») are answered from the registry without
 * the model. Otherwise one model call names the intent and the literals; the
 * server reacts deterministically and builds the card value itself.
 *
 * The result is what to SAY and, maybe, a card to show. Nothing is written
 * here: the questionnaire changes only when the client presses «Записать».
 */
import { maskProfanity } from '@/lib/moderation/profanity'
import { safeAnswer } from '@/lib/moderation/chat'
import { SURVEY_BLOCK_IDS, surveyBlock, type SurveyBlockId, type SurveyQuestion } from '../questions'
import { askText, explainText, whereLine, whereText } from './ask'
import { replyAllowedNumbers, replyForeignNumbers } from './guard'
import { classifyTurn, type ModelContextMessage, type SurveyLlm } from './model'
import { buildProposal, type BuildFailure } from './value'
import type { AssistantKind, BuiltProposal, ChatButton, ChatIntent, ChatQuickAction, ModelTurn } from './types'

export interface TurnInput {
  question: SurveyQuestion
  /** The client's message as typed (profanity is masked here). Empty for a quick action. */
  message: string
  /** A quick button instead of a message. */
  action?: ChatQuickAction | 'approx' | null
  /** Earlier client messages that ANSWER this question (since it was asked). */
  earlierAnswers: readonly string[]
  /** The last messages about this question (model context, ≤ 6 used). */
  context: readonly ModelContextMessage[]
  /** The one clarifying question of this field was already asked. */
  clarifyUsed: boolean
  /** null → no model available (budget spent): only the registry answers. */
  llm: SurveyLlm | null
}

export interface TurnOutcome {
  intent: ChatIntent | null
  kind: AssistantKind
  text: string
  proposal?: BuiltProposal
  buttons?: ChatButton[]
  block?: SurveyBlockId
  /** The client's message counts as an answer to the question (glued into text answers). */
  answerText: boolean
  /** The number guard refused the model's literals. */
  guard?: { reason: string; raw?: string }
  /** The model tier used (null = no model call). */
  tier: 'light' | 'standard' | null
  /** The profanity mask was applied to the client's message. */
  masked: boolean
}

const VAGUE_BUTTONS: ChatButton[] = [
  { action: 'approx', label: 'Записать примерно…' },
  { action: 'unknown', label: 'Не знаю' },
  { action: 'skip', label: 'Пропустить' },
]

const STANDARD = {
  unknown: /^(я\s+)?(не\s*знаю|не\s+считаем|не\s+считал[аи]?|не\s+в\s+курсе|понятия\s+не\s+имею|без\s+понятия|хз)[\s.!…]*$/iu,
  skip: /^(пропусти(м|ть|те)?|дальше|следующий(\s+вопрос)?|давай(те)?\s+дальше|потом)[\s.!…]*$/iu,
  explain: /^(что\s+это(\s+значит)?|что\s+значит|не\s+понял[аи]?(\s+вопрос)?|объясни(те)?(\s+вопрос)?|поясни(те)?|что\s+имеется\s+в\s+виду|в\s+смысле)[\s?!.…]*$/iu,
  where: /(где|откуда|как)\s+(мне\s+)?(это\s+)?(взять|найти|посмотреть|узнать|посчитать)(\s+(эту\s+)?(цифру|данные|число))?[\s?!.…]*$/iu,
  escalate: /(позов|позвать|переда(й|йте|ть)|свяж(ите|ись)|нуж(ен|на))\S*\s.{0,25}(эксперт|человек|менеджер|специалист|консультант)/iu,
}

/** A phrase the registry answers without the model. */
export function standardPhrase(message: string): 'unknown' | 'skip' | 'explain' | 'where' | 'escalate' | null {
  const m = message.trim()
  if (!m || m.length > 120) return null
  if (STANDARD.unknown.test(m)) return 'unknown'
  if (STANDARD.skip.test(m)) return 'skip'
  if (STANDARD.explain.test(m)) return 'explain'
  if (STANDARD.where.test(m) && m.length <= 60) return 'where'
  if (STANDARD.escalate.test(m)) return 'escalate'
  return null
}

function base(partial: Partial<TurnOutcome> & Pick<TurnOutcome, 'kind' | 'text'>): TurnOutcome {
  return { intent: null, answerText: false, tier: null, masked: false, ...partial }
}

function unknownCard(q: SurveyQuestion, texts: readonly string[]): TurnOutcome {
  const built = buildProposal(q, { intent: 'unknown', numbers: [], options: [], bool: null, text: null, clarify: null, reply: null, block: null }, texts)
  const where = whereLine(q)
  const text = ['Записать «не знаю»? Вопрос попадёт в слепые зоны — к нему можно вернуться позже.', where ? `Где взять: ${where}` : null].filter(Boolean).join('\n')
  return base({ intent: 'unknown', kind: 'proposal', text, ...(built.ok ? { proposal: built.proposal } : {}) })
}

/** Why no card: what the client should do instead (templates, no model text). */
function failureText(q: SurveyQuestion, f: BuildFailure): string {
  switch (f.reason) {
    case 'number_guard':
      return 'Не смог надёжно понять число из вашего ответа. Напишите его цифрами — например, «5 500 000» или «5,5 млн» — или нажмите «Не знаю».'
    case 'need_single':
      return q.allowApprox ? 'Назовите одно значение или диапазон.' : 'Назовите одно значение — можно примерно.'
    case 'out_of_range':
      return q.range ? `Нужно значение от ${q.range[0]} до ${q.range[1]}.` : q.type === 'percent' ? 'Нужен процент от 0 до 100.' : 'Такое значение анкета не примет — проверьте число.'
    case 'bad_option':
    case 'no_value':
      if (q.options?.length) return `Выберите из вариантов: ${q.options.map((o) => o.label).join(', ')}.`
      if (q.type === 'bool') return 'Ответьте, пожалуйста, «да» или «нет».'
      return `Не понял ответ. ${askText(q)}`
    case 'profanity':
      return 'В ответе есть грубые слова — переформулируйте, пожалуйста, и я запишу.'
    default:
      return 'Не получилось привести ответ к формату анкеты — попробуйте сказать иначе или ответьте в форме.'
  }
}

/** A model's free text (reply / clarify) with numbers checked and profanity masked; null → use the template. */
function checkedModelText(q: SurveyQuestion, text: string | null, clientTexts: readonly string[], masked: boolean): string | null {
  const t = text?.trim()
  if (!t) return null
  const allowed = replyAllowedNumbers(q, clientTexts)
  if (replyForeignNumbers(t, allowed).length) return null
  return safeAnswer(t.slice(0, 800), masked)
}

export async function runTurn(input: TurnInput): Promise<TurnOutcome> {
  const q = input.question
  const masked = maskProfanity(input.message ?? '') !== (input.message ?? '')
  const message = (input.message ?? '').trim()
  const answers = [...input.earlierAnswers, ...(message ? [message] : [])]
  const action = input.action ?? (message ? standardPhrase(message) : null)

  switch (action) {
    case 'explain': return base({ intent: 'question', kind: 'explain', text: explainText(q), masked })
    case 'where': return base({ intent: 'question', kind: 'where', text: whereText(q), masked })
    case 'skip': return base({ intent: 'skip', kind: 'skip', text: 'Хорошо, отложим этот вопрос — вернуться к нему можно в любой момент.', masked })
    case 'unknown': return { ...unknownCard(q, message ? [message] : ['не знаю']), masked }
    case 'escalate': return base({ intent: 'escalate', kind: 'escalate', text: 'Передать вопрос эксперту? Он ответит в «Сообщениях».', masked })
    case 'approx':
      return base({ intent: 'approx', kind: 'reply', text: q.allowApprox ? 'Напишите примерное значение или диапазон — например, «5–6 млн».' : 'Напишите примерное значение — запишу его как ответ.', masked })
    default: break
  }
  if (!message) return base({ kind: 'question', text: askText(q), masked })
  if (!input.llm) {
    return base({ kind: 'budget', text: 'Сейчас я могу только объяснить вопрос и подсказать, где взять цифру. Ответ можно ввести в форме — всё сохранится.', masked })
  }

  const res = await classifyTurn(input.llm, q, input.context, maskProfanity(message))
  if (!res.ok) {
    return res.error === 'unavailable'
      ? base({ kind: 'unavailable', text: 'Не успел ответить, попробуйте ещё раз. Можно продолжить в форме — всё сохранится.', masked })
      : base({ kind: 'not_understood', text: 'Не понял ответ — попробуйте сказать иначе или нажмите «Объясни вопрос».', masked, tier: 'standard' })
  }
  const turn: ModelTurn = res.turn
  const tier = res.tier
  const common = { intent: turn.intent, tier, masked }

  switch (turn.intent) {
    case 'answer':
    case 'approx': {
      const built = buildProposal(q, turn, answers)
      if (built.ok) return base({ ...common, kind: 'proposal', text: 'Записать в анкету?', proposal: built.proposal, answerText: true })
      if (built.reason === 'no_value' && !input.clarifyUsed && q.type !== 'bool' && !q.options) {
        return base({ ...common, kind: 'clarify', text: checkedModelText(q, turn.clarify, answers, masked) ?? `Уточните, пожалуйста: ${q.plain ?? q.label}`, answerText: true })
      }
      return base({
        ...common,
        kind: built.reason === 'number_guard' ? 'guard_blocked' : 'reply',
        text: failureText(q, built),
        answerText: built.reason !== 'profanity',
        ...(built.reason === 'number_guard' ? { guard: { reason: built.detail, raw: built.raw } } : {}),
      })
    }
    case 'unknown':
      return { ...unknownCard(q, [message]), tier, masked }
    case 'vague':
      if (!input.clarifyUsed) {
        return base({ ...common, kind: 'clarify', answerText: true, text: checkedModelText(q, turn.clarify, answers, masked) ?? `Уточните, пожалуйста: ${q.plain ?? q.label}` })
      }
      return base({ ...common, kind: 'vague_buttons', answerText: true, text: 'Можно записать примерно, «не знаю» или пропустить вопрос.', buttons: VAGUE_BUTTONS })
    case 'question':
      return base({ ...common, kind: 'reply', text: checkedModelText(q, turn.reply, answers, masked) ?? explainText(q) })
    case 'switch_block': {
      const id = turn.block && (SURVEY_BLOCK_IDS as readonly string[]).includes(turn.block) ? (turn.block as SurveyBlockId) : null
      if (!id) return base({ ...common, kind: 'reply', text: 'Не понял, к какому разделу перейти. Назовите его, например: «давай про финансы».' })
      return base({ ...common, kind: 'switch_block', block: id, text: `Переходим к разделу «${surveyBlock(id)?.title ?? id}».` })
    }
    case 'skip':
      return base({ ...common, kind: 'skip', text: 'Хорошо, отложим этот вопрос — вернуться к нему можно в любой момент.' })
    case 'escalate':
      return base({ ...common, kind: 'escalate', text: 'Передать вопрос эксперту? Он ответит в «Сообщениях».' })
    case 'off_topic':
    default:
      return base({ ...common, kind: 'off_topic', text: `Я помогаю только с анкетой. Вернёмся к вопросу:\n${askText(q)}` })
  }
}
