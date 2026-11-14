/**
 * Mini-GRI — public lead-magnet scoring.
 *
 * A deterministic, AI-free reduction of the full 7-block GRI engine down to the
 * 3 blocks a visitor can self-assess in ~5 minutes. We deliberately reuse
 * `calculateGri` from `lib/gri/logic.ts` so the partial score stays consistent
 * with the full diagnostic — we just map the simplified answers into the
 * existing `GriAnswers` shape and surface only 3 of the 7 resulting blocks.
 */

import { calculateGri, type GriAnswers } from './logic'
import { GRI_ZONES, griFromPercent, griZone, type GriTone, type GriZone } from '@/lib/format/gri'

/** The 6 simple inputs collected by the public wizard. */
export interface MiniGriAnswers {
  /** Валовая маржа, % (0–100). Бизнес-модель. */
  margin: number
  /** Соотношение LTV:CAC (сколько раз клиент окупает стоимость привлечения). Бизнес-модель. */
  ltvCacRatio: number
  /** Запас прочности (runway) в месяцах — на сколько хватит денег без новой выручки. Кэш/устойчивость. */
  runwayMonths: number
  /** Конверсия из лида в продажу, % (0–100). Продукт и спрос. */
  conversionRate: number
  /** Есть ли отлаженные скрипты/материалы продаж. Продукт и спрос. */
  hasScripts: boolean
  /** Есть ли устойчивый поток заявок/спрос. Продукт и спрос. */
  steadyDemand: boolean
}

export interface MiniGriBlock {
  key: 'businessModel' | 'cash' | 'product'
  label: string
  /** Engine score, 0–100 (stored with the lead, kept for compatibility). */
  score: number
  /** The same score on the GRI scale 0–10 (what the visitor sees), R-036. */
  index: number
}

export interface MiniGriResult {
  /** Частичный общий балл (среднее по 3 доступным блокам), 0–100 — хранится в лиде. */
  overall: number
  /** Тот же балл на шкале GRI 0–10 (показывается посетителю), R-036. */
  index: number
  blocks: MiniGriBlock[]
}

/** 0–100 engine score → GRI 0–10 (explicit, one decimal). */
export function miniScoreToGri(score: number): number {
  return griFromPercent(clamp(score, 0, 100)) ?? 0
}

const BLOCK_LABELS: Record<MiniGriBlock['key'], string> = {
  businessModel: 'Бизнес-модель',
  cash: 'Кэш / устойчивость',
  product: 'Продукт и спрос',
}

/**
 * Maps the 6 mini answers into the full `GriAnswers` shape.
 *
 * `calculateGri` works with absolute LTV/CAC values, but the public wizard asks
 * only for the *ratio* (which is more intuitive). We back out a CAC/LTV pair
 * that reproduces the chosen ratio (CAC fixed at 1 → LTV = ratio), so the
 * business-model block reads the ratio exactly as intended.
 *
 * Blocks we don't ask about (operations / team / founder / trust) are left at
 * the engine's neutral defaults — they never reach the public result.
 */
function toGriAnswers(a: MiniGriAnswers): GriAnswers {
  const ratio = Math.max(0, a.ltvCacRatio)
  return {
    // Finance — drives Business Model + Cash blocks.
    revenue: 0,
    margin: clamp(a.margin, 0, 100),
    cac: 1,
    ltv: ratio,
    runway: Math.max(0, a.runwayMonths),

    // Market & Product — required by the type; not surfaced in mini result.
    industry: 'unknown',
    mainOffer: 'unknown',
    avgCheck: 0,

    // Sales & Funnel — drives the Product & Demand block.
    conversionRate: clamp(a.conversionRate, 0, 100),
    hasScripts: a.hasScripts,
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

/**
 * computeMiniGri — deterministic partial GRI on 3 blocks.
 *
 * Note on "Продукт и спрос": the full engine derives `productScore` from
 * conversion + scripts only. The public wizard additionally asks about a steady
 * stream of demand, which we fold in as a small confidence bonus on top of the
 * engine score (capped at 100) so the answer the visitor gives actually moves
 * the needle. The two finance blocks pass straight through the engine.
 */
export function computeMiniGri(a: MiniGriAnswers): MiniGriResult {
  const gri = calculateGri(toGriAnswers(a))

  const demandBonus = a.steadyDemand ? 12 : 0
  const productScore = clamp(gri.productScore + demandBonus, 0, 100)

  const raw = [
    { key: 'businessModel' as const, label: BLOCK_LABELS.businessModel, score: clamp(gri.businessModelScore, 0, 100) },
    { key: 'cash' as const, label: BLOCK_LABELS.cash, score: clamp(gri.cashScore, 0, 100) },
    { key: 'product' as const, label: BLOCK_LABELS.product, score: Math.round(productScore) },
  ]
  const blocks: MiniGriBlock[] = raw.map((b) => ({ ...b, index: miniScoreToGri(b.score) }))

  const overall = Math.round(
    blocks.reduce((sum, b) => sum + b.score, 0) / blocks.length
  )

  return { overall, index: miniScoreToGri(overall), blocks }
}

/** Zone helper shared by UI + (potentially) the API for copy. */
export type MiniGriZone = GriTone

/**
 * The GRI zone of a 0–100 Mini-GRI score — the same thresholds as everywhere
 * (lib/format/gri.ts GRI_ZONES, on the 0–10 scale). A 0 is the worst zone.
 */
export function miniGriZone(score: number): GriZone {
  return griZone(miniScoreToGri(score)) ?? GRI_ZONES[0]
}

export function zoneForScore(score: number): MiniGriZone {
  return miniGriZone(score).tone
}
