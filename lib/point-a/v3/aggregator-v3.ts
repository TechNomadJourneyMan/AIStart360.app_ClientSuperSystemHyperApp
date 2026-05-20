// ============================================================
// lib/point-a/v3/aggregator-v3.ts
// Pure orchestrator that turns survey answers + document
// parsed_data + (optionally) timeseries data + the company row
// into a fully populated PointAV3 payload.
//
// This file does no I/O. It is deterministic so it can be unit
// tested with mock inputs.  The caller is expected to gather
// survey + document inputs before calling.
// ============================================================

import type {
  AiCommsBlock,
  ClientBlock,
  FinanceBlock,
  FunnelBlock,
  PointAV3,
  RetentionBlock,
  SalesBlock,
  V3Metric,
  V3MetricSource,
  V3MetricStatus,
  V3MetricUnit,
} from '@/types/point-a-v3'
import {
  calcActive,
  calcAOV,
  calcAOVnew,
  calcAvgPurch,
  calcAvgReply,
  calcBEP,
  calcCAC,
  calcChurn,
  calcCOGSpct,
  calcConfRate,
  calcCPL,
  calcCR1,
  calcCR2,
  calcEBITDA,
  calcFreq,
  calcFUpCR,
  calcGrossMargin,
  calcGrossProfit,
  calcGrossRev,
  calcLeads,
  calcLTV,
  calcLTVtoCAC,
  calcMissed,
  calcMktgPct,
  calcN,
  calcNetMargin,
  calcNetProfit,
  calcNew,
  calcNewY,
  calcNoShow,
  calcNoShowDown,
  calcNPS,
  calcNPSResp,
  calcOptIn,
  calcPayrollPct,
  calcReact,
  calcRef,
  calcRet,
  calcRetRate,
  calcRev,
  calcRevNew,
  calcRevRet,
  calcRT,
  calcSleep,
  calcTotalC,
  statusCount,
  statusHigherIsBetter,
  statusInRange,
  statusLowerIsBetter,
} from '@/lib/point-a/v3/formulas'

// ─── Inputs ─────────────────────────────────────────────────

/**
 * Subset of the `companies` row that the aggregator actually uses.
 * Everything optional so tests can pass a partial object.
 */
export interface AggregatorCompanyContext {
  industry?: string | null
  stage?: string | null
  business_model?: string | null
}

/**
 * Shape of `documents.parsed_data` aggregated across one or more uploads.
 * Each field is optional — the aggregator is robust to missing values.
 *
 * The shape matches what `lib/documents/extract.ts` produces
 * (ParsedDataPayload.fields), but rolled up into a single object the
 * caller has resolved by `metric_id` / `key`.
 */
export interface AggregatorDocumentContext {
  // Sales / revenue
  sales_count?: number | null            // N
  revenue_total?: number | null          // Rev
  new_clients_count?: number | null      // New
  revenue_from_new?: number | null       // RevNew
  repeat_purchases_count?: number | null // Ret
  revenue_from_repeat?: number | null    // RevRet

  // Client base (RFM-style aggregates)
  total_clients?: number | null          // TotalC
  active_last_12mo?: number | null       // Active
  new_last_12mo?: number | null          // NewY
  sleeping_clients?: number | null       // Sleep
  avg_purchases_per_client?: number | null
  median_interval_days?: number | null   // Freq

  // Marketing
  marketing_budget?: number | null
  leads_count?: number | null
  opt_in_clients?: number | null

  // Funnel
  first_response_seconds?: number | null
  missed_count?: number | null
  total_incoming?: number | null
  no_show_count?: number | null
  appointments_count?: number | null

  // Finance / P&L
  cogs?: number | null
  payroll?: number | null
  ebitda?: number | null
  net_profit?: number | null
  depreciation?: number | null
  taxes?: number | null
  interest?: number | null
  fixed_costs?: number | null
  variable_costs?: number | null

  // AI-comms (always null until AI-comms launched)
  whatsapp_confirmations_sent?: number | null
  whatsapp_confirmations_confirmed?: number | null
  noshow_before?: number | null
  noshow_after?: number | null
  followup_sent?: number | null
  followup_purchases?: number | null
  avg_reply_seconds?: number | null
  sleeping_returned?: number | null
  nps_avg_score?: number | null
  nps_promoters_pct?: number | null
  nps_detractors_pct?: number | null
  nps_responses?: number | null
  nps_sent?: number | null
  referrals_new?: number | null
}

/**
 * Aggregator inputs. Everything optional so the aggregator can produce a
 * meaningful "all no_data" payload from an empty input.
 */
export interface AggregatorV3Input {
  /** Survey answers keyed by question_key (s1..s12). */
  surveyAnswers?: Record<string, unknown>
  /** Roll-up of parsed_data from uploaded documents. */
  documents?: AggregatorDocumentContext
  /** Optional company row (industry, stage, business_model). */
  company?: AggregatorCompanyContext
  /**
   * Optional Date used for the `computed_at` timestamp — handy for tests
   * that need a deterministic ISO. Defaults to `new Date()`.
   */
  now?: Date
}

// ─── Internal helpers ───────────────────────────────────────

/** Build a single metric entry. */
function metric(
  key: string,
  label_ru: string,
  label_en: string,
  value: number | null,
  target: number | string,
  status: V3MetricStatus,
  source: V3MetricSource,
  formula: string,
  unit: V3MetricUnit,
): V3Metric {
  return { key, label_ru, label_en, value, target, status, source, formula, unit }
}

/** Read a numeric survey answer. Accepts both `{value: x}` and bare `x`. */
function num(answer: unknown): number | null {
  if (answer === null || answer === undefined) return null
  if (typeof answer === 'number' && Number.isFinite(answer)) return answer
  if (
    typeof answer === 'object' &&
    answer !== null &&
    'value' in (answer as Record<string, unknown>)
  ) {
    const v = (answer as { value: unknown }).value
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v)
    }
  }
  if (typeof answer === 'string' && answer.trim() !== '' && Number.isFinite(Number(answer))) {
    return Number(answer)
  }
  return null
}

/**
 * Pick the first non-null value among the candidates.
 * Used so survey-derived figures can take precedence over document figures
 * (or vice-versa) without lots of `??` chains at the call site.
 */
function firstNonNull(...candidates: Array<number | null | undefined>): number | null {
  for (const c of candidates) {
    if (c !== null && c !== undefined && Number.isFinite(c)) return c
  }
  return null
}

/** Pick the appropriate `source` label given which input populated the value. */
function pickSource(
  value: number | null,
  fromSurvey: number | null,
  fromDocument: number | null,
): V3MetricSource {
  if (value === null) return 'computed'
  if (fromSurvey !== null && value === fromSurvey) return 'survey'
  if (fromDocument !== null && value === fromDocument) return 'document'
  return 'computed'
}

// ─── Block 1: Sales ─────────────────────────────────────────

function buildSales(input: AggregatorV3Input): SalesBlock {
  const docs = input.documents ?? {}
  const ans = input.surveyAnswers ?? {}

  // Survey hooks: s3_deals_* are the closest analogue to count of sales.
  const s3deals2025 = num(ans.s3_deals_2025)
  const s2rev2025 = num(ans.s2_revenue_2025)
  const s2newClients2025 = num(ans.s2_new_clients_2025)
  const s2repeatClients2025 = num(ans.s2_repeat_clients_2025)
  const s2avgCheck = num(ans.s2_avg_check)

  const N = firstNonNull(calcN(docs.sales_count ?? null), s3deals2025)
  const Rev = firstNonNull(calcRev(docs.revenue_total ?? null), s2rev2025)
  const AOV = firstNonNull(calcAOV(Rev, N), s2avgCheck)
  const NewCount = firstNonNull(calcNew(docs.new_clients_count ?? null), s2newClients2025)
  const RevNew = calcRevNew(docs.revenue_from_new ?? null)
  const AOVnew = calcAOVnew(RevNew, NewCount)
  const Ret = firstNonNull(
    calcRet(docs.repeat_purchases_count ?? null),
    s2repeatClients2025,
  )
  const RevRet = calcRevRet(docs.revenue_from_repeat ?? null)

  // For Ret target: > 35% of total sales. We compare Ret/N×100 against 35.
  const retShare = Ret !== null && N !== null && N > 0 ? (Ret / N) * 100 : null
  // For RevRet target: ≥ 40% of revenue. We compare RevRet/Rev×100 against 40.
  const revRetShare =
    RevRet !== null && Rev !== null && Rev > 0 ? (RevRet / Rev) * 100 : null

  return {
    N: metric(
      'N',
      'Количество продаж',
      'Sales count',
      N,
      'Рост +20%/год',
      statusCount(N),
      pickSource(N, s3deals2025, docs.sales_count ?? null),
      'COUNT(строк с оплатой)',
      'count',
    ),
    Rev: metric(
      'Rev',
      'Сумма продаж',
      'Revenue',
      Rev,
      '= Цель на год',
      statusCount(Rev),
      pickSource(Rev, s2rev2025, docs.revenue_total ?? null),
      'SUM(сумма оплат)',
      '₸',
    ),
    AOV: metric(
      'AOV',
      'Средний чек',
      'Average order value',
      AOV,
      'Рост +10%/год',
      statusCount(AOV),
      AOV !== null && AOV === s2avgCheck ? 'survey' : 'computed',
      'Rev / N',
      '₸',
    ),
    New: metric(
      'New',
      'Новые клиенты',
      'New clients',
      NewCount,
      'По плану привлечения',
      statusCount(NewCount),
      pickSource(NewCount, s2newClients2025, docs.new_clients_count ?? null),
      'COUNT(первых покупок)',
      'count',
    ),
    RevNew: metric(
      'RevNew',
      'Выручка от новых клиентов',
      'Revenue from new clients',
      RevNew,
      'Доля ≤ 60% выручки',
      statusCount(RevNew),
      RevNew === null ? 'computed' : 'document',
      'SUM(продажи новым)',
      '₸',
    ),
    AOVnew: metric(
      'AOVnew',
      'Средний чек новых клиентов',
      'AOV new clients',
      AOVnew,
      'Близко к общему AOV',
      statusCount(AOVnew),
      'computed',
      'RevNew / New',
      '₸',
    ),
    Ret: metric(
      'Ret',
      'Повторные продажи',
      'Repeat sales',
      Ret,
      '> 35% от общих продаж',
      retShare !== null ? statusHigherIsBetter(retShare, 35) : statusCount(Ret),
      pickSource(Ret, s2repeatClients2025, docs.repeat_purchases_count ?? null),
      'COUNT(повторных покупок)',
      'count',
    ),
    RevRet: metric(
      'RevRet',
      'Выручка от повторных клиентов',
      'Revenue from repeat clients',
      RevRet,
      '≥ 40% выручки',
      revRetShare !== null ? statusHigherIsBetter(revRetShare, 40) : statusCount(RevRet),
      RevRet === null ? 'computed' : 'document',
      'SUM(повторные продажи)',
      '₸',
    ),
  }
}

// ─── Block 2: Client metrics ────────────────────────────────

function buildClient(input: AggregatorV3Input, sales: SalesBlock): ClientBlock {
  const docs = input.documents ?? {}
  const ans = input.surveyAnswers ?? {}
  const s2ltv = num(ans.s2_ltv)
  const s2cac = num(ans.s2_cac)
  const s2avgCheck = num(ans.s2_avg_check)
  const newCount = sales.New.value
  const revNew = sales.RevNew.value

  // LTV: prefer survey-declared; otherwise compute from avg_check × avg_purchases (doc).
  const computedLTV = calcLTV(s2avgCheck, docs.avg_purchases_per_client ?? null)
  const LTV = firstNonNull(s2ltv, computedLTV)

  // CAC: budget / New. Fall back to survey-declared CAC.
  const computedCAC = calcCAC(docs.marketing_budget ?? null, newCount)
  const CAC = firstNonNull(computedCAC, s2cac)

  const CPL = calcCPL(docs.marketing_budget ?? null, docs.leads_count ?? null)
  const LTVtoCAC = calcLTVtoCAC(LTV, CAC)
  const ROMI = calcROMIWithCAC(revNew, CAC, newCount)

  return {
    LTV: metric(
      'LTV',
      'Пожизненная ценность клиента',
      'Lifetime value',
      LTV,
      'Рост +15%/год',
      statusCount(LTV),
      LTV !== null && LTV === s2ltv ? 'survey' : 'computed',
      'Ср. чек × Ср. кол-во покупок',
      '₸',
    ),
    CAC: metric(
      'CAC',
      'Цена привлечения клиента',
      'Customer acquisition cost',
      CAC,
      LTV ? `< ${(LTV / 3).toFixed(0)} ₸ (LTV/3)` : '< LTV / 3',
      classifyCAC(CAC, LTV),
      CAC !== null && CAC === s2cac ? 'survey' : 'computed',
      'Маркетинг. бюджет / New',
      '₸',
    ),
    CPL: metric(
      'CPL',
      'Цена лида',
      'Cost per lead',
      CPL,
      CAC ? `< ${(CAC / 2).toFixed(0)} ₸ (CAC/2)` : '< CAC / 2',
      classifyCPL(CPL, CAC),
      'computed',
      'Бюджет / Кол-во лидов',
      '₸',
    ),
    LTV_CAC: metric(
      'LTV_CAC',
      'LTV : CAC',
      'LTV to CAC',
      LTVtoCAC,
      '≥ 3:1; цель ≥ 5:1',
      LTVtoCAC === null
        ? 'no_data'
        : LTVtoCAC >= 5
          ? 'excellent'
          : LTVtoCAC >= 3
            ? 'good'
            : LTVtoCAC >= 2
              ? 'warning'
              : 'critical',
      'computed',
      'LTV / CAC',
      null,
    ),
    ROMI: metric(
      'ROMI',
      'ROI маркетинга',
      'Marketing ROI',
      ROMI,
      '> 100%',
      ROMI === null ? 'no_data' : statusHigherIsBetter(ROMI, 100),
      'computed',
      '(RevNew − CAC × New) / (CAC × New)',
      '%',
    ),
  }
}

/** ROMI = (RevNew − CAC × New) / (CAC × New) × 100. */
function calcROMIWithCAC(
  revNew: number | null,
  cac: number | null,
  newCount: number | null,
): number | null {
  if (
    revNew === null ||
    cac === null ||
    newCount === null ||
    !Number.isFinite(revNew) ||
    !Number.isFinite(cac) ||
    !Number.isFinite(newCount)
  ) {
    return null
  }
  const spend = cac * newCount
  if (spend === 0) return null
  return ((revNew - spend) / spend) * 100
}

function classifyCAC(cac: number | null, ltv: number | null): V3MetricStatus {
  if (cac === null) return 'no_data'
  if (ltv === null || !Number.isFinite(ltv) || ltv <= 0) {
    // No LTV anchor — treat as "good" since we at least computed CAC.
    return 'good'
  }
  const limit = ltv / 3
  return statusLowerIsBetter(cac, limit)
}

function classifyCPL(cpl: number | null, cac: number | null): V3MetricStatus {
  if (cpl === null) return 'no_data'
  if (cac === null || !Number.isFinite(cac) || cac <= 0) return 'good'
  const limit = cac / 2
  return statusLowerIsBetter(cpl, limit)
}

// ─── Block 3: Retention ─────────────────────────────────────

function buildRetention(input: AggregatorV3Input, sales: SalesBlock): RetentionBlock {
  const docs = input.documents ?? {}
  const ans = input.surveyAnswers ?? {}

  const TotalC = calcTotalC(docs.total_clients ?? null)
  const Active = calcActive(docs.active_last_12mo ?? null)
  const NewY = firstNonNull(
    calcNewY(docs.new_last_12mo ?? null),
    num(ans.s2_new_clients_2025),
  )
  const Sleep = calcSleep(docs.sleeping_clients ?? null)
  const Ret = sales.Ret.value
  const RetRate = calcRetRate(Ret, TotalC)
  const AvgPurch = firstNonNull(
    docs.avg_purchases_per_client ?? null,
    calcAvgPurch(null, TotalC),
  )
  // Freq we accept either the precomputed median from docs or an empty array.
  const Freq = docs.median_interval_days ?? calcFreq([])
  const Churn = calcChurn(Sleep, TotalC)

  // % shares vs base for Active/Sleep targets.
  const activeShare = Active !== null && TotalC !== null && TotalC > 0
    ? (Active / TotalC) * 100
    : null
  const sleepShare = Sleep !== null && TotalC !== null && TotalC > 0
    ? (Sleep / TotalC) * 100
    : null

  return {
    TotalC: metric(
      'TotalC',
      'Всего клиентов в базе',
      'Total clients',
      TotalC,
      'Рост +20%/год',
      statusCount(TotalC),
      TotalC === null ? 'computed' : 'document',
      'COUNT(все строки)',
      'count',
    ),
    Active: metric(
      'Active',
      'Активных за последние 12 мес',
      'Active last 12mo',
      Active,
      '> 75% базы',
      activeShare !== null ? statusHigherIsBetter(activeShare, 75) : statusCount(Active),
      Active === null ? 'computed' : 'document',
      'COUNT(покупка в последние 12 мес)',
      'count',
    ),
    NewY: metric(
      'NewY',
      'Новых за последние 12 мес',
      'New last 12mo',
      NewY,
      'По плану',
      statusCount(NewY),
      'computed',
      'COUNT(первая покупка в последние 12 мес)',
      'count',
    ),
    Sleep: metric(
      'Sleep',
      'Спящих (нет покупки > 12 мес)',
      'Sleeping clients',
      Sleep,
      '< 20% базы',
      sleepShare !== null ? statusLowerIsBetter(sleepShare, 20) : statusCount(Sleep),
      Sleep === null ? 'computed' : 'document',
      'COUNT(посл. покупка > 12 мес назад)',
      'count',
    ),
    RetRate: metric(
      'RetRate',
      'Доля повторных клиентов',
      'Repeat client share',
      RetRate,
      '> 35%',
      RetRate === null ? 'no_data' : statusHigherIsBetter(RetRate, 35),
      'computed',
      'Ret / TotalC × 100%',
      '%',
    ),
    AvgPurch: metric(
      'AvgPurch',
      'Среднее кол-во покупок на клиента',
      'Average purchases per client',
      AvgPurch,
      'Отраслевой бенчмарк',
      statusCount(AvgPurch),
      AvgPurch === null ? 'computed' : 'document',
      'SUM(покупки) / TotalC',
      'count',
    ),
    Freq: metric(
      'Freq',
      'Медиана дней между покупками',
      'Median days between purchases',
      Freq,
      '< 90 дней',
      Freq === null ? 'no_data' : statusLowerIsBetter(Freq, 90),
      Freq === null ? 'computed' : 'document',
      'MEDIAN(интервалы между покупками)',
      'days',
    ),
    Churn: metric(
      'Churn',
      'Отток клиентов',
      'Churn rate',
      Churn,
      '< 15%/год',
      Churn === null ? 'no_data' : statusLowerIsBetter(Churn, 15),
      'computed',
      '(Sleep / TotalC) × 100%',
      '%',
    ),
  }
}

// ─── Block 4: Finance ───────────────────────────────────────

function buildFinance(input: AggregatorV3Input, sales: SalesBlock): FinanceBlock {
  const docs = input.documents ?? {}
  const ans = input.surveyAnswers ?? {}

  const Rev = sales.Rev.value
  const COGS = docs.cogs ?? null
  const GrossRev = calcGrossRev(Rev)
  const GrossProfit = calcGrossProfit(Rev, COGS)
  const surveyGrossMargin = num(ans.s2_gross_margin) // percent
  const GrossMargin = firstNonNull(
    calcGrossMargin(GrossProfit, Rev),
    surveyGrossMargin,
  )

  const EBITDA = calcEBITDA({
    ebitda: docs.ebitda ?? null,
    netProfit: docs.net_profit ?? null,
    depreciation: docs.depreciation ?? null,
    taxes: docs.taxes ?? null,
    interest: docs.interest ?? null,
  })

  const NetProfit = calcNetProfit({
    netProfit: docs.net_profit ?? null,
    ebitda: docs.ebitda ?? null,
    depreciation: docs.depreciation ?? null,
    taxes: docs.taxes ?? null,
    interest: docs.interest ?? null,
  })

  const NetMargin = calcNetMargin(NetProfit, Rev)
  const COGSpct = calcCOGSpct(COGS, Rev)
  const PayrollPct = calcPayrollPct(docs.payroll ?? null, Rev)
  const MktgPct = calcMktgPct(docs.marketing_budget ?? null, Rev)
  const BEP = calcBEP(docs.fixed_costs ?? null, docs.variable_costs ?? null, Rev)

  // EBITDA / NetProfit are spec'd against "% of revenue".
  const ebitdaPct =
    EBITDA !== null && Rev !== null && Rev > 0 ? (EBITDA / Rev) * 100 : null
  const ebitdaStatus =
    ebitdaPct !== null ? statusHigherIsBetter(ebitdaPct, 15) : statusCount(EBITDA)

  const npPct =
    NetProfit !== null && Rev !== null && Rev > 0 ? (NetProfit / Rev) * 100 : null
  const npStatus =
    npPct !== null ? statusHigherIsBetter(npPct, 10) : statusCount(NetProfit)

  return {
    GrossRev: metric(
      'GrossRev',
      'Валовая выручка',
      'Gross revenue',
      GrossRev,
      '= Плановая выручка',
      statusCount(GrossRev),
      GrossRev !== null && GrossRev === Rev ? 'computed' : 'document',
      'SUM(все поступления)',
      '₸',
    ),
    GrossProfit: metric(
      'GrossProfit',
      'Валовая прибыль',
      'Gross profit',
      GrossProfit,
      'Отраслевой бенчмарк',
      statusCount(GrossProfit),
      'computed',
      'Выручка − Себестоимость',
      '₸',
    ),
    GrossMargin: metric(
      'GrossMargin',
      'Валовая маржа',
      'Gross margin',
      GrossMargin,
      '> 40% (услуги)',
      GrossMargin === null ? 'no_data' : statusHigherIsBetter(GrossMargin, 40),
      GrossMargin === surveyGrossMargin && surveyGrossMargin !== null
        ? 'survey'
        : 'computed',
      'GrossProfit / Rev × 100%',
      '%',
    ),
    EBITDA: metric(
      'EBITDA',
      'EBITDA',
      'EBITDA',
      EBITDA,
      '> 15% выручки',
      ebitdaStatus,
      EBITDA === null ? 'computed' : 'document',
      'Прибыль + Аморт. + Налоги + % по кредитам',
      '₸',
    ),
    NetProfit: metric(
      'NetProfit',
      'Чистая прибыль',
      'Net profit',
      NetProfit,
      '> 10% выручки',
      npStatus,
      NetProfit === null ? 'computed' : 'document',
      'EBITDA − Налоги − % − Аморт.',
      '₸',
    ),
    NetMargin: metric(
      'NetMargin',
      'Чистая маржа',
      'Net margin',
      NetMargin,
      '> 10%',
      NetMargin === null ? 'no_data' : statusHigherIsBetter(NetMargin, 10),
      'computed',
      'NetProfit / Rev × 100%',
      '%',
    ),
    COGS_pct: metric(
      'COGS_pct',
      'Себестоимость (% выручки)',
      'COGS %',
      COGSpct,
      '< 60% (услуги)',
      COGSpct === null ? 'no_data' : statusLowerIsBetter(COGSpct, 60),
      'computed',
      'Себестоимость / Rev × 100%',
      '%',
    ),
    Payroll_pct: metric(
      'Payroll_pct',
      'ФОТ (% выручки)',
      'Payroll %',
      PayrollPct,
      '< 35%',
      PayrollPct === null ? 'no_data' : statusLowerIsBetter(PayrollPct, 35),
      'computed',
      'ФОТ / Rev × 100%',
      '%',
    ),
    Mktg_pct: metric(
      'Mktg_pct',
      'Маркетинг (% выручки)',
      'Marketing %',
      MktgPct,
      '5–15%',
      MktgPct === null ? 'no_data' : statusInRange(MktgPct, 5, 15),
      'computed',
      'Реклама / Rev × 100%',
      '%',
    ),
    BEP: metric(
      'BEP',
      'Точка безубыточности',
      'Break-even point',
      BEP,
      'Ввести вручную',
      statusCount(BEP),
      'computed',
      'Пост. расходы / (1 − Пер.расх / Rev)',
      '₸',
    ),
  }
}

// ─── Block 5: Funnel ────────────────────────────────────────

function buildFunnel(
  input: AggregatorV3Input,
  sales: SalesBlock,
  retention: RetentionBlock,
): FunnelBlock {
  const docs = input.documents ?? {}

  const Leads = calcLeads(docs.leads_count ?? null)
  const CR1 = calcCR1(sales.New.value, Leads)
  const CR2 = calcCR2(sales.Ret.value, sales.New.value)
  const RT = calcRT(docs.first_response_seconds ?? null)
  const Missed = calcMissed(docs.missed_count ?? null, docs.total_incoming ?? null)
  const NoShow = calcNoShow(docs.no_show_count ?? null, docs.appointments_count ?? null)
  const OptIn = calcOptIn(docs.opt_in_clients ?? null, retention.TotalC.value)

  return {
    Leads: metric(
      'Leads',
      'Кол-во входящих лидов',
      'Incoming leads',
      Leads,
      'По плану',
      statusCount(Leads),
      Leads === null ? 'computed' : 'document',
      'COUNT(новые обращения)',
      'count',
    ),
    CR1: metric(
      'CR1',
      'Конверсия лид → первая покупка',
      'CR lead → first purchase',
      CR1,
      '> 40%',
      CR1 === null ? 'no_data' : statusHigherIsBetter(CR1, 40),
      'computed',
      'New / Leads × 100%',
      '%',
    ),
    CR2: metric(
      'CR2',
      'Конверсия 1-я → 2-я покупка',
      'CR 1st → 2nd purchase',
      CR2,
      '> 50%',
      CR2 === null ? 'no_data' : statusHigherIsBetter(CR2, 50),
      'computed',
      'COUNT(2+ покупки) / New × 100%',
      '%',
    ),
    RT: metric(
      'RT',
      'Скорость первого ответа',
      'Response time',
      RT,
      '< 60 секунд',
      RT === null ? 'no_data' : statusLowerIsBetter(RT, 60),
      RT === null ? 'computed' : 'document',
      'Время от обращения до ответа',
      'sec',
    ),
    Missed: metric(
      'Missed',
      '% пропущенных обращений',
      'Missed %',
      Missed,
      '< 5%',
      Missed === null ? 'no_data' : statusLowerIsBetter(Missed, 5),
      'computed',
      'Пропущ. / Все обращения × 100%',
      '%',
    ),
    NoShow: metric(
      'NoShow',
      'No-show rate',
      'No-show rate',
      NoShow,
      '< 10%',
      NoShow === null ? 'no_data' : statusLowerIsBetter(NoShow, 10),
      'computed',
      'Не пришли / Записаны × 100%',
      '%',
    ),
    OptIn: metric(
      'OptIn',
      '% согласившихся на рассылки',
      'Opt-in %',
      OptIn,
      '> 70%',
      OptIn === null ? 'no_data' : statusHigherIsBetter(OptIn, 70),
      'computed',
      'Согласия / TotalC × 100%',
      '%',
    ),
  }
}

// ─── Block 6: AI Comms ──────────────────────────────────────

function buildAiComms(input: AggregatorV3Input): AiCommsBlock {
  const docs = input.documents ?? {}

  const ConfRate = calcConfRate(
    docs.whatsapp_confirmations_confirmed ?? null,
    docs.whatsapp_confirmations_sent ?? null,
  )
  const NoShowDown = calcNoShowDown(docs.noshow_before ?? null, docs.noshow_after ?? null)
  const FUpCR = calcFUpCR(docs.followup_purchases ?? null, docs.followup_sent ?? null)
  const AvgReply = calcAvgReply(docs.avg_reply_seconds ?? null)
  const React = calcReact(docs.sleeping_returned ?? null, docs.sleeping_clients ?? null)
  const NPS = calcNPS({
    avgScore: docs.nps_avg_score ?? null,
    promotersPct: docs.nps_promoters_pct ?? null,
    detractorsPct: docs.nps_detractors_pct ?? null,
  })
  const NPSResp = calcNPSResp(docs.nps_responses ?? null, docs.nps_sent ?? null)
  const Ref = calcRef(docs.referrals_new ?? null)

  return {
    ConfRate: metric(
      'ConfRate',
      'Конверсия подтверждения визита',
      'Confirmation rate',
      ConfRate,
      '> 85%',
      ConfRate === null ? 'no_data' : statusHigherIsBetter(ConfRate, 85),
      'ai_comms',
      'Подтвердили / Отправлено × 100%',
      '%',
    ),
    NoShowDown: metric(
      'NoShowDown',
      'Снижение no-show после внедрения',
      'No-show reduction',
      NoShowDown,
      'Снижение на 50%+',
      NoShowDown === null ? 'no_data' : statusHigherIsBetter(NoShowDown, 0),
      'ai_comms',
      'NoShow(до) − NoShow(после)',
      '%',
    ),
    FUpCR: metric(
      'FUpCR',
      'Конверсия follow-up → покупка',
      'Follow-up CR',
      FUpCR,
      '> 50%',
      FUpCR === null ? 'no_data' : statusHigherIsBetter(FUpCR, 50),
      'ai_comms',
      'Покупки / Follow-up × 100%',
      '%',
    ),
    AvgReply: metric(
      'AvgReply',
      'Среднее время до ответа клиента',
      'Avg reply time',
      AvgReply,
      '< 2 часа',
      AvgReply === null ? 'no_data' : statusLowerIsBetter(AvgReply, 7200),
      'ai_comms',
      'AVERAGE(время до ответа)',
      'sec',
    ),
    React: metric(
      'React',
      'Реактивация спящих клиентов',
      'Reactivation',
      React,
      '> 20%',
      React === null ? 'no_data' : statusHigherIsBetter(React, 20),
      'ai_comms',
      'Вернулись / Спящие × 100%',
      '%',
    ),
    NPS: metric(
      'NPS',
      'NPS-балл',
      'NPS score',
      NPS,
      '≥ 4.2/5 или ≥ 40',
      NPS === null
        ? 'no_data'
        : NPS >= 40
          ? 'good'
          : NPS >= 20
            ? 'warning'
            : 'critical',
      'ai_comms',
      'AVG(оценки) или (% 9-10) − (% 1-6)',
      null,
    ),
    NPSResp: metric(
      'NPSResp',
      '% ответивших на NPS',
      'NPS response rate',
      NPSResp,
      '> 40%',
      NPSResp === null ? 'no_data' : statusHigherIsBetter(NPSResp, 40),
      'ai_comms',
      'Ответы / Отправлено × 100%',
      '%',
    ),
    Ref: metric(
      'Ref',
      'Рефералы от довольных клиентов',
      'Referrals',
      Ref,
      '2–3 на VIP-клиента',
      statusCount(Ref),
      'ai_comms',
      'COUNT(реферальные новые)',
      'count',
    ),
  }
}

// ─── Public entrypoint ──────────────────────────────────────

/**
 * Build a fully-populated PointAV3 payload from the given inputs.
 * Pure / synchronous so it can be called from any layer (API,
 * tests, server actions). No I/O.
 */
export function aggregatePointAV3(input: AggregatorV3Input = {}): PointAV3 {
  const sales = buildSales(input)
  const client = buildClient(input, sales)
  const retention = buildRetention(input, sales)
  const finance = buildFinance(input, sales)
  const funnel = buildFunnel(input, sales, retention)
  const ai_comms = buildAiComms(input)
  const now = input.now ?? new Date()

  return {
    blocks: { sales, client, retention, finance, funnel, ai_comms },
    computed_at: now.toISOString(),
  }
}
