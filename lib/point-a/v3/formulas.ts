// ============================================================
// lib/point-a/v3/formulas.ts
// Pure formulas + status thresholds for the six Point A v3 blocks.
//
// Each helper takes only the numeric inputs it needs and returns
// `{ value, status }` (status using the spec targets). No I/O,
// no side effects — fully deterministic and easy to unit-test.
//
// Sources of formulas: AIStart360_Metrics_Guide.docx.txt, Part 3.
// ============================================================

import type { V3MetricStatus } from '@/types/point-a-v3'

// ─── Number utilities ───────────────────────────────────────

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Safe divide. Returns null if denominator missing/zero or numerator missing. */
export function safeDiv(num: number | null, den: number | null): number | null {
  if (!isFiniteNum(num) || !isFiniteNum(den)) return null
  if (den === 0) return null
  return num / den
}

/** Round to N decimals — never returns NaN, returns null on bad input. */
export function round(n: number | null, decimals = 2): number | null {
  if (!isFiniteNum(n)) return null
  const m = Math.pow(10, decimals)
  return Math.round(n * m) / m
}

/** Median of a numeric array. Returns null on empty / non-numeric arrays. */
export function median(values: number[]): number | null {
  const xs = values.filter(isFiniteNum)
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

// ─── Status classification ──────────────────────────────────

/**
 * Classify a "higher-is-better" metric (% completion, conversion, etc.)
 * against a numeric target.
 *   value >= target * 1.1  → excellent
 *   value >= target        → good
 *   value >= target * 0.7  → warning
 *   value <  target * 0.7  → critical
 */
export function statusHigherIsBetter(
  value: number | null,
  target: number,
): V3MetricStatus {
  if (!isFiniteNum(value)) return 'no_data'
  if (value >= target * 1.1) return 'excellent'
  if (value >= target) return 'good'
  if (value >= target * 0.7) return 'warning'
  return 'critical'
}

/**
 * Classify a "lower-is-better" metric (churn, no-show, COGS%, etc.).
 *   value <= target * 0.7  → excellent
 *   value <= target        → good
 *   value <= target * 1.3  → warning
 *   value >  target * 1.3  → critical
 */
export function statusLowerIsBetter(
  value: number | null,
  target: number,
): V3MetricStatus {
  if (!isFiniteNum(value)) return 'no_data'
  if (value <= target * 0.7) return 'excellent'
  if (value <= target) return 'good'
  if (value <= target * 1.3) return 'warning'
  return 'critical'
}

/**
 * Classify against a numeric range [low, high] (e.g. Mktg% 5..15).
 * Inside the band = good. Outside but within 30% margin = warning.
 * Otherwise critical.
 */
export function statusInRange(
  value: number | null,
  low: number,
  high: number,
): V3MetricStatus {
  if (!isFiniteNum(value)) return 'no_data'
  if (value >= low && value <= high) return 'good'
  const lowGuard = low * 0.7
  const highGuard = high * 1.3
  if (value >= lowGuard && value <= highGuard) return 'warning'
  return 'critical'
}

/**
 * "Count" metrics where no target is set numerically (e.g. N, Leads).
 * We never call it critical without a target — fall back to good when
 * we have a number, no_data otherwise.
 */
export function statusCount(value: number | null): V3MetricStatus {
  if (!isFiniteNum(value)) return 'no_data'
  return 'good'
}

// ─── Block 1: Sales ─────────────────────────────────────────

/** Count of paid rows. */
export function calcN(paidRows: number | null): number | null {
  return isFiniteNum(paidRows) ? paidRows : null
}

/** Sum of payments. */
export function calcRev(sumPayments: number | null): number | null {
  return isFiniteNum(sumPayments) ? sumPayments : null
}

/** Average order value: Rev / N. */
export function calcAOV(
  rev: number | null,
  n: number | null,
): number | null {
  return safeDiv(rev, n)
}

/** Count of first-purchases. */
export function calcNew(firstPurchases: number | null): number | null {
  return isFiniteNum(firstPurchases) ? firstPurchases : null
}

/** Sum of revenue from new clients. */
export function calcRevNew(revNew: number | null): number | null {
  return isFiniteNum(revNew) ? revNew : null
}

/** Average new-customer order value. */
export function calcAOVnew(
  revNew: number | null,
  newCount: number | null,
): number | null {
  return safeDiv(revNew, newCount)
}

/** Count of repeat purchases (2+ purchases). */
export function calcRet(repeatPurchases: number | null): number | null {
  return isFiniteNum(repeatPurchases) ? repeatPurchases : null
}

/** Sum of revenue from repeat purchases. */
export function calcRevRet(revRet: number | null): number | null {
  return isFiniteNum(revRet) ? revRet : null
}

/** Share of repeat revenue in total revenue, %. Helper not in metric table. */
export function repeatRevenueShare(
  revRet: number | null,
  rev: number | null,
): number | null {
  const ratio = safeDiv(revRet, rev)
  return ratio == null ? null : ratio * 100
}

// ─── Block 2: Client metrics ────────────────────────────────

/** LTV = avg_check × avg_purchases. */
export function calcLTV(
  avgCheck: number | null,
  avgPurchases: number | null,
): number | null {
  if (!isFiniteNum(avgCheck) || !isFiniteNum(avgPurchases)) return null
  return avgCheck * avgPurchases
}

/** CAC = mktg_budget / New. */
export function calcCAC(
  marketingBudget: number | null,
  newCount: number | null,
): number | null {
  return safeDiv(marketingBudget, newCount)
}

/** CPL = mktg_budget / leads. */
export function calcCPL(
  marketingBudget: number | null,
  leads: number | null,
): number | null {
  return safeDiv(marketingBudget, leads)
}

/** LTV : CAC ratio. */
export function calcLTVtoCAC(
  ltv: number | null,
  cac: number | null,
): number | null {
  return safeDiv(ltv, cac)
}

/**
 * ROMI = (RevNew − CAC × New) / (CAC × New), expressed as %.
 * A value of 100 means each ₸ of CAC returned 1 ₸ of net new revenue.
 */
export function calcROMI(
  revNew: number | null,
  cac: number | null,
  newCount: number | null,
): number | null {
  if (!isFiniteNum(revNew) || !isFiniteNum(cac) || !isFiniteNum(newCount)) return null
  const spend = cac * newCount
  if (spend === 0) return null
  return ((revNew - spend) / spend) * 100
}

// ─── Block 3: Retention ─────────────────────────────────────

/** TotalC: count of all rows in the client base. */
export function calcTotalC(rows: number | null): number | null {
  return isFiniteNum(rows) ? rows : null
}

/**
 * Active = COUNT(clients whose last purchase happened in the last 12 months).
 *
 * Note: the spec is ambiguous ("покупка ≥ 12 мес назад") but the obvious
 * business meaning is "purchase within the last 12 months". We implement
 * that. Caller passes the already-filtered count.
 */
export function calcActive(activeLast12mo: number | null): number | null {
  return isFiniteNum(activeLast12mo) ? activeLast12mo : null
}

/** NewY = count of first purchases in the last 12 months. */
export function calcNewY(newLast12mo: number | null): number | null {
  return isFiniteNum(newLast12mo) ? newLast12mo : null
}

/** Sleep = count of clients with no purchase for > 12 months. */
export function calcSleep(sleeping: number | null): number | null {
  return isFiniteNum(sleeping) ? sleeping : null
}

/** RetRate = Ret / TotalC × 100. */
export function calcRetRate(
  ret: number | null,
  totalC: number | null,
): number | null {
  const ratio = safeDiv(ret, totalC)
  return ratio == null ? null : ratio * 100
}

/** AvgPurch = SUM(purchases) / TotalC. */
export function calcAvgPurch(
  sumPurchases: number | null,
  totalC: number | null,
): number | null {
  return safeDiv(sumPurchases, totalC)
}

/** Freq = MEDIAN(intervals between purchases) in days. */
export function calcFreq(intervalsDays: number[]): number | null {
  return median(intervalsDays)
}

/** Churn = Sleep / TotalC × 100. */
export function calcChurn(
  sleep: number | null,
  totalC: number | null,
): number | null {
  const ratio = safeDiv(sleep, totalC)
  return ratio == null ? null : ratio * 100
}

// ─── Block 4: Finance ───────────────────────────────────────

/** GrossRev = SUM(all inflows). */
export function calcGrossRev(rev: number | null): number | null {
  return isFiniteNum(rev) ? rev : null
}

/** GrossProfit = Revenue − COGS. */
export function calcGrossProfit(
  rev: number | null,
  cogs: number | null,
): number | null {
  if (!isFiniteNum(rev) || !isFiniteNum(cogs)) return null
  return rev - cogs
}

/** GrossMargin = GrossProfit / Rev × 100, %. */
export function calcGrossMargin(
  grossProfit: number | null,
  rev: number | null,
): number | null {
  const ratio = safeDiv(grossProfit, rev)
  return ratio == null ? null : ratio * 100
}

/**
 * EBITDA = Profit + Depreciation + Taxes + Interest.
 *
 * In practice the P&L parser gives us EBITDA directly. If not, we
 * derive it from netProfit + depreciation + taxes + interest.
 */
export function calcEBITDA(parts: {
  ebitda?: number | null
  netProfit?: number | null
  depreciation?: number | null
  taxes?: number | null
  interest?: number | null
}): number | null {
  if (isFiniteNum(parts.ebitda)) return parts.ebitda
  const np = parts.netProfit
  const dep = parts.depreciation
  const tax = parts.taxes
  const int = parts.interest
  if (!isFiniteNum(np) || !isFiniteNum(dep) || !isFiniteNum(tax) || !isFiniteNum(int)) {
    return null
  }
  return np + dep + tax + int
}

/** NetProfit = EBITDA − Taxes − Interest − Depreciation. */
export function calcNetProfit(parts: {
  netProfit?: number | null
  ebitda?: number | null
  depreciation?: number | null
  taxes?: number | null
  interest?: number | null
}): number | null {
  if (isFiniteNum(parts.netProfit)) return parts.netProfit
  const e = parts.ebitda
  const dep = parts.depreciation
  const tax = parts.taxes
  const int = parts.interest
  if (!isFiniteNum(e) || !isFiniteNum(dep) || !isFiniteNum(tax) || !isFiniteNum(int)) {
    return null
  }
  return e - dep - tax - int
}

/** NetMargin = NetProfit / Rev × 100, %. */
export function calcNetMargin(
  netProfit: number | null,
  rev: number | null,
): number | null {
  const ratio = safeDiv(netProfit, rev)
  return ratio == null ? null : ratio * 100
}

/** COGS% = COGS / Rev × 100. */
export function calcCOGSpct(
  cogs: number | null,
  rev: number | null,
): number | null {
  const ratio = safeDiv(cogs, rev)
  return ratio == null ? null : ratio * 100
}

/** Payroll% = Payroll / Rev × 100. */
export function calcPayrollPct(
  payroll: number | null,
  rev: number | null,
): number | null {
  const ratio = safeDiv(payroll, rev)
  return ratio == null ? null : ratio * 100
}

/** Mktg% = Marketing / Rev × 100. */
export function calcMktgPct(
  marketing: number | null,
  rev: number | null,
): number | null {
  const ratio = safeDiv(marketing, rev)
  return ratio == null ? null : ratio * 100
}

/**
 * BEP (break-even point in money units) = fixed / (1 − variable / Rev).
 *
 * Returns null when the contribution ratio is non-positive (variable costs
 * exceed revenue → no break-even at the current price/cost structure).
 */
export function calcBEP(
  fixedCosts: number | null,
  variableCosts: number | null,
  rev: number | null,
): number | null {
  if (!isFiniteNum(fixedCosts) || !isFiniteNum(variableCosts) || !isFiniteNum(rev)) {
    return null
  }
  if (rev <= 0) return null
  const contributionRatio = 1 - variableCosts / rev
  if (contributionRatio <= 0) return null
  return fixedCosts / contributionRatio
}

// ─── Block 5: Funnel ────────────────────────────────────────

/** Leads = COUNT(new enquiries). */
export function calcLeads(leads: number | null): number | null {
  return isFiniteNum(leads) ? leads : null
}

/** CR1 = New / Leads × 100. */
export function calcCR1(
  newCount: number | null,
  leads: number | null,
): number | null {
  const ratio = safeDiv(newCount, leads)
  return ratio == null ? null : ratio * 100
}

/** CR2 = COUNT(2+ purchases) / New × 100. */
export function calcCR2(
  repeatCount: number | null,
  newCount: number | null,
): number | null {
  const ratio = safeDiv(repeatCount, newCount)
  return ratio == null ? null : ratio * 100
}

/** RT = first-response time in seconds. */
export function calcRT(seconds: number | null): number | null {
  return isFiniteNum(seconds) ? seconds : null
}

/** Missed% = missed / total × 100. */
export function calcMissed(
  missed: number | null,
  total: number | null,
): number | null {
  const ratio = safeDiv(missed, total)
  return ratio == null ? null : ratio * 100
}

/** NoShow% = no-shows / appointments × 100. */
export function calcNoShow(
  noShow: number | null,
  appointments: number | null,
): number | null {
  const ratio = safeDiv(noShow, appointments)
  return ratio == null ? null : ratio * 100
}

/** OptIn% = opt-in clients / TotalC × 100. */
export function calcOptIn(
  optInCount: number | null,
  totalC: number | null,
): number | null {
  const ratio = safeDiv(optInCount, totalC)
  return ratio == null ? null : ratio * 100
}

// ─── Block 6: AI Comms ──────────────────────────────────────
// All values come from AI-comms telemetry — until launch, callers
// pass null and the metric reports "no_data".

export function calcConfRate(
  confirmed: number | null,
  sent: number | null,
): number | null {
  const ratio = safeDiv(confirmed, sent)
  return ratio == null ? null : ratio * 100
}

export function calcNoShowDown(
  before: number | null,
  after: number | null,
): number | null {
  if (!isFiniteNum(before) || !isFiniteNum(after)) return null
  return before - after
}

export function calcFUpCR(
  purchases: number | null,
  followups: number | null,
): number | null {
  const ratio = safeDiv(purchases, followups)
  return ratio == null ? null : ratio * 100
}

export function calcAvgReply(avgSeconds: number | null): number | null {
  return isFiniteNum(avgSeconds) ? avgSeconds : null
}

export function calcReact(
  returned: number | null,
  sleeping: number | null,
): number | null {
  const ratio = safeDiv(returned, sleeping)
  return ratio == null ? null : ratio * 100
}

/**
 * NPS — accept either a raw average (1–5 scale) or a precomputed NPS score.
 * If both "promoters" and "detractors" shares (in %) are supplied, compute
 * standard NPS = %promoters − %detractors.
 */
export function calcNPS(parts: {
  avgScore?: number | null
  promotersPct?: number | null
  detractorsPct?: number | null
}): number | null {
  if (isFiniteNum(parts.promotersPct) && isFiniteNum(parts.detractorsPct)) {
    return parts.promotersPct - parts.detractorsPct
  }
  if (isFiniteNum(parts.avgScore)) return parts.avgScore
  return null
}

export function calcNPSResp(
  responses: number | null,
  sent: number | null,
): number | null {
  const ratio = safeDiv(responses, sent)
  return ratio == null ? null : ratio * 100
}

export function calcRef(referralNew: number | null): number | null {
  return isFiniteNum(referralNew) ? referralNew : null
}
