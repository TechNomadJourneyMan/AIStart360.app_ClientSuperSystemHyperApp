/**
 * «Отчёты» and «Проверка выводов ИИ» — pure view model (labels, tones,
 * formatting). No React, no fetching; unit-tested in
 * tests/unit/giga-crm/reports-ui-model.test.ts.
 */
import type { Tone } from '../kit'
import type { StatusMeta } from '../agents/model'
import { shortActor } from '../agents/model'
import { PROVENANCE_LABELS, SEVERITY_LABELS, type ReportProvenanceType, type ReportSeverity, type ReportStatus } from '@/lib/reports/types'

export const REPORT_STATUS: Record<ReportStatus, StatusMeta> = {
  draft: { label: 'Черновик', tone: 'neutral' },
  ready: { label: 'Готов к проверке', tone: 'amber', hint: 'клиент не видит, пока сотрудник не опубликует' },
  published: { label: 'Опубликован', tone: 'green', hint: 'клиент видит эту версию' },
  superseded: { label: 'Заменён', tone: 'neutral', hint: 'есть более новая версия, или версию отклонили / отозвали' },
  failed: { label: 'Ошибка', tone: 'red' },
}

export function reportStatusMeta(status: string | null | undefined): StatusMeta {
  return (REPORT_STATUS as Record<string, StatusMeta>)[status ?? ''] ?? { label: status || '—', tone: 'neutral' }
}

export const PROVENANCE_TONE: Record<ReportProvenanceType, Tone> = {
  FACT: 'green',
  CALCULATED: 'blue',
  INFERRED: 'neutral',
  AI_HYPOTHESIS: 'violet',
  RECOMMENDATION: 'amber',
}

export function provenanceMeta(type: string | null | undefined): StatusMeta {
  const t = (type ?? '') as ReportProvenanceType
  return PROVENANCE_LABELS[t] ? { label: PROVENANCE_LABELS[t], tone: PROVENANCE_TONE[t] } : { label: type || '—', tone: 'neutral' }
}

export const SEVERITY_TONE: Record<ReportSeverity, Tone> = { critical: 'red', high: 'amber', medium: 'blue', low: 'neutral', info: 'neutral' }

export function severityMeta(sev: string | null | undefined): StatusMeta {
  const s = (sev ?? '') as ReportSeverity
  return SEVERITY_LABELS[s] ? { label: SEVERITY_LABELS[s], tone: SEVERITY_TONE[s] } : { label: sev || '—', tone: 'neutral' }
}

/** «70%», or «—» when unknown. */
export function fmtConfidence(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
}

export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 10) : '—'
}

export function createdByLabel(createdBy: string | null | undefined): string {
  if (createdBy === 'agent:report') return 'агент «Отчёт»'
  return shortActor(createdBy)
}

export const REPORT_TYPE_LABELS: Record<string, string> = { point_a: 'Точка А', full: 'Полная диагностика', gri: 'GRI', point_b: 'Точка Б' }

export const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  survey: 'Анкета', document: 'Документ', metric: 'Метрика', diagnostic: 'Расчёт Точки А', benchmark: 'Ориентир отрасли',
  finding: 'Вывод', platform: 'Платформа',
}

export const NARRATIVE_STATE_LABELS: Record<string, string> = {
  disabled: 'выключено в настройках агента',
  not_needed: 'данные не менялись',
  done: 'добавлено',
  unavailable: 'модель не настроена',
  budget: 'бюджет ИИ исчерпан',
  denied: 'запрещено правами агента',
  failed: 'модель не ответила',
  rejected: 'отклонено проверкой чисел',
}

/** Which actions a person may take on a version in this status. */
export function versionActions(status: string, canPublish: boolean): Array<'publish' | 'reject' | 'withdraw'> {
  if (!canPublish) return []
  if (status === 'ready') return ['publish', 'reject']
  if (status === 'draft') return ['reject']
  if (status === 'published') return ['withdraw']
  return []
}
