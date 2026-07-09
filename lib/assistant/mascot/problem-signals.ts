/**
 * lib/assistant/mascot/problem-signals.ts — session-scoped «проблемные» сигналы
 * для маскота «Гри» (Батч D). Дешёвые чтения ПОД СЕССИЕЙ пользователя: клиент
 * `sb` обязан быть createServerClient(), тогда RLS сам скоупит на свои строки
 * (не повторяем expert-no-scoping). Метрики и красная зона выводятся из уже
 * собранного снимка (context.ts) в самом route — здесь только CRM и пульс.
 *
 * Порог риска клиента СОВПАДАЕТ с KPI экрана /pulse (app/api/v1/crm/today):
 * тот же portfolioAvg + scoreClientRisk, churnLevel==='high' — чтобы «N в зоне
 * риска» в совете и на экране не расходились.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { scoreClientRisk } from '@/lib/crm/risk'

/**
 * Monday (UTC) of the week containing `now`, YYYY-MM-DD. Копия формулы писателя
 * пульса (app/api/v1/gri/pulse/route.ts:mondayOfWeekUTC), чтобы сверка недели не
 * расходилась и не давала ложный «пульс не снят».
 */
function mondayOfWeekUTC(now: number): string {
  const src = new Date(now)
  const d = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()))
  const dow = d.getUTCDay() // 0..6, Sun=0
  const diff = dow === 0 ? 6 : dow - 1 // days since Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

export interface CrmProblemSignals {
  /** Число РАЗЛИЧНЫХ клиентов в зоне риска: churn=high ИЛИ есть просроченное
   *  открытое напоминание (объединение множеств, без двойного счёта). */
  clientsAtRisk: number
}

interface ClientRiskRow {
  id: string
  status: string | null
  avg_check: number | null
  last_contact_at: string | null
}

/**
 * Счётчик клиентов «в зоне риска» для совета clients_at_risk. Никогда не бросает:
 * при любой ошибке чтения возвращает 0 (совет просто не покажется, /context не
 * падает — эндпоинт поллится на каждой навигации и обязан оставаться дешёвым).
 */
export async function readCrmProblemSignals(
  sb: SupabaseClient,
  userId: string,
  now: number,
): Promise<CrmProblemSignals> {
  try {
    const nowIso = new Date(now).toISOString()

    // Клиенты с просроченным открытым напоминанием (только client_id).
    const { data: remRows } = await sb
      .from('crm_reminders')
      .select('client_id')
      .eq('user_id', userId)
      .eq('status', 'open')
      .lt('due_at', nowIso)
    const atRisk = new Set<string>()
    for (const r of remRows ?? []) {
      const id = (r as { client_id?: unknown }).client_id
      if (typeof id === 'string') atRisk.add(id)
    }

    // Клиенты высокого риска — та же формула, что KPI /pulse.
    const { data: clientRows } = await sb
      .from('crm_clients')
      .select('id, status, avg_check, last_contact_at')
      .eq('user_id', userId)
      .limit(500)
    const clients = (clientRows ?? []) as ClientRiskRow[]
    const withCheck = clients.filter(
      (c) => typeof c.avg_check === 'number' && (c.avg_check ?? 0) > 0,
    )
    const portfolioAvg = withCheck.length
      ? withCheck.reduce((s, c) => s + (c.avg_check ?? 0), 0) / withCheck.length
      : 0
    for (const c of clients) {
      const r = scoreClientRisk(
        { lastContactAt: c.last_contact_at, avgCheck: c.avg_check, status: c.status, now },
        portfolioAvg,
      )
      if (r.churnLevel === 'high') atRisk.add(c.id)
    }

    return { clientsAtRisk: atRisk.size }
  } catch {
    return { clientsAtRisk: 0 }
  }
}

/**
 * true, когда сейчас чт–вс (UTC), недельный пульс ещё не снят и есть GRI-базлайн
 * (пульс — еженедельная пере-оценка GRI; без базового замера смысла нет).
 * Никогда не бросает.
 */
export async function readPulseMissed(
  sb: SupabaseClient,
  userId: string,
  now: number,
  hasGriBaseline: boolean,
): Promise<boolean> {
  if (!hasGriBaseline) return false
  const dow = new Date(now).getUTCDay() // 0=Sun..6=Sat
  const isThuToSun = dow === 0 || dow >= 4 // Чт(4) Пт(5) Сб(6) Вс(0)
  if (!isThuToSun) return false
  try {
    const monday = mondayOfWeekUTC(now)
    const { count } = await sb
      .from('gri_pulse_responses')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('week_start', monday)
    return (count ?? 0) === 0
  } catch {
    return false
  }
}
