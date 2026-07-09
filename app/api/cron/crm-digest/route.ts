import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { createNotification } from '@/lib/notifications/create'
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

export const dynamic = 'force-dynamic'
// Дайджест шлёт до трёх каналов на пользователя; на большой базе даём функции
// больше времени, чем дефолтные 15 c hobby-плана.
export const maxDuration = 60

/**
 * GET /api/cron/crm-digest — утренний CRM-дайджест (Фаза 2 + мультиканал Фазы 4A).
 *
 * Раз в сутки собирает по каждому владельцу CRM:
 *   • просроченные / сегодняшние открытые напоминания (crm_reminders);
 *   • «спящих» клиентов без контакта > 30 дней (crm_clients);
 *   • слабый блок текущей GRI-диагностики (довесок №9).
 * И доставляет по каналам из preferences.notifications.crm: in-app (колокольчик),
 * email (Resend) и Telegram (если чат привязан). Каждый канал — best-effort.
 *
 * Auth: Vercel Cron присылает `Authorization: Bearer ${CRON_SECRET}`.
 * Для ручного теста также принимается `?secret=` с тем же значением.
 */

const MAX_USERS = 5000
const SLEEP_DAYS = 30
const QUERY_LIMIT = 50000

type CountRow = { user_id: string }
type ProfileRow = {
  id: string
  email?: string | null
  telegram_chat_id?: string | null
  preferences?: unknown
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const authorized = authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()
    const base = process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || ''

    const now = new Date()
    const endOfToday = new Date(now)
    endOfToday.setUTCHours(23, 59, 59, 999)
    const sleepCutoff = new Date(now.getTime() - SLEEP_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // 1) Открытые просроченные / сегодняшние напоминания.
    const { data: reminders, error: remErr } = await supabase
      .from('crm_reminders')
      .select('user_id')
      .eq('status', 'open')
      .lte('due_at', endOfToday.toISOString())
      .limit(QUERY_LIMIT)
    if (remErr) throw remErr

    // 2) «Спящие» клиенты.
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

    const overdueByUser = new Map<string, number>()
    for (const r of (reminders ?? []) as CountRow[]) {
      if (r.user_id) overdueByUser.set(r.user_id, (overdueByUser.get(r.user_id) ?? 0) + 1)
    }
    const sleepingByUser = new Map<string, number>()
    for (const c of (sleeping ?? []) as CountRow[]) {
      if (c.user_id) sleepingByUser.set(c.user_id, (sleepingByUser.get(c.user_id) ?? 0) + 1)
    }

    // Пользователи с ненулевым дайджестом.
    const affected = Array.from(new Set([...overdueByUser.keys(), ...sleepingByUser.keys()])).filter(
      (u) => (overdueByUser.get(u) ?? 0) + (sleepingByUser.get(u) ?? 0) > 0,
    )
    if (affected.length > MAX_USERS) {
      console.warn(`[crm-digest] ${affected.length} users affected, capping at ${MAX_USERS}`)
    }
    const targets = affected.slice(0, MAX_USERS)

    if (targets.length === 0) {
      return NextResponse.json({
        ok: true,
        data: { usersNotified: 0, emailsSent: 0, telegramSent: 0, totalOverdue: 0, totalSleeping: 0 },
      })
    }

    // Профили (email/telegram/prefs) — устойчиво к неприменённой миграции 045:
    // если колонки telegram_chat_id ещё нет, читаем без неё (Telegram выключен).
    const profileById = new Map<string, ProfileRow>()
    {
      const primary = await supabase
        .from('profiles')
        .select('id, email, telegram_chat_id, preferences')
        .in('id', targets)
      const rows = primary.error
        ? (await supabase.from('profiles').select('id, email, preferences').in('id', targets)).data
        : primary.data
      for (const p of (rows ?? []) as unknown as ProfileRow[]) profileById.set(p.id, p)
    }

    // Слабый блок текущей GRI-диагностики (довесок №9) — best-effort, батчем.
    const weakByUser = new Map<string, { label: string; score: number }>()
    try {
      const { data: griRows } = await supabase
        .from('gri_assessments')
        .select('user_id, section_avgs')
        .eq('is_current', true)
        .in('user_id', targets)
      for (const g of (griRows ?? []) as { user_id: string; section_avgs: unknown }[]) {
        const weak = pickWeakestBlock(g.section_avgs)
        if (weak) weakByUser.set(g.user_id, weak)
      }
    } catch (e) {
      console.warn('[crm-digest] GRI insight skipped', e)
    }

    let usersNotified = 0
    let emailsSent = 0
    let telegramSent = 0
    let totalOverdue = 0
    let totalSleeping = 0

    const CONCURRENCY = 25
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const chunk = targets.slice(i, i + CONCURRENCY)
      await Promise.all(
        chunk.map(async (userId) => {
          const overdue = overdueByUser.get(userId) ?? 0
          const sleep = sleepingByUser.get(userId) ?? 0
          const profile = profileById.get(userId)
          const email = profile?.email ?? null
          const chatId = profile?.telegram_chat_id ?? null

          const channels = selectChannels(profile?.preferences, {
            hasEmail: Boolean(email),
            hasTelegram: Boolean(chatId),
          })
          if (!channels.inApp && !channels.email && !channels.telegram) return

          const data: DigestData = {
            overdue,
            sleeping: sleep,
            weakBlock: weakByUser.get(userId) ?? null,
          }
          const title = buildDigestTitle(data)
          let delivered = false

          if (channels.inApp) {
            await createNotification({
              userId,
              title,
              body: buildDigestBody(data),
              category: 'crm',
              priority: 'medium',
              link: '/pulse',
              metadata: { overdue, sleeping: sleep },
            })
            delivered = true
          }

          if (channels.email && email) {
            const res = await sendUserEmail({
              to: email,
              subject: 'Кому позвонить сегодня — CRM AIStart360',
              title,
              body: buildDigestBody(data),
              ctaLabel: 'Открыть «Клиенты»',
              ctaPath: '/pulse',
            })
            if (res.ok) {
              emailsSent += 1
              delivered = true
            }
          }

          if (channels.telegram && chatId) {
            const ok = await sendTelegramMessage(chatId, buildTelegramDigest(data, `${base}/pulse`))
            if (ok) {
              telegramSent += 1
              delivered = true
            }
          }

          // Доп-каналы за флагами (Фаза 4C): WhatsApp/SMS. Телефон владельца пока
          // не хранится в profiles → phone:null, каналы выключены до источника
          // телефона; isEnabled коротко замыкается на env-флагах (нулевая цена).
          const recipient = { userId, phone: null }
          const message = { title, body: buildDigestBody(data) }
          for (const ch of EXTRA_DIGEST_CHANNELS) {
            if (!ch.isEnabled(recipient)) continue
            const ok = await ch.send(recipient, message)
            if (ok) delivered = true
          }

          if (delivered) {
            usersNotified += 1
            totalOverdue += overdue
            totalSleeping += sleep
          }
        }),
      )
    }

    return NextResponse.json({
      ok: true,
      data: { usersNotified, emailsSent, telegramSent, totalOverdue, totalSleeping },
    })
  } catch (err) {
    console.error('[crm-digest] sweep failed', err)
    return NextResponse.json({ ok: false, error: 'crm-digest sweep failed' }, { status: 500 })
  }
}
