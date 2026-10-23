/**
 * lib/survey/blocks.ts — the 15 deepening blocks of «Экспресс + блоки»
 * (spec 2026-10-23 §7.4, §7.5, appendix A). Pure, browser-safe.
 *
 *  • progress of a block: «Заполнено 6 из 14 · ~4 мин осталось» (a table or a
 *    file counts as answered like any field, «не знаю» too);
 *  • every block is always open (no locks); three are RECOMMENDED,
 *    deterministically: blocks linked to Point A v4 blocks that are still
 *    «данных не хватает», by (v4 weight × expected coverage gain) / minutes —
 *    the gain from the snapshot's upload checklist, else the missing coverage;
 *    ties and «no snapshot yet» → Б10, Б11, Б5, Б12, Б4, Б2, then the rest.
 *    Finished blocks are not recommended.
 */
import { isAnswerFilled } from './answer-filled'
import { SURVEY_BLOCKS, SURVEY_BLOCK_IDS, type SurveyBlock, type SurveyBlockId } from './questions'

/** Point A v4 blocks a deepening block feeds (spec §7.4 «что улучшит»). */
export const SURVEY_BLOCK_V4: Readonly<Record<SurveyBlockId, readonly string[]>> = {
  b1: [],
  b2: ['strategy'],
  b3: ['product'],
  b4: ['product'],
  b5: ['sales'],
  b6: ['product', 'sales'],
  b7: ['sales'],
  b8: ['marketing'],
  b9: ['marketing'],
  b10: ['finance', 'sales'],
  b11: ['finance'],
  b12: ['team', 'operations'],
  b13: ['team'],
  b14: [],
  b15: ['operations'],
}

/** Tie-break order (spec §7.5). */
export const BLOCK_TIE_ORDER: readonly SurveyBlockId[] = [
  'b10', 'b11', 'b5', 'b12', 'b4', 'b2',
  ...SURVEY_BLOCK_IDS.filter((b) => !['b10', 'b11', 'b5', 'b12', 'b4', 'b2'].includes(b)),
]

const answered = (v: unknown): boolean => isAnswerFilled(v) || typeof v === 'boolean'

export interface BlockProgress {
  id: SurveyBlockId
  filled: number
  total: number
  /** Minutes of typing left (0 when complete). */
  minutesLeft: number
  complete: boolean
}

export function blockProgress(block: SurveyBlock, answers: Readonly<Record<string, unknown>>): BlockProgress {
  const total = block.keys.length
  const filled = block.keys.filter((k) => answered(answers[k])).length
  const left = total ? 1 - filled / total : 0
  return { id: block.id, filled, total, minutesLeft: left <= 0 ? 0 : Math.max(1, Math.round(block.minutes * left)), complete: total > 0 && filled === total }
}

/** «Заполнено 6 из 14 · ~4 мин осталось» / «Заполнено полностью». */
export function blockProgressText(p: BlockProgress): string {
  if (p.complete) return `Заполнено полностью · ${p.total} из ${p.total}`
  return `Заполнено ${p.filled} из ${p.total} · ~${p.minutesLeft} мин осталось`
}

/** What the recommendation reads from the Point A snapshot (lib/point-a/v4/state.ts). */
export interface RecommendationSnapshot {
  blocks: ReadonlyArray<{ key: string; weight: number; status: string; coverage: number; informational?: boolean }>
  uploadChecklist?: ReadonlyArray<{ block: string; gain: number }>
}

export interface RecommendedBlock {
  block: SurveyBlock
  /** The v4 blocks still without data this block helps score. */
  improves: string[]
  score: number
}

/** The three recommended blocks (or fewer when the rest are finished). */
export function recommendedBlocks(answers: Readonly<Record<string, unknown>>, snapshot?: RecommendationSnapshot | null, limit = 3): RecommendedBlock[] {
  const v4 = new Map((snapshot?.blocks ?? []).map((b) => [b.key, b]))
  const gainOf = (key: string): number => {
    const b = v4.get(key)
    if (!b) return 0
    const listed = (snapshot?.uploadChecklist ?? []).filter((u) => u.block === key).reduce((s, u) => s + Math.max(0, u.gain), 0)
    return listed > 0 ? listed / 100 : Math.max(0, 1 - (b.coverage ?? 0))
  }
  const candidates = SURVEY_BLOCKS.filter((b) => !blockProgress(b, answers).complete).map((block) => {
    const improves = SURVEY_BLOCK_V4[block.id].filter((k) => {
      const b = v4.get(k)
      return !!b && !b.informational && b.status === 'insufficient_data'
    })
    const score = improves.reduce((s, k) => s + (v4.get(k)?.weight ?? 0) * gainOf(k), 0) / Math.max(1, block.minutes)
    return { block, improves, score }
  })
  const tie = (id: SurveyBlockId) => BLOCK_TIE_ORDER.indexOf(id)
  return candidates
    .sort((a, b) => (b.score - a.score) || (tie(a.block.id) - tie(b.block.id)))
    .slice(0, limit)
}

/** The block after `id` in the list order (for «Следующий блок»), skipping finished ones when possible. */
export function nextBlock(id: SurveyBlockId, answers: Readonly<Record<string, unknown>>): SurveyBlock | null {
  const i = SURVEY_BLOCKS.findIndex((b) => b.id === id)
  const rest = [...SURVEY_BLOCKS.slice(i + 1), ...SURVEY_BLOCKS.slice(0, Math.max(0, i))]
  return rest.find((b) => !blockProgress(b, answers).complete) ?? rest[0] ?? null
}

/** Blocks that became complete with this write (for SURVEY_BLOCK_COMPLETED). */
export function blocksCompletedBy(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, written: readonly string[]): SurveyBlockId[] {
  const touched = new Set(written)
  return SURVEY_BLOCKS.filter((b) => b.keys.some((k) => touched.has(k)) && !blockProgress(b, before).complete && blockProgress(b, after).complete).map((b) => b.id)
}
