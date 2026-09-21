/**
 * lib/email/layout.ts — единый макет транзакционных писем AIStart360.
 *
 * Почему так, а не «просто div'ы»: почтовые клиенты (Outlook, Gmail, Mail.app)
 * не поддерживают внешние стили, flex/grid и <style> в <head> целиком. Поэтому
 * макет — таблицы + inline-CSS, шрифты только системные (внешний web-шрифт
 * ломает рендер в Outlook), никакого JS и тяжёлой графики.
 *
 * Все значения экранируются: в письмо попадают имена, названия компаний и
 * личные сообщения от сотрудников — то есть пользовательский ввод.
 */

import { BRAND, supportEmail } from './brand'

export interface EmailFact {
  label: string
  /** Пустое значение — строка просто не попадёт в письмо. */
  value: string | number | null | undefined
}

export interface EmailContent {
  /** Текст-превью в списке писем (скрыт в теле). */
  preheader?: string | null
  /** Надпись над заголовком: «Приглашение», «Анкета» и т.п. */
  eyebrow?: string | null
  title: string
  greeting?: string | null
  paragraphs?: Array<string | null | undefined>
  /** Блок «данные события»: дата, время, компания, статус. */
  facts?: EmailFact[]
  /** Личное сообщение от пригласившего / комментарий. */
  quote?: { label?: string | null; text: string } | null
  cta?: { label: string; url: string } | null
  /** Приписка под кнопкой (срок действия ссылки и т.п.). */
  note?: string | null
  /** Строка в подвале поверх стандартной. */
  footnote?: string | null
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Ссылка в письме — только http(s). `javascript:`/`data:` в CTA означали бы,
 * что вызывающий код может подсунуть исполняемую ссылку в письмо клиенту.
 */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"

function factRows(facts: EmailFact[]): string {
  const rows = facts
    .filter((f) => f.value !== null && f.value !== undefined && String(f.value).trim() !== '')
    .map(
      (f) => `
            <tr>
              <td style="padding:8px 0;font:400 13px/18px ${FONT};color:${BRAND.muted};vertical-align:top;white-space:nowrap;padding-right:16px">${escapeHtml(f.label)}</td>
              <td style="padding:8px 0;font:600 14px/20px ${FONT};color:${BRAND.ink};vertical-align:top;word-break:break-word">${escapeHtml(f.value)}</td>
            </tr>`,
    )
  if (!rows.length) return ''
  return `
      <tr><td style="padding:0 0 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:12px">
          <tr><td style="padding:8px 20px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}
            </table>
          </td></tr>
        </table>
      </td></tr>`
}

/** Рендерит письмо в HTML и в текстовую версию (её читают текстовые клиенты). */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const cta = content.cta && safeUrl(content.cta.url) ? { label: content.cta.label, url: safeUrl(content.cta.url) as string } : null
  const paragraphs = (content.paragraphs ?? []).filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  const facts = (content.facts ?? []).filter((f) => f.value !== null && f.value !== undefined && String(f.value).trim() !== '')
  const SUPPORT = supportEmail()

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(content.title)}</title>
<style type="text/css">
  /* Единственное, что нельзя сделать inline: медиазапрос под телефон. */
  @media only screen and (max-width:600px) {
    .as-wrap { padding:16px 12px !important; }
    .as-card { border-radius:14px !important; }
    .as-pad { padding:24px 20px !important; }
    .as-title { font-size:22px !important; line-height:30px !important; }
    .as-btn a { display:block !important; text-align:center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
${content.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(content.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.canvas}">
  <tr><td align="center" class="as-wrap" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">

      <!-- Шапка -->
      <tr><td style="padding:0 4px 16px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-right:10px;vertical-align:middle">
              <div style="width:28px;height:28px;border-radius:8px;background:${BRAND.accentFrom};background-image:linear-gradient(135deg,${BRAND.accentFrom},${BRAND.accentTo});"></div>
            </td>
            <td style="vertical-align:middle">
              <span style="font:700 17px/24px ${FONT};color:${BRAND.ink};letter-spacing:-0.2px">${BRAND.name}</span><span style="font:400 17px/24px ${FONT};color:${BRAND.muted}">.app</span>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Карточка -->
      <tr><td class="as-card" style="background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="as-pad" style="padding:32px 32px 28px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${content.eyebrow ? `<tr><td style="padding:0 0 10px"><span style="display:inline-block;font:700 11px/16px ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.accentTo}">${escapeHtml(content.eyebrow)}</span></td></tr>` : ''}
              <tr><td class="as-title" style="padding:0 0 ${content.greeting || paragraphs.length ? '14px' : '20px'};font:700 25px/33px ${FONT};color:${BRAND.ink};letter-spacing:-0.4px">${escapeHtml(content.title)}</td></tr>
              ${content.greeting ? `<tr><td style="padding:0 0 10px;font:600 15px/23px ${FONT};color:${BRAND.ink}">${escapeHtml(content.greeting)}</td></tr>` : ''}
              ${paragraphs
                .map((p) => `<tr><td style="padding:0 0 14px;font:400 15px/23px ${FONT};color:${BRAND.inkSoft}">${escapeHtml(p).replace(/\n/g, '<br />')}</td></tr>`)
                .join('')}
              ${facts.length ? `<tr><td style="padding:4px 0 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows(facts)}</table></td></tr>` : ''}
              ${
                content.quote
                  ? `<tr><td style="padding:6px 0 16px">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid ${BRAND.accentFrom};background:${BRAND.panel};border-radius:0 10px 10px 0">
                    <tr><td style="padding:12px 16px">
                      ${content.quote.label ? `<div style="font:600 11px/16px ${FONT};letter-spacing:0.8px;text-transform:uppercase;color:${BRAND.muted};padding-bottom:4px">${escapeHtml(content.quote.label)}</div>` : ''}
                      <div style="font:400 14px/21px ${FONT};color:${BRAND.ink};word-break:break-word">${escapeHtml(content.quote.text).replace(/\n/g, '<br />')}</div>
                    </td></tr>
                  </table>
                </td></tr>`
                  : ''
              }
              ${
                cta
                  ? `<tr><td class="as-btn" style="padding:10px 0 6px">
                  <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${BRAND.accentTo};background-image:linear-gradient(135deg,${BRAND.accentFrom},${BRAND.accentTo});color:#ffffff;font:700 15px/20px ${FONT};padding:14px 28px;border-radius:10px;text-decoration:none">${escapeHtml(cta.label)}</a>
                </td></tr>`
                  : ''
              }
              ${content.note ? `<tr><td style="padding:12px 0 0;font:400 13px/20px ${FONT};color:${BRAND.muted}">${escapeHtml(content.note)}</td></tr>` : ''}
              ${
                cta
                  ? `<tr><td style="padding:16px 0 0;border-top:1px solid ${BRAND.line};margin-top:8px">
                  <div style="font:400 12px/18px ${FONT};color:${BRAND.muted};padding-top:14px">Кнопка не работает? Скопируйте ссылку в адресную строку:</div>
                  <div style="font:400 12px/18px ${FONT};color:${BRAND.inkSoft};word-break:break-all;padding-top:4px"><a href="${escapeHtml(cta.url)}" style="color:${BRAND.inkSoft};text-decoration:underline">${escapeHtml(cta.url)}</a></div>
                </td></tr>`
                  : ''
              }
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Подвал -->
      <tr><td style="padding:20px 8px 0">
        ${content.footnote ? `<div style="font:400 12px/18px ${FONT};color:${BRAND.muted};padding-bottom:8px">${escapeHtml(content.footnote)}</div>` : ''}
        <div style="font:400 12px/18px ${FONT};color:${BRAND.muted}">
          ${BRAND.name}.app — ${BRAND.tagline}.<br />
          Вопросы: <a href="mailto:${escapeHtml(SUPPORT)}" style="color:${BRAND.inkSoft};text-decoration:underline">${escapeHtml(SUPPORT)}</a>
        </div>
        <div style="font:400 11px/16px ${FONT};color:#9aa3b2;padding-top:10px">© ${new Date().getFullYear()} ${BRAND.name}. Служебное письмо по вашему аккаунту.</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`

  const textLines: string[] = [BRAND.name.toUpperCase(), '']
  if (content.eyebrow) textLines.push(content.eyebrow.toUpperCase())
  textLines.push(content.title, '')
  if (content.greeting) textLines.push(content.greeting, '')
  for (const p of paragraphs) textLines.push(p, '')
  for (const f of facts) textLines.push(`${f.label}: ${f.value}`)
  if (facts.length) textLines.push('')
  if (content.quote) textLines.push(`${content.quote.label ? content.quote.label + ': ' : ''}«${content.quote.text}»`, '')
  if (cta) textLines.push(`${cta.label}: ${cta.url}`, '')
  if (content.note) textLines.push(content.note, '')
  if (content.footnote) textLines.push(content.footnote, '')
  textLines.push(`${BRAND.name}.app — ${BRAND.tagline}.`, `Вопросы: ${SUPPORT}`)

  return { html, text: textLines.join('\n') }
}
