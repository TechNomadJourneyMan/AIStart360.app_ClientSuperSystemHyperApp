/**
 * lib/notifications/product.ts — уведомления о событиях продукта.
 *
 * Тонкие обёртки над notifyClient: бизнес-код (маршруты анкеты, GRI, Точки А,
 * документов, одобрения) зовёт одну функцию на событие, а категория, тексты,
 * ссылки и ключи идемпотентности живут здесь, в одном месте.
 */

import { notifyClient, type NotifyClientResult } from '@/lib/notifications/notify'
import { formatGri, toGri } from '@/lib/format/gri'
import {
  buildGriCompletedEmail,
  buildQuestionnaireCompletedEmail,
} from '@/lib/email/templates'
import { getSiteUrl } from '@/lib/site-url'
import { ruLongDate } from '@/lib/format/ru-date'

import { pointAClosedFor } from '@/lib/access/recipient'
import { freeSnapshotAvailable } from '@/lib/survey/modes-server'
import { featureLabel } from '@/lib/access/upgrade-requests'
import { plural } from '@/lib/crm/digest'

// R2-A (ревью L-6): Точка А is a paid section. For an account without it the
// notices name no score and lead to the free «Снимок бизнеса» instead of a paywall.
// R4-B4: the snapshot is a screen of «Экспресс + блоки» (GIGA setting survey_modes);
// while that mode is off the notice leads to the cabinet home and promises no snapshot.

const FREE_SNAPSHOT_URL = '/client/onboarding/snapshot'
const FREE_HOME_URL = '/client/home'

/**
 * «Анкета принята». Запись в ленте ставит claimCompletionNotice
 * (lib/survey/completion-notice.ts, одна на пользователя), поэтому здесь —
 * только письмо и Telegram по настройкам категории «gri».
 */
export async function notifyQuestionnaireCompleted(
  userId: string,
  input: { name?: string | null; company?: string | null; completedSteps: number; totalSteps: number; completedAt?: Date | string | null },
): Promise<NotifyClientResult> {
  const closed = await pointAClosedFor(userId)
  const snapshot = closed && await freeSnapshotAvailable()
  const target = !closed ? '/client/point-a' : snapshot ? FREE_SNAPSHOT_URL : FREE_HOME_URL
  const email = buildQuestionnaireCompletedEmail({ ...input, url: getSiteUrl(target) })
  return notifyClient({
    userId,
    category: 'gri',
    event: 'questionnaire_completed',
    title: email.content.title,
    body: !closed
      ? 'Спасибо — ответы сохранены, «Точка А» пересчитана. Следующий шаг — GRI-оценка.'
      : snapshot
        ? 'Спасибо — ответы сохранены, экспресс-оценка готова. Полный разбор «Точки А» и GRI — в платном доступе.'
        : 'Спасибо — ответы сохранены. Полный разбор «Точки А» и GRI — в платном доступе.',
    ctaUrl: target,
    ctaLabel: !closed ? 'Открыть результат' : snapshot ? 'Открыть снимок' : 'Открыть кабинет',
    // Тот же ключ, что был у письма раньше: уже отправленные письма не повторятся.
    dedupeKey: `questionnaire_completed:${userId}`,
    channels: { inApp: false },
    email: { subject: email.subject, content: email.content, kind: 'questionnaire_completed' },
    metadata: { completedSteps: input.completedSteps, totalSteps: input.totalSteps },
  })
}

/** «GRI пройден»: лента + письмо (категория «gri»). */
export async function notifyGriCompleted(
  userId: string,
  input: { assessmentId?: string | null; name?: string | null; company?: string | null; griIndex?: number | null; completedAt?: Date | string | null },
): Promise<NotifyClientResult> {
  const email = buildGriCompletedEmail({ ...input, url: getSiteUrl('/gri') })
  const score =
    toGri(input.griIndex) !== null ? ` Индекс GRI: ${formatGri(input.griIndex)} из 10.` : ''
  return notifyClient({
    userId,
    category: 'gri',
    event: 'gri_completed',
    title: 'GRI-оценка пройдена',
    body: `Результат сохранён: разбор по разделам, топ-5 ограничений роста и план на 90 дней уже в кабинете.${score}`,
    ctaUrl: '/gri',
    ctaLabel: 'Посмотреть результат GRI',
    priority: 'high',
    dedupeKey: input.assessmentId ? `gri_completed:${input.assessmentId}` : null,
    email: { subject: email.subject, content: email.content, kind: 'gri_completed' },
    metadata: { assessmentId: input.assessmentId ?? null },
  })
}

/**
 * «Доступ открыт» — запись в ленте. Письмо шлёт lib/users/approval.ts (оно
 * там и раньше было и сообщает вызывающему, ушло ли), поэтому email здесь выключен.
 */
export async function notifyAccessGranted(userId: string): Promise<NotifyClientResult> {
  return notifyClient({
    userId,
    category: 'security',
    event: 'access_granted',
    title: 'Доступ к порталу открыт',
    body: 'Заявка одобрена. Начните с анкеты: по ней собирается «Точка А», затем GRI-оценка и план роста.',
    ctaUrl: '/client/onboarding',
    ctaLabel: 'Заполнить анкету',
    priority: 'high',
    channels: { email: false, telegram: false },
  })
}

/**
 * Разделы, которые открывает платный доступ. «Рынок» не называем, пока раздел
 * скрыт от клиентов (на проде market = staff_only; решение PO 2026-11-16, N4B-8).
 */
export const PAID_ACCESS_SECTIONS = 'Точка А, Точка Б и полный GRI'

/** Куда вести за продлением: «Настройки → Биллинг» (заявка менеджеру, N4B-4). */
export const BILLING_SETTINGS_URL = '/settings?tab=billing'

/**
 * R2-C (M-5) + R4 (N4B-2, решение PO 2026-11-16): «Доступ открыт» — менеджер
 * назначил платный тариф (из заявки на доступ, в User 360 → Биллинг, массово).
 * Лента + письмо (категория «security», её нельзя выключить) + Telegram, если
 * клиент привязал чат. `renewed` — тариф уже был платным, его продлили.
 * dedupeKey — заявка, из которой пришло назначение: второй вызов по той же
 * заявке ничего не пришлёт (ни в ленту, ни письмом).
 */
export async function notifyPaidAccessOpened(
  userId: string,
  input: { periodEnd?: string | null; dedupeKey?: string | null; renewed?: boolean } = {},
): Promise<NotifyClientResult> {
  const endDay = ruLongDate(input.periodEnd ?? null, { timeZone: 'UTC' })
  const until = endDay ? ` Доступ действует до ${endDay}.` : ''
  return notifyClient({
    userId,
    category: 'security',
    event: 'paid_access_opened',
    title: input.renewed ? 'Доступ продлён' : 'Доступ открыт',
    body: input.renewed
      ? `Менеджер продлил ваш платный доступ: ${PAID_ACCESS_SECTIONS}.${until}`
      : `Менеджер открыл вам платный доступ: ${PAID_ACCESS_SECTIONS}.${until}`,
    ctaUrl: '/client/home',
    ctaLabel: 'Открыть кабинет',
    priority: 'high',
    dedupeKey: input.dedupeKey ?? null,
    eyebrow: 'Платный доступ',
    // Письмо — по умолчанию категории; Telegram — только если чат привязан.
    channels: { telegram: true },
  })
}

/** Причина одной фразой: без переводов строк, без точки в конце (её ставит текст). */
function reasonText(reason: string | null | undefined): string | null {
  const t = (reason ?? '').replace(/\s+/g, ' ').trim().replace(/[.!…\s]+$/u, '')
  if (!t) return null
  return t.length > 500 ? `${t.slice(0, 499)}…` : t
}

/**
 * R4 (N4B-9): менеджер отклонил заявку на платный доступ — клиенту лента +
 * письмо + Telegram (если привязан), с причиной, если её указали. Одна заявка —
 * одно уведомление (dedupeKey). Новую заявку можно оставить сразу.
 */
export async function notifyAccessRequestRejected(
  userId: string,
  input: { requestId: string; features?: string[] | null; reason?: string | null },
): Promise<NotifyClientResult> {
  const labels = (input.features ?? []).map(featureLabel).filter(Boolean).join(', ')
  const reason = reasonText(input.reason)
  return notifyClient({
    userId,
    category: 'security',
    event: 'access_request_rejected',
    title: 'Заявка на доступ отклонена',
    body:
      `Менеджер отклонил вашу заявку на платный доступ${labels ? ` (${labels})` : ''}.` +
      (reason ? ` Причина: ${reason}.` : '') +
      ' Если есть вопросы — напишите нам в «Сообщениях». Новую заявку можно оставить в любой момент.',
    ctaUrl: '/client/messages',
    ctaLabel: 'Написать в «Сообщения»',
    priority: 'high',
    dedupeKey: `access_request_rejected:${input.requestId}`,
    eyebrow: 'Платный доступ',
    channels: { telegram: true },
    metadata: { requestId: input.requestId, ...(reason ? { reason } : {}) },
  })
}

/**
 * R4 (N4B-10, решение PO 2026-11-16): окончание платного доступа — за 7 дней
 * ('d7'), за сутки ('d1') и когда срок закончился и кабинет переведён на
 * бесплатный ('ended'). Лента + письмо (категория «security»). Ключ —
 * этап + тариф + дата окончания: продление (новая дата) снова предупредит.
 */
export type ProExpiryStage = 'd7' | 'd1' | 'ended'

export function proExpiryText(input: { stage: ProExpiryStage; endsAt: string; daysLeft?: number | null; trial?: boolean }): { title: string; body: string } {
  const day = ruLongDate(input.endsAt, { timeZone: 'UTC' }) ?? 'конца срока'
  const what = input.trial ? 'Пробный доступ' : 'Платный доступ'
  const renew = 'Чтобы продлить, оставьте заявку в «Настройки → Биллинг» — менеджер свяжется с вами. Онлайн-оплата пока не подключена.'
  if (input.stage === 'ended') {
    return {
      title: `${what} закончился`,
      body: `Срок доступа к разделам ${PAID_ACCESS_SECTIONS} закончился (${day}). Кабинет переведён на бесплатный доступ: анкета, документы и экспресс-оценка остаются. ${renew}`,
    }
  }
  if (input.stage === 'd1') {
    return {
      title: `${what} заканчивается меньше чем через сутки`,
      body: `Доступ к разделам ${PAID_ACCESS_SECTIONS} действует до ${day}. ${renew}`,
    }
  }
  const n = Math.max(1, Math.round(input.daysLeft ?? 7))
  const days = `${n} ${plural(n, 'день', 'дня', 'дней')}`
  return {
    title: `${what} заканчивается через ${days}`,
    body: `Доступ к разделам ${PAID_ACCESS_SECTIONS} действует до ${day}. ${renew}`,
  }
}

export async function notifyProExpiry(
  userId: string,
  input: { stage: ProExpiryStage; endsAt: string; dedupeKey: string; daysLeft?: number | null; trial?: boolean },
): Promise<NotifyClientResult> {
  const text = proExpiryText(input)
  return notifyClient({
    userId,
    category: 'security',
    event: input.stage === 'ended' ? 'paid_access_ended' : 'paid_access_expiring',
    title: text.title,
    body: text.body,
    ctaUrl: BILLING_SETTINGS_URL,
    ctaLabel: 'Продлить доступ',
    priority: 'high',
    dedupeKey: input.dedupeKey,
    eyebrow: 'Платный доступ',
    metadata: { stage: input.stage, endsAt: input.endsAt },
  })
}

/** «Точка А пересчитана» (категория «reports»). */
export async function notifyPointARecalculated(
  userId: string,
  input: { diagnosticId?: string | null; overallScore?: number | null },
): Promise<NotifyClientResult> {
  const closed = await pointAClosedFor(userId)
  const snapshot = closed && await freeSnapshotAvailable()
  const score =
    !closed && typeof input.overallScore === 'number' && Number.isFinite(input.overallScore)
      ? ` Общий балл: ${Math.round(input.overallScore)}.`
      : ''
  return notifyClient({
    userId,
    category: 'reports',
    event: 'point_a_recalculated',
    title: !closed ? '«Точка А» пересчитана' : snapshot ? 'Экспресс-оценка обновлена' : 'Оценка по анкете обновлена',
    body: !closed
      ? `Снимок текущего состояния обновлён по последним ответам анкеты.${score}`
      : snapshot
        ? 'Снимок бизнеса обновлён по последним ответам анкеты. Подробный разбор «Точки А» — в платном доступе.'
        : 'Мы пересчитали оценку по последним ответам анкеты. Подробный разбор «Точки А» — в платном доступе.',
    ctaUrl: !closed ? '/client/point-a' : snapshot ? FREE_SNAPSHOT_URL : FREE_HOME_URL,
    ctaLabel: !closed ? 'Открыть «Точку А»' : snapshot ? 'Открыть снимок' : 'Открыть кабинет',
    dedupeKey: input.diagnosticId ? `point_a_recalculated:${input.diagnosticId}` : null,
    metadata: { diagnosticId: input.diagnosticId ?? null },
  })
}

/** «Документ разобран» (категория «reports»). */
export async function notifyDocumentParsed(
  userId: string,
  input: { documentId: string; fileName?: string | null; fieldsCount: number },
): Promise<NotifyClientResult> {
  const name = input.fileName?.trim() ? `«${input.fileName.trim()}»` : 'Документ'
  const found =
    input.fieldsCount > 0
      ? `Найдено показателей: ${input.fieldsCount}. Проверьте их — подтверждённые данные попадут в диагностику.`
      : 'Показателей в документе не нашлось — проверьте, тот ли это файл.'
  return notifyClient({
    userId,
    category: 'reports',
    event: 'document_parsed',
    title: `${name} разобран`,
    body: found,
    ctaUrl: '/client/onboarding/documents',
    ctaLabel: 'Открыть документы',
    dedupeKey: `document_parsed:${input.documentId}`,
    metadata: { documentId: input.documentId, fieldsCount: input.fieldsCount },
  })
}

/** Один абзац для текста уведомления: без переводов строк, не длиннее `max` символов. */
function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * «План Точки Б одобрен» (категория «expert»). Сообщение эксперта в «Сообщения»
 * уже создаёт запись в ленте, поэтому вызывающий выключает inApp здесь.
 */
export async function notifyPointBPlanApproved(
  userId: string,
  input: { versionId: string; first: boolean; inApp?: boolean },
): Promise<NotifyClientResult> {
  return notifyClient({
    userId,
    category: 'expert',
    event: 'point_b_plan_approved',
    title: input.first ? 'План «Точки Б» опубликован' : 'План «Точки Б» обновлён',
    body: input.first
      ? 'Ваш план опубликован. Откройте «Точку Б»: цели, комментарий эксперта и следующие шаги.'
      : 'Новая версия вашего плана уже в кабинете. Что изменилось и почему — в комментарии эксперта.',
    ctaUrl: '/client/point-b',
    ctaLabel: 'Открыть «Точку Б»',
    priority: input.first ? 'high' : 'medium',
    dedupeKey: `point_b_plan_approved:${input.versionId}`,
    channels: input.inApp === false ? { inApp: false } : undefined,
    metadata: { versionId: input.versionId, first: input.first },
  })
}

/** «Эксперт предлагает изменить цель» (категория «expert»); ответ — на странице «Точка Б». */
export async function notifyPointBGoalCorrection(
  userId: string,
  input: { reviewId: string; metricLabel: string; fromText: string; toText: string; reason: string; expertName?: string | null; inApp?: boolean },
): Promise<NotifyClientResult> {
  const who = input.expertName?.trim() ? `Эксперт ${input.expertName.trim()}` : 'Эксперт'
  return notifyClient({
    userId,
    category: 'expert',
    event: 'point_b_goal_corrected',
    title: 'Эксперт предлагает изменить цель',
    body: `${who} предлагает изменить цель «${oneLine(input.metricLabel, 120)}»: ${input.fromText} → ${input.toText}. Причина: ${oneLine(input.reason, 300)}. Ответьте в «Точке Б»: пока вы не согласитесь, цель не изменится.`,
    ctaUrl: '/client/point-b',
    ctaLabel: 'Ответить',
    priority: 'high',
    dedupeKey: `point_b_goal_corrected:${input.reviewId}`,
    channels: input.inApp === false ? { inApp: false } : undefined,
    metadata: { reviewId: input.reviewId },
  })
}
