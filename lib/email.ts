import { Resend } from 'resend'

// Escape user-controlled values before interpolating them into the notification
// email HTML. `title`/`body`/`ctaLabel` can carry user-supplied content (e.g. an
// uploaded file name flowing through notifyAdmins), so unescaped interpolation
// was an HTML/link-injection (phishing) vector in the admin inbox.
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="background:#0A0B0F;color:#e3e2e8;font-family:DM Sans,sans-serif;padding:32px;max-width:500px;margin:0 auto">
      <div style="background:#1f1f24;border-radius:12px;padding:32px">
        <p style="color:#6effc0;font-size:11px;font-family:monospace;text-transform:uppercase;letter-spacing:0.2em;margin-bottom:16px">
          AIStart360 · Institutional Intelligence
        </p>
        <h1 style="font-size:22px;font-weight:700;margin:0 0 12px">${escapeHtml(title)}</h1>
        <p style="color:#bacbbf;line-height:1.6;margin:0 0 24px">${escapeHtml(body)}</p>
        ${ctaLabel && ctaUrl ? `
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6effc0,#00e5a0);color:#003824;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none">
          ${escapeHtml(ctaLabel)}
        </a>
        ` : ''}
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0">
        <p style="color:#84958a;font-size:12px">
          AIStart360 — Institutional Intelligence Platform<br>
          Отписаться от уведомлений можно в настройках аккаунта.
        </p>
      </div>
    </body>
    </html>
  `

  return resend.emails.send({
    from: 'AIStart360 <notifications@aistart360.com>',
    to,
    subject,
    html,
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
