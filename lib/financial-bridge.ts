/**
 * financial-bridge.ts
 *
 * Reads ai_extractions rows (entity_type LIKE 'metric.%' from document sources)
 * and aggregates them into block_scores compatible with the diagnostics table.
 * Used when generic (non-medical) clients upload P&L / CRM / marketing reports
 * so the /dashboard + /point-a Точка А blocks reflect file-derived data,
 * without forcing the user to fill the survey manually.
 *
 * Scale: each block_score is 0-100 (matching survey-based calculatePointA).
 */

export type BlockId = 'finance' | 'sales' | 'marketing' | 'operations' | 'strategy'

export interface ExtractionRow {
  entity_type: string
  value: number | null
  unit: string | null
  period_year: number | null
  period_quarter: string | null
  source_type: string | null
  source_doc_id: string | null
  extractor_name: string | null
  extracted_at: string | null
  confidence: number | null
}

export interface BlockScore {
  score: number
  status: 'critical' | 'weak' | 'developing' | 'strong'
  top_issues: string[]
  recommendations: string[]
  evidence_count: number
}

export interface BridgeResult {
  blocks: Record<BlockId, BlockScore>
  overall_score: number
  health_index: number
  stage: 'seed' | 'growth' | 'scale' | 'mature'
  data_gaps: string[]
  insights: string[]
  source: 'files'
  evidence_total: number
}

// ── Metric → Block mapping ──
const METRIC_TO_BLOCK: Record<string, BlockId> = {
  // Finance
  'metric.revenue':         'finance',
  'metric.gross_revenue':   'finance',
  'metric.gross_profit':    'finance',
  'metric.gross_margin':    'finance',
  'metric.net_profit':      'finance',
  'metric.net_margin':      'finance',
  'metric.ebitda':          'finance',
  'metric.cogs':            'finance',
  'metric.opex':            'finance',
  // Sales
  'metric.sales_count':     'sales',
  'metric.avg_check':       'sales',
  'metric.aov':             'sales',
  'metric.new_customers':   'sales',
  'metric.repeat_customers': 'sales',
  // Marketing
  'metric.cac':             'marketing',
  'metric.cpl':             'marketing',
  'metric.ltv_cac':         'marketing',
  'metric.romi':            'marketing',
  'metric.marketing_spend': 'marketing',
  'metric.leads':           'marketing',
  // Operations
  'metric.no_show':         'operations',
  'metric.on_time':         'operations',
  'metric.defect_rate':     'operations',
  'metric.processing_time': 'operations',
  // Strategy / customer base health
  'metric.total_customers': 'strategy',
  'metric.retention_rate':  'strategy',
  'metric.churn_rate':      'strategy',
}

// ── Per-metric scoring rules (value → 0-100) ──
// Direction: 'up' means higher is better; 'down' means lower is better.
interface ScoringRule {
  direction: 'up' | 'down'
  // value mapped to score: e.g. for gross_margin (up) — 40%+ = 100, 0% = 0
  good: number   // value at which score = 100
  bad: number    // value at which score = 0
}

const SCORING: Record<string, ScoringRule> = {
  'metric.revenue':         { direction: 'up',   good: 100_000_000, bad: 0 },
  'metric.gross_margin':    { direction: 'up',   good: 50, bad: 0 },
  'metric.net_margin':      { direction: 'up',   good: 20, bad: -10 },
  'metric.ebitda':          { direction: 'up',   good: 30_000_000, bad: -5_000_000 },
  'metric.no_show':         { direction: 'down', good: 5, bad: 30 },
  'metric.defect_rate':     { direction: 'down', good: 0.5, bad: 5 },
  'metric.churn_rate':      { direction: 'down', good: 5, bad: 40 },
  'metric.retention_rate':  { direction: 'up',   good: 80, bad: 20 },
  'metric.cac':             { direction: 'down', good: 5_000, bad: 50_000 },
  'metric.ltv_cac':         { direction: 'up',   good: 5, bad: 1 },
  'metric.romi':            { direction: 'up',   good: 300, bad: 0 },
  'metric.avg_check':       { direction: 'up',   good: 30_000, bad: 5_000 },
  'metric.aov':             { direction: 'up',   good: 30_000, bad: 5_000 },
  'metric.repeat_customers': { direction: 'up', good: 50, bad: 10 },
  'metric.new_customers':   { direction: 'up',   good: 500, bad: 0 },
  'metric.total_customers': { direction: 'up',   good: 5000, bad: 100 },
}

function scoreMetric(entity_type: string, value: number): number {
  const rule = SCORING[entity_type]
  if (!rule) return 50 // unknown metric — neutral
  const { direction, good, bad } = rule
  if (direction === 'up') {
    if (value >= good) return 100
    if (value <= bad) return 0
    return Math.round(((value - bad) / (good - bad)) * 100)
  } else {
    if (value <= good) return 100
    if (value >= bad) return 0
    return Math.round(((bad - value) / (bad - good)) * 100)
  }
}

function classifyStatus(score: number): BlockScore['status'] {
  if (score < 30) return 'critical'
  if (score < 50) return 'weak'
  if (score < 75) return 'developing'
  return 'strong'
}

const ISSUE_BY_METRIC: Record<string, string> = {
  'metric.gross_margin':   'Низкая валовая маржа',
  'metric.net_margin':     'Низкая чистая маржа',
  'metric.ebitda':         'Слабая операционная прибыль',
  'metric.no_show':        'Высокий процент неявок',
  'metric.churn_rate':     'Высокий churn клиентской базы',
  'metric.cac':            'Слишком дорогое привлечение',
  'metric.ltv_cac':        'LTV/CAC ниже 3х — модель не окупается',
  'metric.romi':           'ROMI ниже 100% — маркетинг убыточен',
  'metric.avg_check':      'Низкий средний чек',
  'metric.retention_rate': 'Слабое удержание клиентов',
  'metric.defect_rate':    'Высокий уровень брака',
}

const RECO_BY_METRIC: Record<string, string> = {
  'metric.gross_margin':   'Пересмотреть цены / снизить COGS',
  'metric.net_margin':     'Сократить OPEX или вырастить выручку',
  'metric.ebitda':         'Оптимизировать переменные расходы',
  'metric.no_show':        'Запустить WhatsApp подтверждения за 24ч',
  'metric.churn_rate':     'Внедрить reactivation кампании для спящих',
  'metric.cac':            'Увеличить долю органики и referral',
  'metric.ltv_cac':        'Поднять LTV (cross-sell) или снизить CAC',
  'metric.romi':           'Перераспределить бюджет на лучшие каналы',
  'metric.avg_check':      'Upsell / bundles для повышения чека',
  'metric.retention_rate': 'Loyalty программа + регулярные касания',
  'metric.defect_rate':    'Аудит процессов и QC checkpoint',
}

/**
 * Main mapper: takes ai_extractions rows → block scores.
 * Picks the latest non-superseded extraction per (entity_type, period).
 */
export function bridgeFinancialExtractions(extractions: ExtractionRow[]): BridgeResult {
  // Pick latest per entity_type (sort by extracted_at desc, take first)
  const latestByType = new Map<string, ExtractionRow>()
  const sorted = [...extractions].sort((a, b) => {
    const ta = a.extracted_at ? Date.parse(a.extracted_at) : 0
    const tb = b.extracted_at ? Date.parse(b.extracted_at) : 0
    return tb - ta
  })
  for (const e of sorted) {
    if (!e.entity_type.startsWith('metric.')) continue
    if (typeof e.value !== 'number' || isNaN(e.value)) continue
    if (latestByType.has(e.entity_type)) continue
    latestByType.set(e.entity_type, e)
  }

  // Group scores per block
  const blockScores: Record<BlockId, { sum: number; count: number; issues: string[]; recos: string[] }> = {
    finance:    { sum: 0, count: 0, issues: [], recos: [] },
    sales:      { sum: 0, count: 0, issues: [], recos: [] },
    marketing:  { sum: 0, count: 0, issues: [], recos: [] },
    operations: { sum: 0, count: 0, issues: [], recos: [] },
    strategy:   { sum: 0, count: 0, issues: [], recos: [] },
  }

  for (const [entity_type, row] of latestByType) {
    const block = METRIC_TO_BLOCK[entity_type]
    if (!block) continue
    const s = scoreMetric(entity_type, row.value as number)
    blockScores[block].sum += s
    blockScores[block].count += 1
    if (s < 50) {
      const iss = ISSUE_BY_METRIC[entity_type]
      const rec = RECO_BY_METRIC[entity_type]
      if (iss) blockScores[block].issues.push(iss)
      if (rec) blockScores[block].recos.push(rec)
    }
  }

  const blocks: Record<BlockId, BlockScore> = {} as Record<BlockId, BlockScore>
  let totalScore = 0
  let totalEvidence = 0
  const gaps: string[] = []

  for (const block of ['finance', 'sales', 'marketing', 'operations', 'strategy'] as BlockId[]) {
    const b = blockScores[block]
    const avg = b.count > 0 ? Math.round(b.sum / b.count) : 0
    if (b.count === 0) gaps.push(`Нет данных по блоку «${blockLabel(block)}»`)
    blocks[block] = {
      score: avg,
      status: classifyStatus(avg),
      top_issues: b.issues.slice(0, 3),
      recommendations: b.recos.slice(0, 3),
      evidence_count: b.count,
    }
    totalScore += avg
    totalEvidence += b.count
  }

  const overall = Math.round(totalScore / 5)
  const health = Math.max(0, Math.min(100, overall + Math.min(10, totalEvidence)))
  let stage: BridgeResult['stage'] = 'seed'
  if (overall >= 75) stage = 'mature'
  else if (overall >= 55) stage = 'scale'
  else if (overall >= 35) stage = 'growth'

  const insights: string[] = []
  if (totalEvidence === 0) insights.push('Загрузите P&L / CRM / маркетинговые отчёты — диагностика будет автоматической')
  else insights.push(`Точка А посчитана по ${totalEvidence} метрикам из загруженных файлов`)

  return {
    blocks,
    overall_score: overall,
    health_index: health,
    stage,
    data_gaps: gaps,
    insights,
    source: 'files',
    evidence_total: totalEvidence,
  }
}

function blockLabel(b: BlockId): string {
  return ({
    finance: 'Финансы',
    sales: 'Продажи',
    marketing: 'Маркетинг',
    operations: 'Операции',
    strategy: 'Стратегия',
  } as const)[b]
}
