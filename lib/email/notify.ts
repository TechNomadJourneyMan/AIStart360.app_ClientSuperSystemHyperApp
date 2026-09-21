/**
 * lib/email/notify.ts — событийный слой писем.
 *
 * Бизнес-код вызывает именно эти функции (`sendPortalInvitationEmail`,
 * `sendQuestionnaireCompletedEmail`, …), а не Resend напрямую. Так письмо
 * уходит с сервера, с общим макетом, с журналом и с идемпотентностью.
 *
 * События платформы → письма:
 *   InvitationCreated     → sendPortalInvitationEmail
 *   QuestionnaireCompleted→ sendQuestionnaireCompletedEmail
 *   GRICompleted          → sendGriCompletedEmail
 *   PortalAccessGranted   → sendPortalAccessGrantedEmail
 */

import { getSiteUrl } from '@/lib/site-url'
import { sendTransactionalEmail, type TransactionalEmailResult } from './send'
import {
  buildAccessGrantedEmail,
  buildSurveyReminderEmail,
  buildGriCompletedEmail,
  buildInvitationEmail,
  buildQuestionnaireCompletedEmail,
  type AccessGrantedEmailInput,
  type GriEmailInput,
  type InvitationEmailInput,
  type QuestionnaireEmailInput,
  type SurveyReminderEmailInput,
} from './templates'

/** Абсолютная ссылка на страницу портала из относительного пути. */
export function portalUrl(path: string): string {
  return getSiteUrl(path)
}

export async function sendPortalInvitationEmail(
  to: string,
  input: InvitationEmailInput,
  meta?: { userId?: string | null; invitationId?: string | null },
): Promise<TransactionalEmailResult> {
  const { subject, content } = buildInvitationEmail(input)
  return sendTransactionalEmail({
    kind: 'portal_invitation',
    to,
    subject,
    content,
    userId: meta?.userId ?? null,
    // Приглашение можно осознанно переслать — идемпотентность здесь не нужна,
    // повторы ограничивает rate-limit маршрута.
    dedupeKey: null,
    metadata: {
      existingAccount: !!input.existingAccount,
      roleLabel: input.roleLabel ?? null,
      invitationId: meta?.invitationId ?? null,
    },
  })
}

export async function sendQuestionnaireCompletedEmail(
  to: string,
  input: Omit<QuestionnaireEmailInput, 'url'> & { url?: string; userId?: string | null },
): Promise<TransactionalEmailResult> {
  const { subject, content } = buildQuestionnaireCompletedEmail({
    ...input,
    url: input.url ?? portalUrl('/client/point-a'),
  })
  return sendTransactionalEmail({
    kind: 'questionnaire_completed',
    to,
    subject,
    content,
    userId: input.userId ?? null,
    // Одно письмо на пользователя: повторные сохранения анкеты его не поднимут.
    dedupeKey: input.userId ? `questionnaire_completed:${input.userId}` : null,
    metadata: { completedSteps: input.completedSteps, totalSteps: input.totalSteps },
  })
}

export async function sendSurveyReminderEmail(
  to: string,
  input: Omit<SurveyReminderEmailInput, 'url'> & { url?: string; userId?: string | null },
): Promise<TransactionalEmailResult> {
  const { subject, content } = buildSurveyReminderEmail({
    ...input,
    url: input.url ?? portalUrl('/client/onboarding'),
  })
  return sendTransactionalEmail({
    kind: 'survey_reminder',
    to,
    subject,
    content,
    userId: input.userId ?? null,
    // Напоминание — осознанное действие сотрудника, повтор допустим;
    // от спама защищает лимит на маршруте, а не идемпотентность.
    dedupeKey: null,
    metadata: { completedSteps: input.completedSteps, totalSteps: input.totalSteps },
  })
}

export async function sendGriCompletedEmail(
  to: string,
  input: Omit<GriEmailInput, 'url'> & { url?: string; userId?: string | null; assessmentId?: string | null },
): Promise<TransactionalEmailResult> {
  const { subject, content } = buildGriCompletedEmail({
    ...input,
    url: input.url ?? portalUrl('/gri'),
  })
  return sendTransactionalEmail({
    kind: 'gri_completed',
    to,
    subject,
    content,
    userId: input.userId ?? null,
    // Ключ — конкретное прохождение: новый расчёт GRI даёт новое письмо,
    // а повторная обработка того же результата — нет.
    dedupeKey: input.assessmentId ? `gri_completed:${input.assessmentId}` : null,
    metadata: { assessmentId: input.assessmentId ?? null },
  })
}

export async function sendPortalAccessGrantedEmail(
  to: string,
  input: Omit<AccessGrantedEmailInput, 'url'> & { url?: string; userId?: string | null },
): Promise<TransactionalEmailResult> {
  const { subject, content } = buildAccessGrantedEmail({
    ...input,
    url: input.url ?? portalUrl('/login'),
  })
  return sendTransactionalEmail({
    kind: 'portal_access_granted',
    to,
    subject,
    content,
    userId: input.userId ?? null,
    dedupeKey: null,
    metadata: { roleLabel: input.roleLabel ?? null },
  })
}
