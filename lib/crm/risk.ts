// lib/crm/risk.ts — детерминированный риск-скоринг клиента CRM.
// Перенос формулы из app/api/pulse/route.ts: staleness от last_contact_at +
// отклонение avg_check от портфельного среднего → riskScore/churnLevel/action.
// Чистая функция (никаких Math.random / сети): один вход → один выход.

export type ChurnLevel = 'high' | 'medium' | 'low'
export type RiskAction = 'call' | 'message' | 'monitor'

export interface RiskInput {
  /** ISO дата последнего касания или null (ни разу). */
  lastContactAt: string | null
  /** Средний чек / сумма сделки или null. */
  avgCheck: number | null
  /** Статус клиента (влияет на модификаторы). */
  status?: string | null
  /** Для тестируемости — «сейчас» в мс. По умолчанию Date.now(). */
  now?: number
}

export interface RiskResult {
  daysSince: number | null
  riskScore: number // 0..100
  churnProb: number // 0..100 (детерминированно = riskScore)
  churnLevel: ChurnLevel
  action: RiskAction
  comment: string | null
  volumeChange: number // % отклонения avg_check от портфельного среднего
  history: number[] // спарклайн (5 точек) к текущему health
}

const DAY_MS = 86_400_000

/**
 * @param portfolioAvgCheck средний чек по портфелю (для расчёта отклонения).
 */
export function scoreClientRisk(input: RiskInput, portfolioAvgCheck = 0): RiskResult {
  const now = input.now ?? Date.now()
  const status = input.status ?? null
  const avgCheck =
    typeof input.avgCheck === 'number' && Number.isFinite(input.avgCheck) ? input.avgCheck : null

  const lastMs = input.lastContactAt ? new Date(input.lastContactAt).getTime() : null
  const daysSince =
    lastMs != null && !Number.isNaN(lastMs)
      ? Math.max(0, Math.floor((now - lastMs) / DAY_MS))
      : null

  // ── riskScore ──
  let riskScore: number
  if (status === 'lost') {
    riskScore = 95
  } else {
    // Staleness — основной драйвер (0д→0, 28д→70).
    riskScore = daysSince == null ? 50 : Math.min(70, Math.round(daysSince * 2.5))
    // Отклонение среднего чека.
    if (portfolioAvgCheck > 0 && avgCheck != null && avgCheck > 0) {
      if (avgCheck < portfolioAvgCheck * 0.5) riskScore += 10
      else if (avgCheck > portfolioAvgCheck * 2) riskScore -= 5
    }
    // Статус-модификаторы.
    if (status === 'sleeping') riskScore += 15
    else if (status === 'customer') riskScore -= 10
  }
  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)))

  const health = 100 - riskScore
  const churnLevel: ChurnLevel = health < 40 ? 'high' : health < 60 ? 'medium' : 'low'
  const churnProb = riskScore

  // ── action ──
  let action: RiskAction = 'monitor'
  if (status === 'lost' || daysSince == null || (daysSince != null && daysSince > 7)) {
    action = 'call'
  } else if (riskScore > 60) {
    action = 'call'
  } else if (riskScore > 35) {
    action = 'message'
  }

  // ── volumeChange ──
  const volumeChange =
    portfolioAvgCheck > 0 && avgCheck != null
      ? Math.round(((avgCheck - portfolioAvgCheck) / portfolioAvgCheck) * 100)
      : 0

  // ── comment ──
  let comment: string | null = null
  if (status === 'lost') comment = 'Клиент потерян — вернуть'
  else if (daysSince == null) comment = 'Нет ни одного касания'
  else if (daysSince > 30) comment = `Нет контакта ${daysSince} дней`
  else if (daysSince > 7) comment = 'Давно без движения'
  else if (avgCheck != null && portfolioAvgCheck > 0 && avgCheck > portfolioAvgCheck * 2)
    comment = 'Крупный клиент — приоритет'

  // ── history (детерминированный спарклайн к текущему health) ──
  const history = [
    Math.round(health * 0.6),
    Math.round(health * 0.7),
    Math.round(health * 0.8),
    Math.round(health * 0.9),
    health,
  ]

  return { daysSince, riskScore, churnProb, churnLevel, action, comment, volumeChange, history }
}
