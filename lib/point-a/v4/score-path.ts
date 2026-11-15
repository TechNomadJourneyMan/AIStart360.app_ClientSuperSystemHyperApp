/**
 * lib/point-a/v4/score-path.ts — «Минимум для Точки А» as the RULE of the
 * official score (R-032, lib/point-a/v4/config.ts overallAllowed), not as a
 * list of questions (R3-PA, П5 / N7: the client closed the old «минимум» and
 * still had no score).
 *
 * The overall score exists when the full questionnaire is sent AND the blocks
 * with a score cover at least MIN_OVERALL_WEIGHT_COVERAGE of the weight AND at
 * least one of OVERALL_REQUIRED_ANY_OF has a score; a block has a score at
 * MIN_COVERAGE of its checks. From the blocks as they would be scored after
 * sending (lib/point-a/v4/state.ts runs the engine with surveyComplete), this
 * module finds the cheapest way to the score: which blocks to fill and how
 * many items each — «до оценки осталось N».
 *
 * Pure and browser-safe (config only).
 */
import { BLOCK_LIBRARY, MIN_COVERAGE, MIN_OVERALL_WEIGHT_COVERAGE, OVERALL_REQUIRED_ANY_OF, isBlockKey, type BlockKey } from './config'
import { CHECK_LABELS } from './check-labels'

export interface ScorePathCheck { id: string; max: number; answered: boolean; excluded?: boolean; missing?: string }
export interface ScorePathInputBlock {
  key: string
  title?: string
  weight: number
  informational?: boolean
  score: number | null
  checks: ReadonlyArray<ScorePathCheck>
}

export interface ScorePathBlock {
  key: BlockKey
  title: string
  /** How many more items (answers / data) give the block a score. */
  items: number
  /** What to answer or upload, most valuable first (`items` of them). */
  needs: string[]
  /** «Финансы» / «Продажи» — one of them must have a score. */
  required: boolean
}

export interface ScorePath {
  /** The rule as shown to the client. */
  rule: { minWeightShare: number; requiredTitles: string[] }
  surveySent: boolean
  /** With the data there is now, the score appears once the questionnaire is sent. */
  dataEnough: boolean
  /** Share of the weight the blocks with a score cover now (0..1). */
  weightShare: number
  /** One of the required blocks has a score. */
  hasRequired: boolean
  /** The cheapest set of blocks to fill (empty when the data is enough). */
  toFill: ScorePathBlock[]
  /** Sum of `toFill[].items`. */
  itemsLeft: number
  /** false: even all the missing items would not reach the rule (then `toFill` is every block that can get a score). */
  reachable: boolean
}

const EPS = 1e-9

function hasScore(b: ScorePathInputBlock): boolean {
  return typeof b.score === 'number' && Number.isFinite(b.score)
}

function titleOf(b: ScorePathInputBlock): string {
  return b.title ?? (isBlockKey(b.key) ? BLOCK_LIBRARY[b.key].title : b.key)
}

/** The fewest unanswered checks (most valuable first) that bring the block to MIN_COVERAGE; null — impossible. */
export function itemsToScore(b: ScorePathInputBlock): { items: number; needs: string[] } | null {
  const included = b.checks.filter((c) => !c.excluded)
  const total = included.reduce((s, c) => s + c.max, 0)
  if (total <= 0) return null
  let possible = included.filter((c) => c.answered).reduce((s, c) => s + c.max, 0)
  const open = included.filter((c) => !c.answered).sort((a, b) => b.max - a.max)
  const needs: string[] = []
  for (const c of open) {
    if (possible > 0 && possible / total >= MIN_COVERAGE - EPS) break
    possible += c.max
    needs.push(c.missing ?? `Не заполнено: ${CHECK_LABELS[c.id] ?? c.id}`)
  }
  return possible > 0 && possible / total >= MIN_COVERAGE - EPS ? { items: needs.length, needs } : null
}

export function pointAScorePath(blocks: ReadonlyArray<ScorePathInputBlock>, opts: { surveySent: boolean }): ScorePath {
  const weighted = blocks.filter((b) => b.informational !== true && b.weight > 0)
  const required = (k: string) => (OVERALL_REQUIRED_ANY_OF as readonly string[]).includes(k)
  const rule = { minWeightShare: MIN_OVERALL_WEIGHT_COVERAGE, requiredTitles: OVERALL_REQUIRED_ANY_OF.map((k) => BLOCK_LIBRARY[k].title) }
  const wAll = weighted.reduce((s, b) => s + b.weight, 0)
  if (!weighted.length || wAll <= 0) {
    return { rule, surveySent: opts.surveySent, dataEnough: true, weightShare: 1, hasRequired: true, toFill: [], itemsLeft: 0, reachable: true }
  }
  const scored = weighted.filter(hasScore)
  const wScored = scored.reduce((s, b) => s + b.weight, 0)
  const needsRequired = weighted.some((b) => required(b.key))
  const hasRequired = !needsRequired || scored.some((b) => required(b.key))

  const candidates = weighted
    .filter((b) => !hasScore(b))
    .map((b) => ({ b, cost: itemsToScore(b) }))
    .filter((c): c is { b: ScorePathInputBlock; cost: { items: number; needs: string[] } } => c.cost !== null)

  const ok = (w: number, req: boolean) => w / wAll >= MIN_OVERALL_WEIGHT_COVERAGE - EPS && req
  const enough = ok(wScored, hasRequired)
  const view = (c: (typeof candidates)[number]): ScorePathBlock => ({
    key: c.b.key as BlockKey, title: titleOf(c.b), items: c.cost.items, needs: c.cost.needs, required: required(c.b.key),
  })

  let best: { set: typeof candidates; items: number; weight: number } | null = null
  if (!enough) {
    // At most 7 blocks: every subset (≤ 128) — the cheapest in items, then fewer blocks, then more weight.
    const n = candidates.length
    for (let mask = 1; mask < 1 << n; mask++) {
      const set = candidates.filter((_, i) => mask & (1 << i))
      const w = wScored + set.reduce((s, c) => s + c.b.weight, 0)
      if (!ok(w, hasRequired || set.some((c) => required(c.b.key)))) continue
      const items = set.reduce((s, c) => s + c.cost.items, 0)
      if (!best || items < best.items || (items === best.items && (set.length < best.set.length || (set.length === best.set.length && w > best.weight)))) {
        best = { set, items, weight: w }
      }
    }
  }
  const toFill = enough ? [] : (best?.set ?? candidates).map(view).sort((a, b) => Number(b.required) - Number(a.required) || a.items - b.items)
  return {
    rule,
    surveySent: opts.surveySent,
    dataEnough: enough,
    weightShare: Math.round((wScored / wAll) * 1000) / 1000,
    hasRequired,
    toFill,
    itemsLeft: toFill.reduce((s, b) => s + b.items, 0),
    reachable: enough || best !== null,
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** «≥ 60 % веса блоков с данными, среди них «Финансы» или «Продажи»». */
export function scoreRuleText(path: Pick<ScorePath, 'rule'>): string {
  return `оценка появляется, когда блоки с данными покрывают не меньше ${Math.round(path.rule.minWeightShare * 100)} % веса и среди них есть ${path.rule.requiredTitles.map((t) => `«${t}»`).join(' или ')}`
}

/** One line for the client: what is left before the score. Null when nothing is left (the score exists). */
export function scorePathSummary(path: ScorePath, opts: { scored?: boolean } = {}): string | null {
  if (opts.scored && path.dataEnough) return null
  const send = path.surveySent ? '' : 'отправить анкету'
  if (path.dataEnough) return path.surveySent ? null : 'Данных для оценки хватает — осталось отправить анкету.'
  const blocks = path.toFill.map((b) => `«${b.title}» — ${b.items}`).join(', ')
  const items = `${path.itemsLeft} ${plural(path.itemsLeft, 'пункт', 'пункта', 'пунктов')}`
  if (!path.reachable) return `До оценки не хватает данных: заполните ${blocks || 'пустые блоки'}${send ? ` и ${send}` : ''}.`
  return `До оценки осталось ${items}: ${blocks}${send ? ` — и ${send}` : ''}.`
}
