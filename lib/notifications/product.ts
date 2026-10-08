/**
 * lib/notifications/product.ts — уведомления о событиях продукта.
 *
 * Тонкие обёртки над notifyClient: бизнес-код (маршруты анкеты, GRI, Точки А,
 * документов, одобрения) зовёт одну функцию на событие, а категория, тексты,
 * ссылки и ключи идемпотентности живут здесь, в одном месте.
 */

import { notifyClient, type NotifyClientResult } from '@/lib/notifications/notify'
import {
  buildGriCompletedEmail,
  buildQuestionnaireCompletedEmail,
} from '@/lib/email/templates'
import { getSiteUrl } from '@/lib/site-url'

/**
 * «Анкета принята». Запись в ленте ставит claimCompletionNotice
 * (lib/survey/completion-notice.ts, одна на пользователя), поэтому здесь —
 * только письмо и Telegram по настройкам категории «gri».
 */
export async function notifyQuestionnaireCompleted(
  userId: string,
  input: { name?: string | null; company?: string | null; completedSteps: number; totalSteps: number; completedAt?: Date | string | null },
): Promise<NotifyClientResult> {
  const email = buildQuestionnaireCompletedEmail({ ...input, url: getSiteUrl('/client/point-a') })
  return notifyClient({
    userId,
    category: 'gri',
    event: 'questionnaire_completed',
    title: email.content.title,
    body: 'Спасибо — ответы сохранены, «Точка А» пересчитана. Следующий шаг — GRI-оценка.',
    ctaUrl: '/client/point-a',
    ctaLabel: 'Открыть результат',
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
    typeof input.griIndex === 'number' && Number.isFinite(input.griIndex) ? ` Индекс GRI: ${input.griIndex.toFixed(1)} из 10.` : ''
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

/** «Точка А пересчитана» (категория «reports»). */
export async function notifyPointARecalculated(
  userId: string,
  input: { diagnosticId?: string | null; overallScore?: number | null },
): Promise<NotifyClientResult> {
  const score =
    typeof input.overallScore === 'number' && Number.isFinite(input.overallScore)
      ? ` Общий балл: ${Math.round(input.overallScore)}.`
      : ''
  return notifyClient({
    userId,
    category: 'reports',
    event: 'point_a_recalculated',
    title: '«Точка А» пересчитана',
    body: `Снимок текущего состояния обновлён по последним ответам анкеты.${score}`,
    ctaUrl: '/client/point-a',
    ctaLabel: 'Открыть «Точку А»',
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
