/**
 * Platform events → staff notifications. Decides the level and the wording;
 * notifyStaff decides who gets it on which channel (staff Telegram = the admin
 * bot once configured). Experts linked in the expert bot additionally get
 * DIAGNOSTIC_COMPLETED (lib/telegram/bots/expert/notify.ts), and experts with
 * an opted-in WhatsApp number get the same notice there (lib/whatsapp/experts.ts). INFO-level events only
 * land in the admin feed by default (Telegram threshold is WARNING).
 */
import { prisma } from '@/lib/db'
import type { PlatformEventRow } from '@/lib/events/platform'
import { notifyStaff, type StaffNotification } from './staff'

async function companyName(companyId: string | null): Promise<string | null> {
  if (!companyId) return null
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT name FROM public.companies WHERE id = ${companyId}`
  return rows[0]?.name ?? null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Build the notification for an event, or null when it is not worth telling anyone. */
export async function notificationForEvent(e: PlatformEventRow): Promise<StaffNotification | null> {
  const p = e.payload ?? {}
  const client = await companyName(e.company_id)
  const clientLine = client ? `Клиент: ${client}` : null
  const base = { companyId: e.company_id, entityType: e.subject_type, entityId: e.subject_id, dedupeKey: `event:${e.id}` }

  switch (e.name) {
    case 'DIAGNOSTIC_COMPLETED': {
      const lines = [
        clientLine,
        num(p.score) !== null ? `Score: ${num(p.score)}/100` : null,
        num(p.critical_findings) !== null ? `Критических выводов: ${num(p.critical_findings)}` : null,
        num(p.files_processed) !== null ? `Файлов обработано: ${num(p.files_processed)}` : null,
        num(p.metrics_calculated) !== null ? `Метрик рассчитано: ${num(p.metrics_calculated)}` : null,
        p.report_generated === true ? 'Отчёт сформирован.' : null,
        str(p.agent_name) ? `Агент: ${str(p.agent_name)}` : null,
      ].filter((l): l is string => Boolean(l))
      return { ...base, level: 'SUCCESS', type: 'diagnostic.completed', title: 'Диагностика завершена', lines, agentKey: str(p.agent_key) }
    }
    case 'CRITICAL_RISK_FOUND': {
      // A model hypothesis is not a finding until a person checks it.
      const hypothesis = p.provenance === 'AI_HYPOTHESIS' || p.needs_review === true
      return {
        ...base,
        level: hypothesis ? 'WARNING' : 'CRITICAL',
        type: hypothesis ? 'diagnostic.critical_hypothesis' : 'diagnostic.critical_risk',
        title: hypothesis ? 'ИИ предполагает критический риск — нужна проверка' : 'Найден критический риск',
        lines: [clientLine, str(p.title), str(p.area) ? `Область: ${str(p.area)}` : null].filter((l): l is string => Boolean(l)),
        agentKey: str(p.agent_key),
      }
    }
    case 'AGENT_FAILED':
      // Dead-letter is told by the agent notifier (lib/agents/lifecycle.ts) as
      // CRITICAL with «Открыть» / «Повторить» buttons — one message, not two.
      return null
    case 'APPROVAL_REQUESTED':
      return {
        ...base, level: 'APPROVAL_REQUIRED', type: 'agent.approval', title: 'Агент просит одобрения',
        lines: [
          str(p.summary) ?? 'Действие агента',
          `Агент: ${str(p.agent_key) ?? '—'}`,
          clientLine,
          str(p.permission) ? `Право: ${str(p.permission)}` : null,
          'Решение действует один раз; без ответа заявка истечёт через 24 ч.',
        ].filter((l): l is string => Boolean(l)),
        approvalId: str(p.approval_id),
        agentKey: str(p.agent_key),
        link: '/admin-giga-panel/agents/approvals',
      }
    case 'INTEGRATION_FAILED':
      return {
        ...base, level: 'WARNING', type: 'integration.failed', title: 'Интеграция недоступна',
        lines: [clientLine, str(p.provider) ? `Интеграция: ${str(p.provider)}` : null, str(p.error) ? `Ошибка: ${str(p.error)}` : null]
          .filter((l): l is string => Boolean(l)),
      }
    case 'DIAGNOSTIC_STARTED':
      return { ...base, level: 'INFO', type: 'diagnostic.started', title: 'Диагностика запущена', lines: clientLine ? [clientLine] : [] }
    case 'QUESTIONNAIRE_COMPLETED':
      return { ...base, level: 'INFO', type: 'survey.completed', title: 'Анкета заполнена', lines: clientLine ? [clientLine] : [] }
    case 'CLIENT_CREATED':
      return { ...base, level: 'INFO', type: 'client.created', title: 'Новый клиент', lines: clientLine ? [clientLine] : [] }
    case 'REPORT_GENERATED': {
      // A new report version waits for a person: nothing reaches the client until it is published.
      const hidden = (num(p.hidden_hypotheses) ?? 0) + (num(p.unreviewed_model_recommendations) ?? 0)
      const lines = [
        clientLine,
        num(p.version) !== null ? `Версия ${num(p.version)} — ждёт проверки и публикации` : 'Ждёт проверки и публикации',
        num(p.findings) !== null ? `Выводов: ${num(p.findings)}, рекомендаций: ${num(p.recommendations) ?? 0}` : null,
        hidden ? `Выводов ИИ на проверке (в отчёт не вошли): ${hidden}` : null,
      ].filter((l): l is string => Boolean(l))
      return {
        ...base, level: 'SUCCESS', type: 'report.generated', title: 'Отчёт сформирован', lines,
        agentKey: str(p.agent_key),
        link: e.subject_id ? `/admin-giga-panel/reports?focus=${e.subject_id}` : '/admin-giga-panel/reports',
      }
    }
    default:
      // FILE_UPLOADED / FILE_PROCESSED / METRIC_UPDATED / ONBOARDING_COMPLETED: activity, not news.
      return null
  }
}

export async function routeEventToStaff(e: PlatformEventRow): Promise<void> {
  const n = await notificationForEvent(e)
  if (n) await notifyStaff(n)
  // Experts linked in the expert bot (DIAGNOSTIC_COMPLETED); a no-op until it is configured.
  try {
    const { routeEventToExperts } = await import('@/lib/telegram/bots/expert/notify')
    await routeEventToExperts(e)
  } catch (err) {
    console.error('[notifications] expert routing failed:', err instanceof Error ? err.message.split('\n')[0] : err)
  }
  // The same expert notice in WhatsApp; a no-op until Cloud API is configured.
  try {
    const { routeEventToExpertsWhatsApp } = await import('@/lib/whatsapp/experts')
    await routeEventToExpertsWhatsApp(e)
  } catch (err) {
    console.error('[notifications] expert whatsapp routing failed:', err instanceof Error ? err.message.split('\n')[0] : err)
  }
}
