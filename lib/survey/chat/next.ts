/**
 * lib/survey/chat/next.ts — which question the chat asks next (spec §8.2).
 * Decided by the server from the registry, never by the model:
 *
 *   1. unanswered express questions in screen order;
 *   2. (scope «вся анкета») the deepening blocks — Б10, Б11, Б5, Б12, Б4, Б2,
 *      then the rest (the deterministic tie order of §7.5; the snapshot-based
 *      recommendation is Ф2's), registry order inside a block;
 *   3. skipped: answered keys («не знаю» counts), keys put aside in this
 *      conversation, `chat !== 'ask'` (tables, files, contacts → one link to the
 *      form per block; auto keys are written with their month key);
 *   4. «давай про финансы» → the block the client asked for goes first.
 *
 * Pure and browser-safe.
 */
import { EXPRESS_SCREENS, SURVEY_BLOCKS, SURVEY_QUESTIONS, type SurveyBlockId, type SurveyQuestion } from '../questions'
import { hasAnswerValue } from '../progress'
import type { ChatScope } from './types'

/** Block order of the full scope after the express set (spec §7.5 tie order). */
export const FULL_BLOCK_ORDER: readonly SurveyBlockId[] = (() => {
  const first: SurveyBlockId[] = ['b10', 'b11', 'b5', 'b12', 'b4', 'b2']
  return [...first, ...SURVEY_BLOCKS.map((b) => b.id).filter((id) => !first.includes(id))]
})()

/** Keys the chat never links to the form: the company name comes from the profile. */
const NO_FORM_LINK = new Set(['s1_company_name'])

function expressKeys(): string[] {
  return EXPRESS_SCREENS.flatMap((s) => s.keys)
}

function blockKeys(id: SurveyBlockId): string[] {
  return [...(SURVEY_BLOCKS.find((b) => b.id === id)?.keys ?? [])]
}

export interface QueueGroup {
  block: SurveyBlockId | 'express'
  keys: string[]
}

/** The chat queue, grouped by where the questions live. */
export function chatQueue(scope: ChatScope, focusBlock?: SurveyBlockId | null): QueueGroup[] {
  const groups: QueueGroup[] = [{ block: 'express', keys: expressKeys() }]
  if (scope === 'full') for (const id of FULL_BLOCK_ORDER) groups.push({ block: id, keys: blockKeys(id) })
  if (focusBlock) {
    const at = groups.findIndex((g) => g.block === focusBlock)
    const group = at >= 0 ? groups.splice(at, 1)[0] : { block: focusBlock, keys: blockKeys(focusBlock) }
    groups.unshift(group)
  }
  return groups
}

/** Answered for the chat: any real answer, «не знаю» and «примерно» included. */
export function isAnsweredForChat(v: unknown): boolean {
  return hasAnswerValue(v)
}

export type NextChatStep =
  | { kind: 'question'; question: SurveyQuestion; block: SurveyBlockId | 'express' }
  | { kind: 'form_link'; block: SurveyBlockId | 'express'; keys: string[]; step: number }
  | { kind: 'done'; scope: ChatScope }

export interface NextChatInput {
  answers: Readonly<Record<string, unknown>>
  scope: ChatScope
  /** Keys put aside in this conversation. */
  skipped?: ReadonlySet<string>
  /** Blocks whose «удобнее в форме» link was already shown. */
  formLinksShown?: ReadonlySet<string>
  focusBlock?: SurveyBlockId | null
}

export function nextChatStep(input: NextChatInput): NextChatStep {
  const skipped = input.skipped ?? new Set<string>()
  const linked = input.formLinksShown ?? new Set<string>()
  for (const group of chatQueue(input.scope, input.focusBlock)) {
    const formOnly: string[] = []
    for (const key of group.keys) {
      const q = SURVEY_QUESTIONS[key]
      if (!q || isAnsweredForChat(input.answers[key])) continue
      if (q.chat === 'form_only') {
        if (!NO_FORM_LINK.has(key)) formOnly.push(key)
        continue
      }
      if (q.chat !== 'ask' || skipped.has(key)) continue
      return { kind: 'question', question: q, block: group.block }
    }
    // The block's chat questions are done: tables / files go to the form, once per block.
    if (formOnly.length && !linked.has(group.block)) {
      const step = SURVEY_QUESTIONS[formOnly[0]]?.step ?? 1
      return { kind: 'form_link', block: group.block, keys: formOnly, step }
    }
  }
  return { kind: 'done', scope: input.scope }
}

/** How many chat questions of the scope are still open (the side panel). */
export function openChatQuestions(answers: Readonly<Record<string, unknown>>, scope: ChatScope): number {
  let n = 0
  for (const g of chatQueue(scope)) {
    for (const key of g.keys) {
      const q = SURVEY_QUESTIONS[key]
      if (q && q.chat === 'ask' && !isAnsweredForChat(answers[key])) n += 1
    }
  }
  return n
}
