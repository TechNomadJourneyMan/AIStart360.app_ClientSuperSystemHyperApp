/**
 * Письма AIStart360: единый макет, экранирование, необязательные поля,
 * дата/время в одном поясе, запасная ссылка и безопасность CTA.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { renderEmail, safeUrl, escapeHtml } from '@/lib/email/layout'
import { formatMoment } from '@/lib/email/brand'
import {
  buildAccessGrantedEmail,
  buildGriCompletedEmail,
  buildInvitationEmail,
  buildQuestionnaireCompletedEmail,
} from '@/lib/email/templates'

beforeEach(() => {
  process.env.EMAIL_TIMEZONE = 'Asia/Almaty'
})

const AT = '2026-09-20T10:30:00.000Z' // 15:30 в Алматы (UTC+5)

describe('макет письма', () => {
  it('экранирует пользовательский ввод — письмо нельзя превратить в фишинг', () => {
    const { html } = renderEmail({
      title: 'Привет <script>alert(1)</script>',
      paragraphs: ['ТОО «Альфа & Ко» <b>жирным не станет</b>'],
      facts: [{ label: 'Компания', value: '<img src=x onerror=alert(1)>' }],
    })
    expect(html).not.toContain('<script>')
    // Значение осталось текстом: тег не собрался, атрибут не исполнится.
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('не рисует пустые поля: необязательное значение просто исчезает', () => {
    const { html, text } = renderEmail({
      title: 'Тест',
      facts: [
        { label: 'Компания', value: null },
        { label: 'Роль', value: '   ' },
        { label: 'Дата', value: '20 сентября 2026' },
      ],
    })
    expect(html).not.toContain('Компания')
    expect(html).not.toContain('Роль')
    expect(html).toContain('20 сентября 2026')
    expect(text).toContain('Дата: 20 сентября 2026')
  })

  it('показывает запасную ссылку рядом с кнопкой', () => {
    const { html, text } = renderEmail({
      title: 'Тест',
      cta: { label: 'Принять', url: 'https://portal.aistart360.app/auth/verify?token_hash=abc' },
    })
    expect(html).toContain('Кнопка не работает?')
    expect(html).toContain('https://portal.aistart360.app/auth/verify?token_hash=abc')
    expect(text).toContain('Принять: https://portal.aistart360.app/auth/verify?token_hash=abc')
  })

  it('не пускает в кнопку неподходящую схему ссылки', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html,<script>')).toBeNull()
    expect(safeUrl('https://portal.aistart360.app/x')).toBe('https://portal.aistart360.app/x')
    const { html } = renderEmail({ title: 'Тест', cta: { label: 'Жми', url: 'javascript:alert(1)' } })
    expect(html).not.toContain('javascript:')
  })

  it('адаптивен и не зависит от JS и внешних шрифтов', () => {
    const { html } = renderEmail({ title: 'Тест' })
    expect(html).toContain('@media only screen and (max-width:600px)')
    expect(html).toContain('width=device-width')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('fonts.googleapis.com')
  })

  it('длинные имена и названия компаний переносятся, а не ломают вёрстку', () => {
    const { html } = renderEmail({
      title: 'Тест',
      facts: [{ label: 'Компания', value: 'Т'.repeat(120) }],
    })
    expect(html).toContain('word-break:break-word')
  })

  it('escapeHtml обрабатывает пустые значения', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('дата и время', () => {
  it('показывает дату, время и пояс получателя', () => {
    const m = formatMoment(AT)
    expect(m?.date).toContain('2026')
    expect(m?.time).toContain('15:30')
    expect(m?.time).toContain('UTC+5')
  })

  it('не роняет письмо на некорректной дате', () => {
    expect(formatMoment('не дата')).toBeNull()
    expect(formatMoment(null)).toBeNull()
  })
})

describe('шаблон приглашения', () => {
  it('содержит компанию, роль, дату, срок действия и CTA', () => {
    const { subject, content } = buildInvitationEmail({
      name: 'Иван',
      company: 'ТОО «Пример»',
      roleLabel: 'SuperExpert',
      invitedByLabel: 'admin@aistart360.app',
      invitedAt: AT,
      expiresAt: '2026-09-20T11:30:00.000Z',
      url: 'https://portal.aistart360.app/auth/verify?token_hash=abc',
    })
    const { html } = renderEmail(content)
    expect(subject).toBe('Приглашение в AIStart360')
    expect(html).toContain('Иван')
    expect(html).toContain('ТОО «Пример»')
    expect(html).toContain('SuperExpert')
    expect(html).toContain('15:30')
    expect(html).toContain('Принять приглашение')
  })

  it('существующему аккаунту говорит о входе, а не о приглашении', () => {
    const { subject, content } = buildInvitationEmail({ url: 'https://x.io/a', existingAccount: true })
    expect(subject).toBe('Ссылка для входа в AIStart360')
    expect(content.cta?.label).toBe('Войти в кабинет')
  })

  it('без имени здоровается нейтрально, без «, null»', () => {
    const { content } = buildInvitationEmail({ url: 'https://x.io/a' })
    expect(content.greeting).toBe('Здравствуйте!')
  })
})

describe('шаблон «анкета пройдена»', () => {
  it('показывает статус, прогресс, дату и компанию', () => {
    const { subject, content } = buildQuestionnaireCompletedEmail({
      name: 'Иван', company: 'ТОО «Пример»', completedSteps: 12, totalSteps: 12, completedAt: AT,
      url: 'https://portal.aistart360.app/client/point-a',
    })
    const { html } = renderEmail(content)
    expect(subject).toContain('заполнена')
    expect(html).toContain('Заполнена полностью')
    expect(html).toContain('12 из 12 шагов')
    expect(html).toContain('ТОО «Пример»')
  })

  it('частично заполненную анкету не называет завершённой', () => {
    const { content } = buildQuestionnaireCompletedEmail({ completedSteps: 7, totalSteps: 12, url: 'https://x.io/a' })
    expect(content.title).toBe('Анкета отправлена')
  })
})

describe('шаблон «GRI пройден»', () => {
  it('показывает индекс, когда его разрешено показывать', () => {
    const { content } = buildGriCompletedEmail({ griIndex: 7.25, completedAt: AT, url: 'https://x.io/a' })
    expect(renderEmail(content).html).toContain('7.3 из 10')
  })

  it('скрывает цифру результата, когда это запрещено', () => {
    const { content } = buildGriCompletedEmail({ griIndex: 7.25, includeScore: false, url: 'https://x.io/a' })
    const { html } = renderEmail(content)
    expect(html).not.toContain('7.3 из 10')
    expect(html).toContain('Пройдена')
  })
})

describe('шаблон «доступ открыт»', () => {
  it('ведёт на вход и называет дату', () => {
    const { subject, content } = buildAccessGrantedEmail({ name: 'Иван', grantedAt: AT, url: 'https://portal.aistart360.app/login' })
    expect(subject).toBe('Доступ к AIStart360 открыт')
    expect(content.cta?.url).toContain('/login')
    expect(renderEmail(content).html).toContain('15:30')
  })
})
