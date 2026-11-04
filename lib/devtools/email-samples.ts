/**
 * lib/devtools/email-samples.ts — письма-образцы для «Отправить себе тестовое
 * письмо» (Dev-tools). Те же шаблоны, что у живых писем (lib/email/templates.ts),
 * с демонстрационными данными; помечены «[ТЕСТ]» в теме.
 */
import * as t from '@/lib/email/templates'
import type { BuiltEmail } from '@/lib/email/templates'
import type { EmailKind } from '@/lib/email/send'
import type { TestEmailTemplate } from './tools'

export function buildSampleEmail(template: TestEmailTemplate, opts: { base: string; name?: string | null; now?: Date }): { kind: EmailKind; built: BuiltEmail } {
  const now = opts.now ?? new Date()
  const base = opts.base.replace(/\/+$/, '')
  const name = opts.name ?? null
  const company = 'Тестовая компания'
  const pick = (): { kind: EmailKind; built: BuiltEmail } => {
    switch (template) {
      case 'invitation':
        return { kind: 'portal_invitation', built: t.buildInvitationEmail({
          name, company, roleLabel: 'SuperExpert', invitedByLabel: 'Dev-tools', note: 'Это тестовое письмо из Dev-tools.',
          invitedAt: now, expiresAt: new Date(now.getTime() + 3600_000), url: `${base}/login`,
        }) }
      case 'questionnaire':
        return { kind: 'questionnaire_completed', built: t.buildQuestionnaireCompletedEmail({ name, company, completedSteps: 12, totalSteps: 12, completedAt: now, url: `${base}/client/point-a` }) }
      case 'survey_reminder':
        return { kind: 'survey_reminder', built: t.buildSurveyReminderEmail({ name, company, completedSteps: 5, totalSteps: 12, missingSections: ['Финансы', 'Команда'], url: `${base}/client/onboarding` }) }
      case 'gri':
        return { kind: 'gri_completed', built: t.buildGriCompletedEmail({ name, company, griIndex: 6.8, completedAt: now, url: `${base}/gri` }) }
      case 'access':
        return { kind: 'portal_access_granted', built: t.buildAccessGrantedEmail({ name, company, roleLabel: 'Клиент', grantedAt: now, url: `${base}/login` }) }
      case 'expert_review':
        return { kind: 'expert_review_published', built: t.buildExpertReviewPublishedEmail({ name, expertName: 'Эксперт AIStart360', commentsCount: 3, title: 'Разбор «Точки А»', publishedAt: now, url: `${base}/client/point-a` }) }
      case 'client_notification':
      default:
        return { kind: 'client_notification', built: t.buildClientNotificationEmail({
          title: 'Тестовое уведомление', eyebrow: 'Dev-tools', name,
          paragraphs: ['Это тестовое письмо, отправленное из Dev-tools панели GIGA-CRM.', 'Если вы его видите — почта платформы работает.'],
          url: `${base}/admin-giga-panel/dev-tools`, ctaLabel: 'Открыть Dev-tools',
        }) }
    }
  }
  const out = pick()
  return { kind: out.kind, built: { ...out.built, subject: `[ТЕСТ] ${out.built.subject}` } }
}
