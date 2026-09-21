/**
 * lib/email/notification.ts — простые служебные уведомления.
 *
 * Исторический API (`sendNotificationEmail` / `sendUserEmail`) сохранён: его
 * используют админские алерты, эскалации, сброс 2FA и CRM-дайджест. Изменилось
 * одно — письмо теперь рисует общий макет `lib/email/layout.ts`, поэтому вся
 * почта платформы выглядит одной системой.
 *
 * Значения по-прежнему экранируются: `title`/`body`/`ctaLabel` приходят из
 * пользовательского ввода (например, имя загруженного файла), и неэкранированная
 * подстановка была бы вектором фишинга в почте администратора.
 */

import { Resend } from 'resend'
import { emailFrom, emailReplyTo } from './brand'
import { renderEmail, safeUrl } from './layout'

export const sendNotificationEmail = async ({
  to,
  subject,
  title,
  body,
  ctaLabel,
  ctaUrl,
}: {
  to: string
  subject: string
  title: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
}) => {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('RESEND_API_KEY is missing')
    return { error: 'RESEND_API_KEY is missing' }
  }

  const resend = new Resend(apiKey)
  const { html, text } = renderEmail({
    preheader: body.slice(0, 140),
    title,
    paragraphs: [body],
    cta: ctaLabel && safeUrl(ctaUrl) ? { label: ctaLabel, url: ctaUrl as string } : null,
  })
  const replyTo = emailReplyTo()

  return resend.emails.send({
    from: emailFrom(),
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  })
}

/**
 * Send a user-facing notification and REPORT the outcome (never throws).
 *
 * Centralizes CTA base-URL resolution and makes delivery failures VISIBLE: on a
 * missing RESEND_API_KEY or a Resend error it logs and returns { ok:false,error }
 * instead of silently swallowing it, so callers can surface "email not sent".
 */
export async function sendUserEmail(opts: {
  to: string
  subject: string
  title: string
  body: string
  ctaLabel?: string
  ctaPath?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL
    const res = await sendNotificationEmail({
      to: opts.to,
      subject: opts.subject,
      title: opts.title,
      body: opts.body,
      ...(opts.ctaLabel && opts.ctaPath && base
        ? { ctaLabel: opts.ctaLabel, ctaUrl: `${base}${opts.ctaPath}` }
        : {}),
    })
    const error = (res as { error?: unknown } | null)?.error
    if (error) {
      const msg = typeof error === 'string' ? error : (error as { message?: string })?.message ?? JSON.stringify(error)
      console.error(`[email] delivery failed → ${opts.to} "${opts.subject}": ${msg}`)
      return { ok: false, error: msg }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[email] send threw → ${opts.to} "${opts.subject}": ${msg}`)
    return { ok: false, error: msg }
  }
}
