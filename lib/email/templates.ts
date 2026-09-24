/**
 * lib/email/templates.ts — тексты и данные писем AIStart360.
 *
 * Шаблон только СОБИРАЕТ содержимое (заголовок, абзацы, блок фактов, CTA);
 * рисует его общий макет lib/email/layout.ts, отправляет lib/email/send.ts.
 * Так все письма остаются одной системой, а правка текста не трогает вёрстку.
 *
 * Необязательные поля (имя, компания, срок действия, оценка) можно не
 * передавать — строка просто не появится в письме.
 */

import { formatMoment } from './brand'
import type { EmailContent, EmailFact } from './layout'

const nameOrNull = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s ? s : null
}

/** «Здравствуйте, Иван!» либо «Здравствуйте!» — без «, null!». */
function greeting(name: string | null | undefined): string {
  const n = nameOrNull(name)
  return n ? `Здравствуйте, ${n}!` : 'Здравствуйте!'
}

function momentFacts(at: Date | string | number | null | undefined, label: string): EmailFact[] {
  const m = formatMoment(at)
  if (!m) return []
  return [
    { label, value: m.date },
    { label: 'Время', value: m.time },
  ]
}

export interface BuiltEmail {
  subject: string
  content: EmailContent
}

// ─── 1. Приглашение на платформу ─────────────────────────────────────────────

export interface InvitationEmailInput {
  /** Имя приглашённого, если известно. */
  name?: string | null
  /** Компания, от имени которой приглашают (или компания приглашённого). */
  company?: string | null
  /** Человеческое название роли на платформе, если приглашают в роли. */
  roleLabel?: string | null
  /** Личное сообщение пригласившего. */
  note?: string | null
  /** Кто пригласил (email сотрудника). */
  invitedByLabel?: string | null
  invitedAt?: Date | string | null
  expiresAt?: Date | string | null
  /** Ссылка приглашения (одноразовая). */
  url: string
  /** У человека уже есть аккаунт — это ссылка для входа, а не приглашение. */
  existingAccount?: boolean
}

export function buildInvitationEmail(input: InvitationEmailInput): BuiltEmail {
  const existing = !!input.existingAccount
  const company = nameOrNull(input.company)
  const invitedBy = nameOrNull(input.invitedByLabel)
  const expires = formatMoment(input.expiresAt)

  const facts: EmailFact[] = [
    { label: 'Компания', value: company },
    { label: 'Роль на платформе', value: nameOrNull(input.roleLabel) },
    ...momentFacts(input.invitedAt ?? new Date(), existing ? 'Ссылка создана' : 'Приглашение создано'),
    { label: 'Пригласил', value: invitedBy },
    { label: 'Действует до', value: expires ? expires.full : null },
  ]

  return {
    subject: existing ? 'Ссылка для входа в AIStart360' : 'Приглашение в AIStart360',
    content: {
      preheader: existing
        ? 'Одноразовая ссылка для входа в ваш кабинет AIStart360.'
        : 'Примите приглашение и получите доступ к порталу AIStart360.',
      eyebrow: existing ? 'Вход в кабинет' : 'Приглашение',
      title: existing ? 'Ссылка для входа в кабинет' : `Вас пригласили в AIStart360${invitedBy ? '' : ''}`,
      greeting: greeting(input.name),
      paragraphs: existing
        ? ['Нажмите кнопку — и вы попадёте в свой кабинет без ввода пароля.']
        : [
            `${company ? `${company} приглашает вас` : 'Вас приглашают'} на платформу AIStart360 — диагностика бизнеса, «Точка А», GRI-оценка и план роста.`,
            'Что нужно сделать:\n1. Принять приглашение по кнопке ниже.\n2. Задать пароль для входа.\n3. Заполнить анкету — по ней собирается диагностика.',
          ],
      facts,
      quote: nameOrNull(input.note) ? { label: invitedBy ? `Сообщение от ${invitedBy}` : 'Сообщение', text: (input.note as string).trim() } : null,
      cta: { label: existing ? 'Войти в кабинет' : 'Принять приглашение', url: input.url },
      note: expires
        ? `Ссылка срабатывает один раз и действует до ${expires.full}. Если срок истёк — запросите новую у пригласившего.`
        : 'Ссылка срабатывает один раз. Если срок истёк — запросите новую у пригласившего.',
      footnote: 'Если вы не ждали это письмо — просто проигнорируйте его, доступ не откроется.',
    },
  }
}

// ─── 2. Анкета пройдена ──────────────────────────────────────────────────────

export interface QuestionnaireEmailInput {
  name?: string | null
  company?: string | null
  /** Название анкеты. */
  questionnaire?: string | null
  completedSteps: number
  totalSteps: number
  completedAt?: Date | string | null
  /** Абсолютная ссылка на результат в портале. */
  url: string
}

export function buildQuestionnaireCompletedEmail(input: QuestionnaireEmailInput): BuiltEmail {
  const full = input.completedSteps >= input.totalSteps
  const facts: EmailFact[] = [
    { label: 'Анкета', value: nameOrNull(input.questionnaire) ?? 'Диагностическая анкета' },
    { label: 'Статус', value: full ? 'Заполнена полностью' : 'Отправлена' },
    { label: 'Прогресс', value: `${input.completedSteps} из ${input.totalSteps} шагов` },
    ...momentFacts(input.completedAt ?? new Date(), 'Завершено'),
    { label: 'Компания', value: nameOrNull(input.company) },
  ]

  return {
    subject: full ? 'Анкета AIStart360 заполнена' : 'Анкета AIStart360 отправлена',
    content: {
      preheader: full
        ? 'Все шаги заполнены — «Точка А» пересчитана.'
        : 'Анкета отправлена, результат уже в кабинете.',
      eyebrow: 'Анкета',
      title: full ? 'Анкета заполнена' : 'Анкета отправлена',
      greeting: greeting(input.name),
      paragraphs: [
        full
          ? 'Спасибо — данные приняты. «Точка А» пересчитана: в кабинете уже виден снимок текущего состояния и рекомендации.'
          : 'Спасибо — ответы сохранены. Незаполненные шаги можно дополнить в любой момент: чем полнее анкета, тем точнее диагностика.',
        'Следующий шаг — пройти GRI-оценку: она превращает ответы в измеримый индекс зрелости и план на 90 дней.',
      ],
      facts,
      cta: { label: 'Открыть результат', url: input.url },
      footnote: 'Письмо отправлено автоматически по вашему аккаунту AIStart360.',
    },
  }
}

// ─── 2b. Напоминание про анкету ──────────────────────────────────────────────

export interface SurveyReminderEmailInput {
  name?: string | null
  company?: string | null
  completedSteps: number
  totalSteps: number
  /** Названия незаполненных разделов — человеку понятнее номеров шагов. */
  missingSections?: string[]
  /** Кто напомнил (email сотрудника) — письмо не должно выглядеть роботом. */
  fromLabel?: string | null
  note?: string | null
  url: string
}

export function buildSurveyReminderEmail(input: SurveyReminderEmailInput): BuiltEmail {
  const started = input.completedSteps > 0
  const missing = (input.missingSections ?? []).filter(Boolean)
  const facts: EmailFact[] = [
    { label: 'Прогресс', value: `${input.completedSteps} из ${input.totalSteps} шагов` },
    { label: 'Осталось заполнить', value: missing.length ? missing.slice(0, 6).join(', ') : null },
    { label: 'Компания', value: nameOrNull(input.company) },
  ]

  return {
    subject: started ? 'Анкета AIStart360 не дозаполнена' : 'Анкета AIStart360 ещё не начата',
    content: {
      preheader: started
        ? `Осталось ${input.totalSteps - input.completedSteps} шагов до диагностики.`
        : 'Диагностика начинается с анкеты — это 15 минут.',
      eyebrow: 'Анкета',
      title: started ? 'Осталось немного' : 'Начните с анкеты',
      greeting: greeting(input.name),
      paragraphs: [
        started
          ? `Вы заполнили ${input.completedSteps} из ${input.totalSteps} шагов. Пока анкета не закончена, «Точка А» считается по неполным данным, а GRI-оценку запустить нельзя.`
          : 'Чтобы платформа показала, где ваш бизнес теряет деньги, ей нужны исходные данные. Анкета — 12 коротких шагов, примерно 15 минут; можно заполнять частями, прогресс сохраняется.',
        missing.length
          ? `Незаполненными остались разделы: ${missing.join(', ')}.`
          : 'Ответы сохраняются автоматически — можно вернуться в любой момент.',
      ],
      facts,
      quote: nameOrNull(input.note)
        ? { label: input.fromLabel ? `Сообщение от ${input.fromLabel}` : 'Сообщение', text: (input.note as string).trim() }
        : null,
      cta: { label: started ? 'Продолжить анкету' : 'Заполнить анкету', url: input.url },
      footnote: input.fromLabel ? `Напоминание отправил ${input.fromLabel}.` : 'Письмо отправлено автоматически по вашему аккаунту AIStart360.',
    },
  }
}

// ─── 3. GRI пройден ──────────────────────────────────────────────────────────

export interface GriEmailInput {
  name?: string | null
  company?: string | null
  /** Название оценки. */
  assessment?: string | null
  /** Индекс GRI. Включается в письмо только вместе с includeScore. */
  griIndex?: number | null
  /** Показывать ли цифру результата в письме. */
  includeScore?: boolean
  completedAt?: Date | string | null
  url: string
}

export function buildGriCompletedEmail(input: GriEmailInput): BuiltEmail {
  const showScore = input.includeScore !== false && typeof input.griIndex === 'number' && Number.isFinite(input.griIndex)
  const facts: EmailFact[] = [
    { label: 'Оценка', value: nameOrNull(input.assessment) ?? 'GRI — индекс готовности к росту' },
    { label: 'Статус', value: 'Пройдена' },
    { label: 'Индекс GRI', value: showScore ? `${(input.griIndex as number).toFixed(1)} из 10` : null },
    ...momentFacts(input.completedAt ?? new Date(), 'Завершено'),
    { label: 'Компания', value: nameOrNull(input.company) },
  ]

  return {
    subject: 'GRI-оценка пройдена — результат в кабинете',
    content: {
      preheader: 'Результат GRI и план на 90 дней доступны в вашем кабинете.',
      eyebrow: 'GRI',
      title: 'GRI-оценка пройдена',
      greeting: greeting(input.name),
      paragraphs: [
        'Оценка завершена и сохранена. В кабинете уже собраны разбор по разделам, топ-5 ограничений роста и план действий на 90 дней.',
        showScore
          ? 'Индекс ниже — краткая сводка; полная картина с расшифровкой по каждому разделу открывается в портале.'
          : 'Полный результат с расшифровкой по разделам доступен в портале — он показывается только вам после входа.',
      ],
      facts,
      cta: { label: 'Посмотреть результат GRI', url: input.url },
      footnote: 'Письмо отправлено автоматически по вашему аккаунту AIStart360.',
    },
  }
}

// ─── 4. Доступ к порталу открыт ──────────────────────────────────────────────

export interface AccessGrantedEmailInput {
  name?: string | null
  company?: string | null
  roleLabel?: string | null
  grantedAt?: Date | string | null
  url: string
  /** Приписка: что делать дальше. */
  nextStep?: string | null
}

export function buildAccessGrantedEmail(input: AccessGrantedEmailInput): BuiltEmail {
  const facts: EmailFact[] = [
    { label: 'Компания', value: nameOrNull(input.company) },
    { label: 'Роль на платформе', value: nameOrNull(input.roleLabel) },
    ...momentFacts(input.grantedAt ?? new Date(), 'Доступ открыт'),
  ]

  return {
    subject: 'Доступ к AIStart360 открыт',
    content: {
      preheader: 'Заявка одобрена — можно входить в кабинет.',
      eyebrow: 'Доступ',
      title: 'Доступ к порталу открыт',
      greeting: greeting(input.name),
      paragraphs: [
        'Ваша заявка одобрена — кабинет AIStart360 доступен.',
        nameOrNull(input.nextStep) ?? 'Начните с анкеты: по ней собирается «Точка А», а затем GRI-оценка и план роста.',
      ],
      facts,
      cta: { label: 'Войти в кабинет', url: input.url },
      footnote: 'Письмо отправлено автоматически по вашему аккаунту AIStart360.',
    },
  }
}

// ─── 5. Уведомление клиенту (notifyClient) ───────────────────────────────────

export interface ClientNotificationEmailInput {
  /** Тема письма; по умолчанию — заголовок. */
  subject?: string | null
  /** Надпись над заголовком: «GRI», «Напоминание», «Дайджест». */
  eyebrow?: string | null
  title: string
  name?: string | null
  /** Абзацы; переносы строк внутри абзаца сохраняются. */
  paragraphs: string[]
  facts?: EmailFact[]
  ctaLabel?: string | null
  /** Абсолютная ссылка. */
  url?: string | null
  note?: string | null
  /** Приписка в подвале: почему пришло письмо и где его выключить. */
  footnote?: string | null
}

/** Универсальное фирменное письмо для notifyClient и cron-касаний. */
export function buildClientNotificationEmail(input: ClientNotificationEmailInput): BuiltEmail {
  const paragraphs = input.paragraphs.filter((p) => typeof p === 'string' && p.trim() !== '')
  return {
    subject: nameOrNull(input.subject) ?? `${input.title} — AIStart360`,
    content: {
      preheader: (paragraphs[0] ?? input.title).slice(0, 140),
      eyebrow: nameOrNull(input.eyebrow),
      title: input.title,
      greeting: greeting(input.name),
      paragraphs,
      facts: input.facts ?? [],
      cta: input.url ? { label: nameOrNull(input.ctaLabel) ?? 'Открыть кабинет', url: input.url } : null,
      note: nameOrNull(input.note),
      footnote:
        nameOrNull(input.footnote) ??
        'Письмо отправлено автоматически по вашему аккаунту AIStart360. Какие уведомления получать, можно выбрать в «Настройки → Уведомления».',
    },
  }
}
