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

import { pointAClosedFor } from '@/lib/access/recipient'

// R2-A (ревью L-6): Точка А is a paid section. For an account without it the
// notices name no score and lead to the free «Снимок бизнеса» instead of a paywall.

const FREE_SNAPSHOT_URL = '/client/onboarding/snapshot'

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
  const target = closed ? FREE_SNAPSHOT_URL : '/client/point-a'
  const email = buildQuestionnaireCompletedEmail({ ...input, url: getSiteUrl(target) })
  return notifyClient({
    userId,
    category: 'gri',
    event: 'questionnaire_completed',
    title: email.content.title,
    body: closed
      ? 'Спасибо — ответы сохранены, экспресс-оценка готова. Полный разбор «Точки А» и GRI — в платном доступе.'
      : 'Спасибо — ответы сохранены, «Точка А» пересчитана. Следующий шаг — GRI-оценка.',
    ctaUrl: target,
    ctaLabel: closed ? 'Открыть снимок' : 'Открыть результат',
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
 * R2-C (M-5): «Доступ открыт» — менеджер назначил платный тариф (из заявки на
 * доступ или в User 360 → Биллинг). Запись в ленте уведомлений клиента
 * (категория «security», её нельзя выключить); другие каналы не используются.
 * dedupeKey — заявка, из которой пришло назначение: второй вызов по той же
 * заявке ничего не пришлёт.
 */
export async function notifyPaidAccessOpened(
  userId: string,
  input: { periodEnd?: string | null; dedupeKey?: string | null } = {},
): Promise<NotifyClientResult> {
  const end = input.periodEnd ? new Date(input.periodEnd) : null
  const until = end && !Number.isNaN(end.getTime())
    ? ` Доступ действует до ${end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.`
    : ''
  return notifyClient({
    userId,
    category: 'security',
    event: 'paid_access_opened',
    title: 'Доступ открыт',
    body: `Менеджер открыл вам платный доступ: Точка А, Точка Б, Рынок и полный GRI.${until}`,
    ctaUrl: '/client/home',
    ctaLabel: 'Открыть кабинет',
    priority: 'high',
    dedupeKey: input.dedupeKey ?? null,
    channels: { email: false, telegram: false },
  })
}

/** «Точка А пересчитана» (категория «reports»). */
export async function notifyPointARecalculated(
  userId: string,
  input: { diagnosticId?: string | null; overallScore?: number | null },
): Promise<NotifyClientResult> {
  const closed = await pointAClosedFor(userId)
  const score =
    !closed && typeof input.overallScore === 'number' && Number.isFinite(input.overallScore)
      ? ` Общий балл: ${Math.round(input.overallScore)}.`
      : ''
  return notifyClient({
    userId,
    category: 'reports',
    event: 'point_a_recalculated',
    title: closed ? 'Экспресс-оценка обновлена' : '«Точка А» пересчитана',
    body: closed
      ? 'Снимок бизнеса обновлён по последним ответам анкеты. Подробный разбор «Точки А» — в платном доступе.'
      : `Снимок текущего состояния обновлён по последним ответам анкеты.${score}`,
    ctaUrl: closed ? FREE_SNAPSHOT_URL : '/client/point-a',
    ctaLabel: closed ? 'Открыть снимок' : 'Открыть «Точку А»',
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
