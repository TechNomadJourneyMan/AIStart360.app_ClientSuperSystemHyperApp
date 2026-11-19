import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { createNotification } from '@/lib/notifications/create'
import { notifyClient } from '@/lib/notifications/notify'
import { sendUserEmail } from '@/lib/email'
import { sendTelegramMessage } from '@/lib/telegram'
import {
  selectChannels,
  pickWeakestBlock,
  buildDigestTitle,
  buildDigestBody,
  buildTelegramDigest,
  type DigestData,
} from '@/lib/crm/digest'
import { EXTRA_DIGEST_CHANNELS } from '@/lib/crm/digest-channels'
import { almatyDay, PAGE_SIZE, queueCountsByUser, readAllById, type QueueClientInput } from '@/lib/crm/today'
import { beforeDeadline, dayRotation, runBounded } from '@/lib/crm/bounded-run'
import { DIGEST_CONCURRENCY, DIGEST_MIN_START_MS, DIGEST_RUN_MS } from '@/lib/crm/digest'
import { optedInRecipients } from '@/lib/whatsapp/links'
import { cloudApiConfigured } from '@/lib/whatsapp/config'
import { maintenanceSkipReason } from '@/lib/automation/maintenance-gate'

export const dynamic = 'force-dynamic'
// Дайджест шлёт до трёх каналов на пользователя; на большой базе даём функции
// больше времени, чем дефолтные 15 c hobby-плана.
export const maxDuration = 60

/**
 * GET /api/cron/crm-digest — утренний CRM-дайджест (Фаза 2 + мультиканал Фазы 4A).
 *
 * Раз в сутки собирает по каждому владельцу CRM — по тем же правилам очереди «Кому звонить
 * сегодня» (lib/crm/today.ts), для текущего дня по Алматы:
 *   • клиентов с просроченным запланированным контактом (напоминание / next_contact_at до сегодня);
 *   • клиентов с контактом, запланированным на сегодня (это не «просрочено»);
 *   • «спящих» клиентов без контакта > 30 дней (crm_clients);
 *   • слабый блок текущей GRI-диагностики (довесок №9).
 * И доставляет по каналам из preferences.notifications.crm: in-app (колокольчик),
 * email (Resend) и Telegram (если чат привязан). Каждый канал — best-effort.
 *
 * Auth: Vercel Cron присылает `Authorization: Bearer ${CRON_SECRET}`.
 * Секрет принимается только в заголовке (не в `?secret=` — он попадает в логи).
 */

const MAX_USERS = 5000
const QUERY_LIMIT = 50000
/** `.in()` lists are sent in the URL: keep them short. */
const IN_CHUNK = 200

type QueueClientRow = QueueClientInput & { id: string; user_id: string }
type ReminderRow = { id: string; client_id: string; due_at: string }
type ProfileRow = {
  id: string
  email?: string | null
  telegram_chat_id?: string | null
  preferences?: unknown
}

/**
 * Re-scan через 90 дней (Фаза 5, №10): владельцам, чья текущая GRI-диагностика
 * создана 90–96 дней назад, — «пора пересчитать GRI» через notifyClient
 * (категория «gri»: лента + письмо по настройкам клиента). Это автоматическое
 * касание: действует выключатель auto_reminders_enabled и недельный потолок.
 * Окно в неделю + ключ gri_rescan:<user>:<дата оценки> — напоминание уйдёт
 * один раз, даже если в день «90» клиент упёрся в потолок. Best-effort: любая
 * ошибка — console.warn, дайджест не роняем.
 */
async function sendGriRescanReminders(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
  deadlineAt: number,
): Promise<{ sent: number; deferred: number }> {
  let sent = 0
  let deferred = 0
  try {
    const DAY_MS = 24 * 60 * 60 * 1000
    const from = new Date(now.getTime() - 97 * DAY_MS).toISOString()
    const to = new Date(now.getTime() - 90 * DAY_MS).toISOString()

    const { data: rows, error } = await supabase
      .from('gri_assessments')
      .select('user_id, created_at')
      .eq('is_current', true)
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(QUERY_LIMIT)
    if (error) throw error

    const byUser = new Map<string, string>()
    for (const r of (rows ?? []) as Array<{ user_id: string; created_at: string }>) {
      if (r.user_id && !byUser.has(r.user_id)) byUser.set(r.user_id, String(r.created_at).slice(0, 10))
    }
    const users = Array.from(byUser.entries())

    // ≤ 2 at a time and within the run's budget; what is left goes out on a later day of the
    // week-long window (the dedupe key makes a repeat a no-op).
    const run = await runBounded(
      users,
      { concurrency: DIGEST_CONCURRENCY, deadlineAt, minStartMs: DIGEST_MIN_START_MS },
      async ([userId, assessedOn]) => {
        const r = await beforeDeadline(() => notifyClient(
          {
            userId,
            category: 'gri',
            event: 'gri_rescan',
            title: '⏳ Пора пересчитать GRI',
            body: 'Вашей диагностике 90 дней — бизнес изменился. Пересчитайте индекс и сравните динамику.',
            ctaUrl: '/gri?tab=assess',
            ctaLabel: 'Пересчитать GRI',
            priority: 'low',
            eyebrow: 'GRI',
            dedupeKey: `gri_rescan:${userId}:${assessedOn}`,
            automated: { kind: 'gri_rescan' },
          },
          now,
        ), deadlineAt)
        if (r.ok && r.value.ok && !r.value.skipped) sent += 1
      },
    )
    deferred = run.deferred
  } catch (e) {
    console.warn('[crm-digest] GRI re-scan reminders skipped', e)
  }
  return { sent, deferred }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  // Header only, constant-time (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
  if (!isAuthorizedCron(req).ok) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // N5-3 (the class of R-026): no digest into a cabinet that is closed for maintenance — nothing is
    // read or sent; the next morning's run sends what is still due (the GRI re-scan has a week-long window).
    const skip = await maintenanceSkipReason('crm-digest')
    if (skip) {
      return NextResponse.json({
        ok: true,
        data: { skippedReason: skip, usersNotified: 0, emailsSent: 0, telegramSent: 0, whatsappSent: 0, deferred: 0, rescanReminders: 0 },
      })
    }

    const supabase = createServiceClient()
    const base = process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || ''

    const now = new Date()
    const deadlineAt = now.getTime() + DIGEST_RUN_MS

    // 1–2) Every client and every open reminder (page by page, no silent cut), then the SAME queue
    // rule as «Кому звонить сегодня» (lib/crm/today.ts): overdue / due today / sleeping are the
    // queue's buckets for today's Almaty day — a reminder due later today is «на сегодня», never
    // «просрочено», and the sleeping count is the queue's.
    const clients = await readAllById<QueueClientRow>((after) => {
      let q = supabase.from('crm_clients').select('id, user_id, status, next_contact_at, last_contact_at, created_at')
      if (after) q = q.gt('id', after)
      return q.order('id', { ascending: true }).limit(PAGE_SIZE) as unknown as PromiseLike<{ data: QueueClientRow[] | null; error: unknown }>
    })
    if (!clients.ok) throw clients.error
    const reminders = await readAllById<ReminderRow>((after) => {
      let q = supabase.from('crm_reminders').select('id, client_id, due_at').eq('status', 'open')
      if (after) q = q.gt('id', after)
      return q.order('id', { ascending: true }).limit(PAGE_SIZE) as unknown as PromiseLike<{ data: ReminderRow[] | null; error: unknown }>
    })
    if (!reminders.ok) throw reminders.error

    const countsByUser = queueCountsByUser(clients.rows, reminders.rows, now.getTime())

    // Пользователи с ненулевым дайджестом.
    const affected = Array.from(countsByUser.entries())
      .filter(([, c]) => c.overdue + c.dueToday + c.sleeping > 0)
      .map(([u]) => u)
    if (affected.length > MAX_USERS) {
      console.warn(`[crm-digest] ${affected.length} users affected, capping at ${MAX_USERS}`)
    }
    const day = almatyDay(now.getTime()).day
    // The most urgent owners first; ties in a per-day order, so when a run cannot reach everyone
    // the same owners are not the ones left out every day.
    const urgency = (u: string) => {
      const c = countsByUser.get(u)
      return c ? [c.overdue, c.dueToday, c.sleeping] : [0, 0, 0]
    }
    const targets = affected
      .sort((a, b) => {
        const [ua, ub] = [urgency(a), urgency(b)]
        return ub[0] - ua[0] || ub[1] - ua[1] || ub[2] - ua[2] || dayRotation(day, a) - dayRotation(day, b)
      })
      .slice(0, MAX_USERS)

    if (targets.length === 0) {
      // Re-scan-напоминания должны уйти и в «тихий» день без CRM-дайджестов.
      const rescan = await sendGriRescanReminders(supabase, now, deadlineAt)
      return NextResponse.json({
        ok: true,
        data: {
          usersNotified: 0,
          emailsSent: 0,
          telegramSent: 0,
          whatsappSent: 0,
          totalOverdue: 0,
          totalDueToday: 0,
          totalSleeping: 0,
          undelivered: 0,
          timedOut: 0,
          deferred: 0,
          rescanReminders: rescan.sent,
          rescanDeferred: rescan.deferred,
          elapsedMs: Date.now() - now.getTime(),
        },
      })
    }

    // Профили (email/telegram/prefs) — устойчиво к неприменённой миграции 045:
    // если колонки telegram_chat_id ещё нет, читаем без неё (Telegram выключен).
    const profileById = new Map<string, ProfileRow>()
    for (let i = 0; i < targets.length; i += IN_CHUNK) {
      const ids = targets.slice(i, i + IN_CHUNK)
      const primary = await supabase
        .from('profiles')
        .select('id, email, telegram_chat_id, preferences')
        .in('id', ids)
      const rows = primary.error
        ? (await supabase.from('profiles').select('id, email, preferences').in('id', ids)).data
        : primary.data
      for (const p of (rows ?? []) as unknown as ProfileRow[]) profileById.set(p.id, p)
    }

    // Слабый блок текущей GRI-диагностики (довесок №9) — best-effort, батчем.
    const weakByUser = new Map<string, { label: string; score: number }>()
    try {
      for (let i = 0; i < targets.length; i += IN_CHUNK) {
        const { data: griRows } = await supabase
          .from('gri_assessments')
          .select('user_id, section_avgs')
          .eq('is_current', true)
          .in('user_id', targets.slice(i, i + IN_CHUNK))
        for (const g of (griRows ?? []) as { user_id: string; section_avgs: unknown }[]) {
          const weak = pickWeakestBlock(g.section_avgs)
          if (weak) weakByUser.set(g.user_id, weak)
        }
      }
    } catch (e) {
      console.warn('[crm-digest] GRI insight skipped', e)
    }

    // WhatsApp: только подтверждённые номера с явным согласием (Настройки › Уведомления).
    const whatsappByUser = new Map<string, string>()
    if (cloudApiConfigured()) {
      try {
        for (const r of await optedInRecipients('client', { userIds: targets })) whatsappByUser.set(r.userId, r.phone)
      } catch (e) {
        console.warn('[crm-digest] WhatsApp recipients skipped', e instanceof Error ? e.message.split('\n')[0] : e)
      }
    }
    let usersNotified = 0
    let emailsSent = 0
    let telegramSent = 0
    let whatsappSent = 0
    let totalOverdue = 0
    let totalDueToday = 0
    let totalSleeping = 0
    /** Owners started but reached by no channel (a send failed or ran out of the run's budget). */
    let undelivered = 0
    /** Channel sends cut by the run's deadline (a provider that did not answer in time). */
    let timedOut = 0
    /** One channel send of one owner, bounded by the run's deadline (lib/crm/bounded-run.ts). */
    const send = async <T,>(start: () => Promise<T>): Promise<T | undefined> => {
      const r = await beforeDeadline(start, deadlineAt)
      if (r.ok) return r.value
      timedOut += 1
      return undefined
    }

    // ≤ 2 owners at a time (in-app, e-mail, Telegram, WhatsApp of one owner go one after another),
    // no owner started with < DIGEST_MIN_START_MS of the 44 s left; the rest is reported as deferred.
    // Every send is bounded by the run's deadline: a provider that never answers (the Resend SDK
    // has no timeout) cannot hold the run past it — that owner is reported as not delivered.
    const run = await runBounded(
      targets,
      { concurrency: DIGEST_CONCURRENCY, deadlineAt, minStartMs: DIGEST_MIN_START_MS },
      async (userId) => {
        const counts = countsByUser.get(userId) ?? { overdue: 0, dueToday: 0, sleeping: 0 }
        const overdue = counts.overdue
        const dueToday = counts.dueToday
        const sleep = counts.sleeping
        const profile = profileById.get(userId)
        const email = profile?.email ?? null
        const chatId = profile?.telegram_chat_id ?? null

        const channels = selectChannels(profile?.preferences, {
          hasEmail: Boolean(email),
          hasTelegram: Boolean(chatId),
        })
        if (!channels.inApp && !channels.email && !channels.telegram && !whatsappByUser.has(userId)) return

        const data: DigestData = {
          overdue,
          dueToday,
          sleeping: sleep,
          weakBlock: weakByUser.get(userId) ?? null,
        }
        const title = buildDigestTitle(data)
        let delivered = false

        if (channels.inApp) {
          const done = await send(async () => {
            await createNotification({
              userId,
              title,
              body: buildDigestBody(data),
              category: 'crm',
              priority: 'medium',
              link: '/pulse',
              metadata: { overdue, dueToday, sleeping: sleep },
            })
            return true
          })
          if (done) delivered = true
        }

        if (channels.email && email) {
          const res = await send(() => sendUserEmail({
            to: email,
            subject: 'Кому позвонить сегодня — CRM AIStart360',
            title,
            body: buildDigestBody(data),
            ctaLabel: 'Открыть «Клиенты»',
            ctaPath: '/pulse',
          }))
          if (res?.ok) {
            emailsSent += 1
            delivered = true
          }
        }

        if (channels.telegram && chatId) {
          const ok = await send(() => sendTelegramMessage(chatId, buildTelegramDigest(data, `${base}/pulse`)))
          if (ok) {
            telegramSent += 1
            delivered = true
          }
        }

        // Доп-каналы (Фаза 4C): WhatsApp (шаблон digest через очередь) и SMS-заглушка.
        const waPhone = whatsappByUser.get(userId) ?? null
        const recipient = { userId, phone: waPhone, whatsappOptIn: waPhone !== null }
        const message = { title, body: buildDigestBody(data), data, day }
        for (const ch of EXTRA_DIGEST_CHANNELS) {
          if (!ch.isEnabled(recipient)) continue
          const ok = await send(() => ch.send(recipient, message))
          if (ok) {
            if (ch.key === 'whatsapp') whatsappSent += 1
            delivered = true
          }
        }

        if (delivered) {
          usersNotified += 1
          totalOverdue += overdue
          totalDueToday += dueToday
          totalSleeping += sleep
        } else {
          undelivered += 1
        }
      },
    )
    if (run.deferred > 0) {
      console.warn(`[crm-digest] run budget spent: ${run.deferred} of ${targets.length} owners deferred`)
    }
    if (timedOut > 0) {
      console.warn(`[crm-digest] ${timedOut} channel sends cut by the run's deadline; ${undelivered} owners not delivered`)
    }

    // Re-scan через 90 дней (№10) — best-effort, после основного цикла, в остатке бюджета.
    const rescan = await sendGriRescanReminders(supabase, now, deadlineAt)

    return NextResponse.json({
      ok: true,
      data: {
        usersNotified, emailsSent, telegramSent, whatsappSent, totalOverdue, totalDueToday, totalSleeping,
        undelivered, timedOut,
        deferred: run.deferred,
        rescanReminders: rescan.sent,
        rescanDeferred: rescan.deferred,
        elapsedMs: Date.now() - now.getTime(),
      },
    })
  } catch (err) {
    console.error('[crm-digest] sweep failed', err)
    return NextResponse.json({ ok: false, error: 'crm-digest sweep failed' }, { status: 500 })
  }
}
