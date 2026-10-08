/**
 * lib/notifications/notify.ts — ЕДИНАЯ точка уведомлений клиенту (F-056).
 *
 * ── Как пользоваться ────────────────────────────────────────────────────────
 *
 *   import { notifyClient } from '@/lib/notifications/notify'
 *
 *   await notifyClient({
 *     userId,                       // кому (profiles.id)
 *     category: 'expert',           // категория настроек (см. таблицу ниже)
 *     event: 'expert_review_ready', // машинное имя события (журнал, метаданные)
 *     title: 'Эксперт проверил ваш GRI',
 *     body: 'Откройте разбор — там комментарии по трём блокам.',
 *     ctaUrl: '/client/home#expert', // путь портала или абсолютная ссылка
 *     dedupeKey: `expert_review:${reviewId}`, // необязательно: второй вызов с тем же ключом ничего не пришлёт
 *   })
 *
 * Функция НИКОГДА не бросает и сама решает, куда слать:
 *   • in-app (колокольчик, app_notifications)  — если включено в категории;
 *   • email (фирменный макет lib/email, журнал email_deliveries, идемпотентность
 *     по тому же dedupeKey)                     — если включено и есть адрес;
 *   • Telegram                                  — только если чат привязан
 *                                                 И канал включён в категории.
 * Необязательно: `channels` — принудительно выключить/включить канал;
 * `email` — готовый фирменный шаблон вместо универсального письма;
 * `automated` — это автоматическое касание (cron): пишется в журнал
 * automation_sends; если оно входит в лимит (countsTowardCap, по умолчанию да),
 * действуют общий выключатель `auto_reminders_enabled` и недельный потолок
 * `auto_touch_weekly_cap`.
 *
 * ── Переключатели «Настройки → Уведомления» → что они делают ──────────────
 * (хранятся в profiles.preferences.notifications[категория].{in_app,email,telegram};
 *  значения по умолчанию — lib/notifications/preferences.ts)
 *
 *   gri       — «Анкета принята» (письмо; запись в ленте ставит сама анкета),
 *               «GRI пройден» (лента + письмо), «Пора пересчитать GRI» через
 *               90 дней (crm-digest). По умолчанию: лента + email.
 *   expert    — новый комментарий эксперта, изменения по обращению
 *               (lib/notifications.ts notifyUser → сюда). Лента + email.
 *   reports   — «Точка А пересчитана», «Документ разобран». Только лента.
 *   reminders — cron /api/cron/reminders: брошенная анкета 3/7/14 дней,
 *               «пройдите GRI» через 7 дней после Точки А, черновик GRI не
 *               менялся 3 дня, пятничный пульс при стрике ≥ 2, приветственная
 *               серия D1/D3/D7. Лента + email, не больше auto_touch_weekly_cap
 *               касаний за 7 дней (и «Пора пересчитать GRI» входит в лимит).
 *   digest    — cron /api/cron/client-digest по понедельникам. Лента + email.
 *               Выключены оба канала → дайджест не собирается вовсе.
 *   crm       — утренний CRM-дайджест (cron crm-digest). Лента + email + Telegram.
 *   team      — сотрудникам: утренний список просроченных staff_tasks
 *               (cron staff-digest). Лента + email.
 *   security  — «Доступ открыт» и события безопасности. Выключить нельзя:
 *               на экране переключатели заблокированы.
 *
 *   Telegram-колонка на экране появляется после привязки чата и действует
 *   для каждой категории отдельно (по умолчанию включена только у CRM).
 *   Старый ключ `critical` больше не показывается — ни одно событие его не
 *   читало.
 */

import { createNotification, type NotifCategory, type NotifPriority } from '@/lib/notifications/create'
import { resolveChannels, type NotifyCategory, type ResolvedChannels } from '@/lib/notifications/preferences'
import { claimSend, countCapTouches, getRecipient, releaseSend } from '@/lib/notifications/store'
import { sendTransactionalEmail, type EmailKind } from '@/lib/email/send'
import { buildClientNotificationEmail } from '@/lib/email/templates'
import type { EmailContent } from '@/lib/email/layout'
import { sendTelegramMessage } from '@/lib/telegram'
import { getSetting } from '@/lib/settings/store'
import { getSiteUrl } from '@/lib/site-url'

export type { NotifyCategory } from '@/lib/notifications/preferences'

export interface NotifyClientInput {
  userId: string
  category: NotifyCategory
  /** Машинное имя события: 'gri_completed', 'survey_reminder' … */
  event: string
  title: string
  body: string
  /** Путь портала ('/client/home') или абсолютная ссылка. */
  ctaUrl?: string | null
  ctaLabel?: string | null
  /** Ключ идемпотентности: повторный вызов с тем же ключом ничего не отправит. */
  dedupeKey?: string | null
  /** Принудительно: false — канал выключен, true — включён несмотря на настройку. */
  channels?: Partial<ResolvedChannels>
  priority?: NotifPriority
  /** Готовое фирменное письмо вместо универсального. */
  email?: { subject: string; content: EmailContent; kind?: EmailKind } | null
  /** Надпись над заголовком универсального письма. */
  eyebrow?: string | null
  /** Вид письма в журнале email_deliveries (по умолчанию client_notification / reminder). */
  emailKind?: EmailKind
  /** Автоматическое касание (cron): выключатель + недельный потолок. */
  automated?: { kind: string; countsTowardCap?: boolean } | null
  metadata?: Record<string, unknown>
}

export type NotifySkipReason = 'no_profile' | 'disabled' | 'automation_off' | 'capped' | 'duplicate' | 'journal_unavailable' | 'not_delivered'

export interface NotifyClientResult {
  ok: boolean
  skipped?: NotifySkipReason
  delivered: { inApp: boolean; email: boolean; telegram: boolean }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const NONE = { inApp: false, email: false, telegram: false }

/** Категория ленты уведомлений (исторические имена в app_notifications). */
function feedCategory(category: NotifyCategory): NotifCategory {
  if (category === 'reports') return 'report'
  return category as NotifCategory
}

function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  if (!url.startsWith('/') || url.startsWith('//')) return null
  return getSiteUrl(url)
}

/** Путь для ленты: только относительный путь портала. */
function feedLink(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (url.startsWith('/') && !url.startsWith('//')) return url
  return undefined
}

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildTelegramText(title: string, body: string, url: string | null, label?: string | null): string {
  const link = url ? `\n\n<a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(label || 'Открыть')}</a>` : ''
  return `<b>${escapeTelegramHtml(title)}</b>\n\n${escapeTelegramHtml(body)}${link}`
}

/** Недельный потолок и общий выключатель автоматики. */
async function automationGate(userId: string, now: Date): Promise<NotifySkipReason | null> {
  let enabled = true
  let cap = 2
  try {
    enabled = await getSetting('auto_reminders_enabled')
    cap = await getSetting('auto_touch_weekly_cap')
  } catch {
    /* настройки недоступны — значения по умолчанию */
  }
  if (!enabled) return 'automation_off'
  if (cap <= 0) return 'capped'
  const used = await countCapTouches(userId, new Date(now.getTime() - WEEK_MS).toISOString())
  // Журнал недоступен → считаем лимит исчерпанным: без журнала нет ни потолка, ни идемпотентности.
  if (used === null) return 'journal_unavailable'
  return used >= cap ? 'capped' : null
}

export async function notifyClient(input: NotifyClientInput, now: Date = new Date()): Promise<NotifyClientResult> {
  try {
    const profile = await getRecipient(input.userId)
    if (!profile) return { ok: false, skipped: 'no_profile', delivered: NONE }

    const channels = resolveChannels(profile.preferences, input.category, {
      hasEmail: Boolean(profile.email),
      hasTelegram: Boolean(profile.telegramChatId),
      override: input.channels,
    })
    if (!channels.inApp && !channels.email && !channels.telegram) {
      return { ok: true, skipped: 'disabled', delivered: NONE }
    }

    const automated = input.automated ?? null
    // Выключатель и потолок — только для касаний, которые входят в лимит
    // (напоминания). Дайджест пишет маркер в журнал, но лимит не тратит.
    if (automated && automated.countsTowardCap !== false) {
      const gate = await automationGate(input.userId, now)
      if (gate) return { ok: gate !== 'journal_unavailable', skipped: gate, delivered: NONE }
    }

    // Бронь в журнале: идемпотентность + учёт касания в потолке.
    let claimId: string | null = null
    if (automated || input.dedupeKey) {
      const claim = await claimSend({
        userId: input.userId,
        kind: automated?.kind ?? input.event,
        dedupeKey: input.dedupeKey ?? null,
        countsTowardCap: automated ? automated.countsTowardCap !== false : false,
        channels: [channels.inApp && 'in_app', channels.email && 'email', channels.telegram && 'telegram'].filter(Boolean) as string[],
        metadata: { event: input.event, category: input.category, ...(input.metadata ?? {}) },
      })
      if (claim.result === 'duplicate') return { ok: true, skipped: 'duplicate', delivered: NONE }
      // Автоматика без журнала не шлёт (иначе каждый запуск cron повторял бы касание);
      // событие продукта уходит — лучше лишнее уведомление, чем потерянное.
      if (claim.result === 'unavailable' && automated) return { ok: false, skipped: 'journal_unavailable', delivered: NONE }
      claimId = claim.id
    }

    const url = absoluteUrl(input.ctaUrl)
    const delivered = { inApp: false, email: false, telegram: false }

    const tasks: Array<Promise<void>> = []
    if (channels.inApp) {
      tasks.push(
        createNotification({
          userId: input.userId,
          title: input.title,
          body: input.body,
          category: feedCategory(input.category),
          priority: input.priority ?? 'medium',
          link: feedLink(input.ctaUrl),
          metadata: { event: input.event, ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}), ...(input.metadata ?? {}) },
        }).then((ok) => {
          delivered.inApp = ok
        }),
      )
    }
    if (channels.email && profile.email) {
      const built = input.email ?? buildClientNotificationEmail({
        title: input.title,
        eyebrow: input.eyebrow ?? null,
        name: profile.fullName,
        paragraphs: input.body.split(/\n{2,}/),
        ctaLabel: input.ctaLabel ?? null,
        url,
      })
      tasks.push(
        sendTransactionalEmail({
          kind: input.email?.kind ?? input.emailKind ?? (automated ? 'reminder' : 'client_notification'),
          to: profile.email,
          subject: built.subject,
          content: built.content,
          userId: input.userId,
          dedupeKey: input.dedupeKey ?? null,
          metadata: { event: input.event, category: input.category },
        }).then((res) => {
          // skipped = уже отправлено ранее или отправка отключена (тесты) — не ошибка.
          delivered.email = res.ok
        }),
      )
    }
    if (channels.telegram && profile.telegramChatId) {
      tasks.push(
        sendTelegramMessage(profile.telegramChatId, buildTelegramText(input.title, input.body, url, input.ctaLabel)).then((ok) => {
          delivered.telegram = ok
        }),
      )
    }
    await Promise.allSettled(tasks)

    const any = delivered.inApp || delivered.email || delivered.telegram
    if (!any && claimId) {
      await releaseSend(claimId)
      return { ok: false, skipped: 'not_delivered', delivered }
    }
    return { ok: any, delivered }
  } catch (err) {
    console.error('[notifyClient]', input.event, err)
    return { ok: false, delivered: NONE }
  }
}
