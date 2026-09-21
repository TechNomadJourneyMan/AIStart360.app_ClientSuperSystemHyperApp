/**
 * lib/email/brand.ts — фирменные константы писем AIStart360.
 *
 * Цвета взяты из логотипа платформы (градиент #e87a35 → #dc524b, чернила
 * #111729), поэтому письмо и портал выглядят одной системой. Всё, что можно
 * настроить окружением, читается из env — ничего не захардкожено «намертво».
 */

export const BRAND = {
  name: 'AIStart360',
  domain: 'aistart360.app',
  tagline: 'Платформа диагностики и роста бизнеса',
  /** Градиент логотипа — кнопки и акценты. */
  accentFrom: '#e87a35',
  accentTo: '#dc524b',
  /** Чернила логотипа — заголовки. */
  ink: '#111729',
  inkSoft: '#4a5468',
  muted: '#7b8598',
  line: '#e4e7ee',
  surface: '#ffffff',
  canvas: '#f2f3f7',
  panel: '#f8f9fc',
} as const

/** Часовой пояс, в котором пользователю показывают дату и время в письме. */
export function emailTimeZone(): string {
  return process.env.EMAIL_TIMEZONE || 'Asia/Almaty'
}

/**
 * Адрес отправителя. Домен ОБЯЗАН быть верифицирован в Resend, иначе письмо
 * не уходит вовсе («The <domain> domain is not verified»).
 *
 * Отправляем с ПОДДОМЕНА `support.aistart360.app` — он заведён и верифицирован
 * в нашем аккаунте Resend (DKIM + SPF + MX в Vercel DNS). Корневой
 * `aistart360.app` НЕ подходит: он числится за другим аккаунтом Resend
 * («registered to another team»), и письмо с него не уходит. Разница в одну
 * точку, поэтому ошибиться легко — проверено отправкой.
 *
 * Раньше здесь стоял `notifications@aistart360.com` — такого домена в Resend
 * нет вовсе, и ВСЯ почта платформы падала молча.
 */
export function emailFrom(): string {
  return process.env.EMAIL_FROM || 'AIStart360 <support@support.aistart360.app>'
}

/** Куда попадут ответы на письмо (если задано). */
export function emailReplyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO || undefined
}

/** Адрес поддержки в подвале письма. */
export function supportEmail(): string {
  const reply = process.env.EMAIL_REPLY_TO
  if (reply) return reply
  return process.env.SUPPORT_EMAIL || 'support@aistart360.app'
}

export interface FormattedMoment {
  /** «20 сентября 2026» */
  date: string
  /** «15:30 (UTC+5)» */
  time: string
  /** «20 сентября 2026, 15:30 (UTC+5)» */
  full: string
  iso: string
}

/** Смещение пояса в виде «UTC+5» — чтобы получатель не гадал, чьё это время. */
function utcOffsetLabel(at: Date, timeZone: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value
    if (!name) return ''
    // longOffset даёт «GMT+05:00» → приводим к «UTC+5».
    const m = name.match(/GMT([+-])(\d{2}):(\d{2})/)
    if (!m) return name.replace('GMT', 'UTC')
    const hours = Number(m[2])
    const minutes = Number(m[3])
    return `UTC${m[1]}${hours}${minutes ? `:${m[3]}` : ''}`
  } catch {
    return ''
  }
}

/**
 * Дата и время события в человекочитаемом виде, в одном поясе для всех писем.
 * Некорректная дата возвращается как пустые строки — шаблон просто не покажет
 * блок, вместо «Invalid Date» в письме клиенту.
 */
export function formatMoment(input: Date | string | number | null | undefined): FormattedMoment | null {
  if (input === null || input === undefined) return null
  const at = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(at.getTime())) return null

  const timeZone = emailTimeZone()
  try {
    const date = new Intl.DateTimeFormat('ru-RU', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(at)
    const clock = new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
    const offset = utcOffsetLabel(at, timeZone)
    const time = offset ? `${clock} (${offset})` : clock
    return { date, time, full: `${date}, ${time}`, iso: at.toISOString() }
  } catch {
    const iso = at.toISOString()
    return { date: iso.slice(0, 10), time: iso.slice(11, 16), full: iso, iso }
  }
}
