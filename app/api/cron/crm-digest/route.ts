import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { createNotification } from '@/lib/notifications/create'

export const dynamic = 'force-dynamic'
// Дайджест шлёт по одному уведомлению на пользователя; на большой базе даём
// функции больше времени, чем дефолтные 15 c hobby-плана.
export const maxDuration = 60

/**
 * GET /api/cron/crm-digest — утренний CRM-дайджест.
 *
 * Раз в сутки собирает по каждому владельцу CRM:
 *   • просроченные / сегодняшние открытые напоминания (crm_reminders);
 *   • «спящих» клиентов без контакта > 30 дней (crm_clients).
 * И кладёт ОДНО суммарное in-app уведомление в app_notifications
 * (колокольчик уже поллит эту таблицу). Внешние каналы — Фаза 4.
 *
 * Auth: Vercel Cron присылает `Authorization: Bearer ${CRON_SECRET}`.
 * Для ручного теста также принимается `?secret=` с тем же значением.
 */

const MAX_USERS = 5000
const SLEEP_DAYS = 30
const QUERY_LIMIT = 50000

type ReminderRow = { user_id: string }
type ClientRow = { user_id: string }
type PrefsRow = { id: string; preferences: unknown }

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const authorized =
    authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()

    const now = new Date()
    // Конец сегодняшнего дня (UTC) — просроченные + сегодняшние напоминания.
    const endOfToday = new Date(now)
    endOfToday.setUTCHours(23, 59, 59, 999)
    const sleepCutoff = new Date(now.getTime() - SLEEP_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // 1) Все открытые просроченные / сегодняшние напоминания (один запрос).
    const { data: reminders, error: remErr } = await supabase
      .from('crm_reminders')
      .select('user_id')
      .eq('status', 'open')
      .lte('due_at', endOfToday.toISOString())
      .limit(QUERY_LIMIT)
    if (remErr) throw remErr

    // 2) «Спящие» клиенты — фильтр на стороне БД: контакт раньше отсечки, либо
    //    ни разу не контактировали, но заведены раньше отсечки.
    const { data: sleeping, error: sleepErr } = await supabase
      .from('crm_clients')
      .select('user_id')
      .in('status', ['customer', 'sleeping'])
      .or(`last_contact_at.lt.${sleepCutoff},and(last_contact_at.is.null,created_at.lt.${sleepCutoff})`)
      .limit(QUERY_LIMIT)
    if (sleepErr) throw sleepErr

    if ((reminders?.length ?? 0) >= QUERY_LIMIT || (sleeping?.length ?? 0) >= QUERY_LIMIT) {
      console.warn('[crm-digest] query limit hit — some rows may be truncated')
    }

    // Группировка в JS.
    const overdueByUser = new Map<string, number>()
    for (const r of (reminders ?? []) as ReminderRow[]) {
      if (!r.user_id) continue
      overdueByUser.set(r.user_id, (overdueByUser.get(r.user_id) ?? 0) + 1)
    }

    const sleepingByUser = new Map<string, number>()
    for (const c of (sleeping ?? []) as ClientRow[]) {
      if (!c.user_id) continue
      sleepingByUser.set(c.user_id, (sleepingByUser.get(c.user_id) ?? 0) + 1)
    }

    // Объединяем множество затронутых пользователей.
    const allUserIds = Array.from(new Set([...overdueByUser.keys(), ...sleepingByUser.keys()]))
    if (allUserIds.length > MAX_USERS) {
      console.warn(`[crm-digest] ${allUserIds.length} users affected, capping at ${MAX_USERS}`)
    }
    const userIds = allUserIds.slice(0, MAX_USERS)

    if (userIds.length === 0) {
      return NextResponse.json({ ok: true, data: { usersNotified: 0, totalOverdue: 0, totalSleeping: 0 } })
    }

    // Батч-чтение предпочтений уведомлений для затронутых пользователей.
    const optedOut = new Set<string>()
    const { data: prefsRows, error: prefsErr } = await supabase
      .from('profiles')
      .select('id, preferences')
      .in('id', userIds)
    if (prefsErr) throw prefsErr
    for (const p of (prefsRows ?? []) as PrefsRow[]) {
      const prefs = p.preferences as { notifications?: { crm?: { in_app?: boolean } } } | null
      if (prefs?.notifications?.crm?.in_app === false) {
        optedOut.add(p.id)
      }
    }

    let usersNotified = 0
    let totalOverdue = 0
    let totalSleeping = 0

    // Кому реально шлём (после opt-out и нулевых).
    const targets = userIds.filter((userId) => {
      if (optedOut.has(userId)) return false
      return (overdueByUser.get(userId) ?? 0) > 0 || (sleepingByUser.get(userId) ?? 0) > 0
    })

    // Рассылаем параллельно чанками — не по одному await, но и не 5000 разом.
    const CONCURRENCY = 25
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const chunk = targets.slice(i, i + CONCURRENCY)
      await Promise.all(
        chunk.map(async (userId) => {
          const overdue = overdueByUser.get(userId) ?? 0
          const sleep = sleepingByUser.get(userId) ?? 0
          const total = overdue + sleep
          const title = `📞 CRM: ${total} ${plural(total, 'клиент ждёт', 'клиента ждут', 'клиентов ждут')} внимания`

          const parts: string[] = []
          if (overdue > 0) parts.push(`Просроченных напоминаний: ${overdue}`)
          if (sleep > 0) parts.push(`Спящих клиентов: ${sleep}`)
          const body = `${parts.join(' · ')}. Откройте раздел «Клиенты».`

          // createNotification — best-effort, не бросает; счётчики точны.
          await createNotification({
            userId,
            title,
            body,
            category: 'crm',
            priority: 'medium',
            link: '/pulse',
            metadata: { overdue, sleeping: sleep },
          })

          usersNotified += 1
          totalOverdue += overdue
          totalSleeping += sleep
        }),
      )
    }

    return NextResponse.json({ ok: true, data: { usersNotified, totalOverdue, totalSleeping } })
  } catch (err) {
    console.error('[crm-digest] sweep failed', err)
    return NextResponse.json({ ok: false, error: 'crm-digest sweep failed' }, { status: 500 })
  }
}

// Русская форма множественного числа (1 / 2-4 / 5+).
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
