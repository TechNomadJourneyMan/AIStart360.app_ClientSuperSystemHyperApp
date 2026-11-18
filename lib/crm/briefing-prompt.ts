/**
 * lib/crm/briefing-prompt.ts — the prompt of the «Рекомендация на сегодня» briefing over the owner's
 * own CRM queue (POST /api/pulse/briefing). Built from the SAME payload as the screen
 * (lib/crm/today.ts loadCrmToday), so the AI talks about exactly the clients the owner sees.
 *
 * Client names and notes are the owner's free text → fenced (fenceUntrusted). Money only where it
 * is known: a client without a check has no amount, and the sum at risk is said to be unknown
 * rather than computed over the checks that happen to be filled.
 */
import { fenceUntrusted } from '@/lib/ai/gateway'
import type { CrmTodayPayload } from './today'

/** How many queue clients the briefing is about. */
export const BRIEFING_TOP = 5
const NOTE_MAX = 200

const BUCKET_REASON: Record<number, string> = {
  0: 'запланированный контакт просрочен',
  1: 'контакт запланирован на сегодня',
  2: 'нет плана следующего контакта',
  3: 'спящий: нет касаний больше 30 дней',
}

function money(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ₸`
}

/** The prompt, or null when there is nothing to brief on (empty base or empty queue). */
export function crmBriefingPrompt(p: CrmTodayPayload): string | null {
  if (p.stats.totalClients === 0 || p.todayClients.length === 0) return null

  const rows = p.todayClients.slice(0, BRIEFING_TOP).map((c, i) => {
    const parts = [
      `${i + 1}. ${c.name.replace(/\s+/g, ' ').trim()}`,
      `статус: ${c.statusLabel}`,
      `почему в очереди: ${c.queueBucket != null ? BUCKET_REASON[c.queueBucket] : '—'}`,
      c.daysSince == null ? 'касаний ещё не было' : `последнее касание ${c.daysSince} дн. назад`,
      `риск ${c.riskScore}/100`,
    ]
    if (c.avgCheck != null) parts.push(`средний чек ${money(c.avgCheck)}`)
    const note = (c.note ?? '').replace(/\s+/g, ' ').trim()
    if (note) parts.push(`заметка владельца: ${note.slice(0, NOTE_MAX)}`)
    return parts.join('; ')
  })

  const s = p.stats
  const atRisk =
    s.revenueAtRisk == null
      ? `неизвестна (средний чек не указан у ${s.highRiskWithoutCheck} из ${s.highRisk} клиентов высокого риска)`
      : money(s.revenueAtRisk)

  return `Ты бизнес-ассистент в системе AIStart360. Дай владельцу бизнеса краткую рекомендацию на сегодня на русском языке (3-4 предложения).

База клиентов владельца на ${p.day}:
- Всего клиентов: ${s.totalClients}
- В очереди «Кому звонить сегодня»: ${p.todayClients.length} (просрочено: ${s.queue.overdue}, на сегодня: ${s.queue.today}, без плана: ${s.queue.noPlan}, спящих: ${s.queue.sleeping})
- Уже обработано сегодня: ${s.processedToday}
- Высокий риск: ${s.highRisk}, средний риск: ${s.mediumRisk}
- Сумма средних чеков клиентов высокого риска: ${atRisk}

Первые в очереди (данные владельца):
${fenceUntrusted('crm_clients', rows.join('\n'))}

Скажи конкретно: с кем связаться в первую очередь и почему. Называй клиентов по именам из списка. Опирайся только на эти данные: не придумывай суммы, заказы, даты и проценты, которых в них нет. Формат: 3-4 предложения, без заголовков и списков.`
}
