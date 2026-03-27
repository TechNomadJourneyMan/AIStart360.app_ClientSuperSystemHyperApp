// lib/point-a-engine.ts
// Point A Diagnostic Calculation Engine — Rule-based v1
// Weights: Finance 30% | Sales 25% | Operations 20% | Marketing 15% | Strategy 10%

import type {
  PointA, BlockScore, BlockStatus, DiagnosticStage,
  Risk, Insight, QuickWin, DataGap
} from '@/types/onboarding'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v))
}

function statusFromScore(score: number): BlockStatus {
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'strong'
  if (score >= 50) return 'average'
  if (score >= 30) return 'weak'
  return 'critical'
}

function stageFromScore(score: number): DiagnosticStage {
  if (score >= 80) return 'scale'
  if (score >= 65) return 'growth'
  if (score >= 45) return 'early'
  if (score >= 25) return 'seed'
  return 'seed'
}

// ─── Finance Block (weight 30%) ───────────────────────────────────────────────

function scoreFinance(a: Record<string, unknown>): BlockScore {
  let score = 0
  const issues: string[] = []
  const recs: string[] = []

  const rev23 = Number(a['s2_revenue_2023'] ?? 0)
  const rev24 = Number(a['s2_revenue_2024'] ?? 0)
  const rev25 = Number(a['s2_revenue_2025'] ?? 0)
  const margin = Number(a['s2_gross_margin'] ?? 0)
  const ltv = Number(a['s2_ltv'] ?? 0)
  const cac = Number(a['s2_cac'] ?? 1)
  const knowsBE = Boolean(a['s2_knows_breakeven'])
  const debt = String(a['s2_debt_load'] ?? 'none')

  // Revenue growth YoY
  if (rev24 > 0 && rev23 > 0) {
    const growth = ((rev24 - rev23) / rev23) * 100
    if (growth > 20) score += 20
    else if (growth > 0) score += 10
    else { issues.push('Выручка не растёт или падает'); recs.push('Проанализировать причины стагнации выручки') }
  } else {
    issues.push('Нет данных по выручке за 2023/2024')
    score -= 10
  }

  // Gross margin
  if (margin > 30) score += 15
  else if (margin > 15) score += 8
  else if (margin > 0) { score += 3; issues.push('Низкая маржинальность (<30%)') }
  else { issues.push('Маржинальность не указана или нулевая'); recs.push('Рассчитать маржинальность по каждому продукту') }

  // LTV/CAC
  if (cac > 0 && ltv > 0) {
    const ratio = ltv / cac
    if (ratio >= 3) score += 15
    else if (ratio >= 2) { score += 8; issues.push(`LTV/CAC = ${ratio.toFixed(1)} (норма ≥ 3)`) }
    else { issues.push(`LTV/CAC = ${ratio.toFixed(1)} — маркетинг убыточен`); recs.push('Снизить CAC или увеличить LTV через апсейл') }
  } else {
    issues.push('CAC или LTV не указаны')
    score -= 5
  }

  // Knows breakeven
  if (knowsBE) score += 10
  else { issues.push('Точка безубыточности неизвестна'); recs.push('Рассчитать точку безубыточности') }

  // Debt load
  if (debt === 'none') score += 10
  else if (debt === 'moderate') score += 5
  else { issues.push('Высокая долговая нагрузка'); recs.push('Разработать план снижения долговой нагрузки') }

  // Cash flow heuristic: if rev25 > rev24 → positive
  if (rev25 > 0 && rev24 > 0 && rev25 >= rev24) score += 15
  else if (rev25 > 0 && rev24 > 0) { issues.push('Снижение выручки в 2025') }

  const finalScore = clamp(score)
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    top_issues: issues.slice(0, 3),
    recommendations: recs.slice(0, 3),
  }
}

// ─── Sales Block (weight 25%) ─────────────────────────────────────────────────

function scoreSales(a: Record<string, unknown>): BlockScore {
  let score = 0
  const issues: string[] = []
  const recs: string[] = []

  const crm = String(a['s3_has_crm'] ?? 'none')
  const cycleDays = Number(a['s3_deal_cycle_days'] ?? 0)
  const deals24 = Number(a['s3_deals_2024'] ?? 0)
  const rejections24 = Number(a['s3_rejections_2024'] ?? 0)
  const repeatClients24 = Number(a['s2_repeat_clients_2024'] ?? 0)
  const newClients24 = Number(a['s2_new_clients_2024'] ?? 0)
  const hasLoyalty = Boolean(a['s3_has_loyalty'])

  // CRM
  if (crm !== 'none' && crm !== '') {
    score += 20
  } else {
    issues.push('CRM-система отсутствует — потери лидов ~30%')
    recs.push('Внедрить amoCRM или Bitrix24 (базовый тариф)')
  }

  // Deal cycle
  if (cycleDays > 0 && cycleDays < 30) score += 15
  else if (cycleDays <= 60) score += 8
  else if (cycleDays > 60) { issues.push(`Длинный цикл сделки: ${cycleDays} дней`); recs.push('Декомпозировать воронку, найти точки торможения') }

  // Repeat clients
  if (newClients24 + repeatClients24 > 0) {
    const repeatPct = (repeatClients24 / (newClients24 + repeatClients24)) * 100
    if (repeatPct >= 30) score += 15
    else { issues.push(`Повторных клиентов ${repeatPct.toFixed(0)}% (норма ≥30%)`); recs.push('Запустить программу лояльности') }
  }

  // Pipeline size
  if (deals24 > 50) score += 10
  else if (deals24 > 20) score += 5
  else if (deals24 > 0) { issues.push('Маленькая воронка продаж') }

  // Refusal rate
  if (deals24 > 0 && rejections24 >= 0) {
    const refusalPct = (rejections24 / (deals24 + rejections24)) * 100
    if (refusalPct < 20) score += 10
    else { issues.push(`Высокий процент отказов: ${refusalPct.toFixed(0)}%`); recs.push('Провести анализ причин отказов, переработать pitch') }
  }

  // Loyalty program
  if (hasLoyalty) score += 10
  else { recs.push('Запустить NPS-опрос и программу лояльности') }

  const finalScore = clamp(score)
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    top_issues: issues.slice(0, 3),
    recommendations: recs.slice(0, 3),
  }
}

// ─── Operations Block (weight 20%) ───────────────────────────────────────────

function scoreOperations(a: Record<string, unknown>): BlockScore {
  let score = 0
  const issues: string[] = []
  const recs: string[] = []

  const hasOrgChart = Boolean(a['s4_has_org_chart'])
  const hasDeptKPI = Boolean(a['s4_has_dept_kpi'])
  const hasMeetings = Boolean(a['s4_has_regular_meetings'])
  const reporting = String(a['s4_reporting_tool'] ?? 'none')
  const taskMgr = String(a['s4_task_manager'] ?? 'none')
  const mgmtMethod = String(a['s4_management_method'] ?? 'manual')

  if (hasOrgChart) score += 15
  else { issues.push('Оргструктура не задокументирована'); recs.push('Создать оргсхему компании (Miro, Notion)') }

  if (hasDeptKPI) score += 20
  else { issues.push('KPI по отделам не установлены'); recs.push('Ввести KPI для каждого отдела на квартал') }

  if (hasMeetings) score += 10
  else { issues.push('Нет регулярных планёрок'); recs.push('Установить еженедельные синхронизации с повесткой') }

  if (reporting === 'bi' || reporting === 'crm') score += 15
  else if (reporting === 'excel') { score += 5; issues.push('Отчётность в Excel — слепые зоны') }
  else { issues.push('Нет системы отчётности'); recs.push('Настроить еженедельный P&L-отчёт') }

  if (taskMgr !== 'none' && taskMgr !== '') score += 10
  else { issues.push('Таск-менеджер не используется'); recs.push('Внедрить Notion или Trello для задач') }

  if (mgmtMethod === 'manual') {
    issues.push('Ручное управление — высокий операционный риск')
    recs.push('Перейти на управление по KPI')
  } else {
    score += 10
  }

  const finalScore = clamp(score)
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    top_issues: issues.slice(0, 3),
    recommendations: recs.slice(0, 3),
  }
}

// ─── Marketing Block (weight 15%) ────────────────────────────────────────────

function scoreMarketing(a: Record<string, unknown>): BlockScore {
  let score = 0
  const issues: string[] = []
  const recs: string[] = []

  const budgetPct = Number(a['s5_marketing_budget_pct'] ?? 0)
  const channels = Array.isArray(a['s5_marketing_channels']) ? a['s5_marketing_channels'] : []
  const audience = String(a['s5_target_audience'] ?? '')
  const hasCompetitorAnalysis = Boolean(a['s5_has_competitor_analysis'])
  const usp = String(a['s5_usp'] ?? '')
  const hasLoyalty = Boolean(a['s3_has_loyalty'])

  if (budgetPct >= 5) score += 15
  else if (budgetPct > 0) { score += 7; issues.push(`Маркетинговый бюджет ${budgetPct}% выручки (норма ≥5%)`) }
  else { issues.push('Маркетинговый бюджет не определён'); recs.push('Выделить минимум 5% выручки на маркетинг') }

  if (channels.length >= 3) score += 15
  else if (channels.length >= 1) { score += 7; issues.push('Мало каналов маркетинга (< 3)') }
  else { issues.push('Каналы маркетинга не определены'); recs.push('Протестировать 3 канала привлечения (SEO, соцсети, партнёры)') }

  if (audience && audience.length > 20) score += 15
  else { issues.push('Целевая аудитория не описана'); recs.push('Составить ICP (идеальный портрет клиента)') }

  if (hasCompetitorAnalysis) score += 10
  else { issues.push('Конкурентный анализ не проводился'); recs.push('Провести анализ топ-3 конкурентов') }

  if (hasLoyalty) score += 10
  else { recs.push('Запустить реферальную программу') }

  if (usp && usp.length > 10) score += 5
  else { issues.push('УТП (уникальное торговое предложение) не сформулировано') }

  const finalScore = clamp(score)
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    top_issues: issues.slice(0, 3),
    recommendations: recs.slice(0, 3),
  }
}

// ─── Strategy Block (weight 10%) ─────────────────────────────────────────────

function scoreStrategy(a: Record<string, unknown>): BlockScore {
  let score = 0
  const issues: string[] = []
  const recs: string[] = []

  const goal3y = String(a['s6_goal_3years'] ?? '')
  const goal12m = String(a['s6_goal_12months'] ?? '')
  const pain = String(a['s6_main_pain'] ?? '')
  const blockers = Array.isArray(a['s6_growth_blockers']) ? a['s6_growth_blockers'] : []

  if (goal3y && goal3y.length > 20) score += 20
  else { issues.push('Нет чёткой цели на 3 года'); recs.push('Сформулировать цель на 3 года в формате SMART') }

  if (goal12m && goal12m.length > 20) score += 15
  else { issues.push('Нет цели на 12 месяцев'); recs.push('Декомпозировать 3-летнюю цель на годовую') }

  if (pain && pain.length > 10) score += 15
  else { issues.push('Ключевая проблема бизнеса не идентифицирована') }

  if (blockers.length > 0) score += 10
  else { issues.push('Барьеры роста не определены'); recs.push('Провести стратегическую сессию по барьерам') }

  const finalScore = clamp(score)
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    top_issues: issues.slice(0, 3),
    recommendations: recs.slice(0, 3),
  }
}

// ─── Risk Generator ───────────────────────────────────────────────────────────

function generateRisks(
  answers: Record<string, unknown>,
  blocks: PointA['blocks']
): Risk[] {
  const risks: Risk[] = []

  if (blocks.sales.score < 30 && String(answers['s3_has_crm'] ?? 'none') === 'none') {
    risks.push({ level: 'critical', area: 'Продажи', text: 'Нет CRM-системы — потери лидов ~30%', impact: 'Прямые потери выручки' })
  }
  if (blocks.finance.score < 40) {
    const ltv = Number(answers['s2_ltv'] ?? 0)
    const cac = Number(answers['s2_cac'] ?? 1)
    if (cac > 0 && ltv / cac < 3) {
      risks.push({ level: 'important', area: 'Финансы', text: `LTV/CAC = ${(ltv/cac).toFixed(1)} (норма > 3)`, impact: 'Маркетинг убыточен' })
    }
  }
  if (String(answers['s4_reporting_tool'] ?? 'none') === 'excel') {
    risks.push({ level: 'important', area: 'Операции', text: 'Отчётность в Excel — слепые зоны в данных', impact: 'Ошибки в управленческих решениях' })
  }
  if (blocks.operations.score < 30) {
    risks.push({ level: 'critical', area: 'Операции', text: 'Ручное управление — высокий операционный риск', impact: 'Масштабирование невозможно' })
  }
  if (blocks.marketing.score < 40) {
    risks.push({ level: 'important', area: 'Маркетинг', text: 'Маркетинговый бюджет ниже нормы или не определён', impact: 'Замедление роста клиентской базы' })
  }
  if (!Boolean(answers['s2_knows_breakeven'])) {
    risks.push({ level: 'moderate', area: 'Финансы', text: 'Точка безубыточности неизвестна', impact: 'Риск работы в убыток' })
  }

  return risks
}

// ─── Insight Generator ───────────────────────────────────────────────────────

function generateInsights(answers: Record<string, unknown>): Insight[] {
  const insights: Insight[] = []

  const flagship = String(answers['s3_flagship_product'] ?? '')
  if (flagship) {
    insights.push({ text: `Продукт-локомотив «${flagship}» требует защиты и масштабирования`, area: 'Продажи' })
  }

  const rej24 = Number(answers['s3_rejections_2024'] ?? 0)
  const rej23 = Number(answers['s3_rejections_2023'] ?? 0)
  if (rej24 > rej23 && rej23 > 0) {
    insights.push({ text: 'Отказы растут — нужен глубокий разбор воронки', area: 'Продажи' })
  }

  const newC24 = Number(answers['s2_new_clients_2024'] ?? 0)
  const repC24 = Number(answers['s2_repeat_clients_2024'] ?? 0)
  if (newC24 + repC24 > 0) {
    const repPct = Math.round((repC24 / (newC24 + repC24)) * 100)
    if (repPct < 20) {
      insights.push({ text: `Повторные клиенты ${repPct}% — программа лояльности критична`, area: 'Маркетинг' })
    }
  }

  const rev24 = Number(answers['s2_revenue_2024'] ?? 0)
  const rev23 = Number(answers['s2_revenue_2023'] ?? 0)
  if (rev23 > 0 && rev24 > rev23) {
    const g = Math.round(((rev24 - rev23) / rev23) * 100)
    insights.push({ text: `Выручка растёт на ${g}% г/г — фиксируйте драйверы роста`, area: 'Финансы' })
  }

  const channels = Array.isArray(answers['s5_marketing_channels']) ? answers['s5_marketing_channels'] : []
  if (channels.length === 1) {
    insights.push({ text: 'Единственный канал маркетинга — критическая зависимость', area: 'Маркетинг' })
  }

  return insights
}

// ─── Quick Wins Generator ─────────────────────────────────────────────────────

function generateQuickWins(answers: Record<string, unknown>, blocks: PointA['blocks']): QuickWin[] {
  const wins: QuickWin[] = []

  if (String(answers['s3_has_crm'] ?? 'none') === 'none') {
    wins.push({ action: 'Внедрить CRM (amoCRM базовый)', timeline: '2 недели', area: 'Продажи' })
  }
  if (!Boolean(answers['s2_knows_breakeven'])) {
    wins.push({ action: 'Рассчитать точку безубыточности', timeline: '1 день', area: 'Финансы' })
  }
  if (String(answers['s4_reporting_tool'] ?? 'none') !== 'bi') {
    wins.push({ action: 'Настроить еженедельный P&L-отчёт', timeline: '1 день', area: 'Финансы' })
  }
  if (!Boolean(answers['s3_has_loyalty'])) {
    wins.push({ action: 'Запустить NPS-опрос клиентской базы', timeline: '3 дня', area: 'Маркетинг' })
  }
  if (!Boolean(answers['s4_has_regular_meetings'])) {
    wins.push({ action: 'Ввести еженедельный командный синхрон (30 мин)', timeline: '1 неделя', area: 'Операции' })
  }
  if (blocks.marketing.score < 50 && !Boolean(answers['s5_has_competitor_analysis'])) {
    wins.push({ action: 'Провести анализ топ-3 конкурентов', timeline: '1 неделя', area: 'Маркетинг' })
  }

  return wins.slice(0, 5)
}

// ─── Data Gaps Detector ───────────────────────────────────────────────────────

function detectDataGaps(answers: Record<string, unknown>): DataGap[] {
  const gaps: DataGap[] = []
  const critical: Array<[string, number, string]> = [
    ['s2_revenue_2024', 2, 'Выручка за 2024 — основа финансового анализа'],
    ['s2_gross_margin', 2, 'Маржинальность — ключевой показатель здоровья'],
    ['s2_cac', 2, 'CAC — для расчёта эффективности маркетинга'],
    ['s2_ltv', 2, 'LTV — для расчёта LTV/CAC'],
    ['s3_has_crm', 3, 'Наличие CRM влияет на оценку продаж'],
    ['s6_goal_12months', 6, 'Цель на 12 месяцев — основа стратегического блока'],
  ]
  for (const [key, step, impact] of critical) {
    const val = answers[key]
    if (val === undefined || val === null || val === '' || val === 0) {
      gaps.push({ field: key, step, impact })
    }
  }
  return gaps
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function calculatePointA(answers: Record<string, unknown>): PointA {
  const finance    = scoreFinance(answers)
  const sales      = scoreSales(answers)
  const operations = scoreOperations(answers)
  const marketing  = scoreMarketing(answers)
  const strategy   = scoreStrategy(answers)

  const overall_score = clamp(
    finance.score    * 0.30 +
    sales.score      * 0.25 +
    operations.score * 0.20 +
    marketing.score  * 0.15 +
    strategy.score   * 0.10
  )

  const health_index = clamp(
    (overall_score * 0.6) +
    (finance.score > 50 ? 20 : 0) +
    (sales.score > 50 ? 10 : 0) +
    (operations.score > 50 ? 10 : 0)
  )

  const blocks = { finance, sales, operations, marketing, strategy }

  return {
    overall_score: Math.round(overall_score),
    health_index: Math.round(health_index),
    stage: stageFromScore(overall_score),
    blocks,
    risks: generateRisks(answers, blocks),
    insights: generateInsights(answers),
    quick_wins: generateQuickWins(answers, blocks),
    data_gaps: detectDataGaps(answers),
  }
}
