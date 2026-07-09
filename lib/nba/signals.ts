/**
 * lib/nba/signals.ts — build Next Best Action signals from domain data.
 *
 * Pure transform: the API route fetches the raw domain objects (Point A red
 * zones, GRI top-5, plan tasks, pulse age, survey completion, CRM reminders)
 * and hands them here as a flat, decoupled input; the resulting NbaSignal[]
 * feeds selectNextBestAction(). Keeping this pure (no DB, no domain-type
 * coupling) makes the scoring path fully unit-testable.
 * Spec: docs/SPEC-2026-07-09-AI-FEATURES/02-next-best-action-plan.md §A2.
 */

import type { NbaSignal } from './select'

export interface NbaSignalInput {
  /** Point A blocks currently in the red zone. */
  redBlocks?: Array<{ key: string; label: string; score: number }>
  /** The single most important GRI limitation (top_5_limits[0]). */
  griMainLimit?: { criterionText: string; blockName: string } | null
  /** Survey completion 0..1. */
  surveyCompletion?: number | null
  /** Next unfinished 90-day plan task. */
  planNextTask?: { id: string; title: string } | null
  daysSincePulse?: number | null
  griAssessmentAgeDays?: number | null
  hasPsychProfile?: boolean
  /** Whether a GRI assessment / report exists. */
  hasReport?: boolean
  documentsCount?: number
  /** Overdue CRM reminders [DEP: GRI/CRM]. */
  crmOverdue?: { count: number; sampleName?: string } | null
}

const SURVEY_DONE_THRESHOLD = 0.7
const PULSE_STALE_DAYS = 14
const RESCAN_DUE_DAYS = 90

export function buildNbaSignals(input: NbaSignalInput): NbaSignal[] {
  const signals: NbaSignal[] = []

  // S1 — overdue CRM reminders.
  if (input.crmOverdue && input.crmOverdue.count > 0) {
    const { count, sampleName } = input.crmOverdue
    signals.push({
      key: 'crm_overdue',
      actionKey: 'crm_overdue',
      active: true,
      count,
      title: count === 1 ? 'Связаться с клиентом из CRM' : `Связаться с ${count} клиентами из CRM`,
      reason: sampleName
        ? `Просрочены контакты, например ${sampleName}. Тёплые лиды остывают без касания.`
        : `${count} просроченных напоминаний в CRM.`,
      cta: { label: 'Открыть CRM', href: '/clients' },
      source: { type: 'crm', ref: 'reminders' },
    })
  }

  // S2 — the single worst red-zone block.
  if (input.redBlocks && input.redBlocks.length > 0) {
    const worst = [...input.redBlocks].sort((a, b) => a.score - b.score)[0]
    signals.push({
      key: 'red_zone',
      actionKey: `red_zone:${worst.key}`,
      active: true,
      title: `Заняться блоком «${worst.label}»`,
      reason: `Красная зона Точки А: ${worst.label} — ${worst.score}/100.`,
      cta: { label: 'Открыть Точку А', href: '/point-a' },
      source: { type: 'point_a', ref: worst.key },
    })
  }

  // S3 — the main GRI limitation.
  if (input.griMainLimit) {
    const { criterionText, blockName } = input.griMainLimit
    signals.push({
      key: 'gri_limit',
      actionKey: 'gri_limit:main',
      active: true,
      title: `Устранить ограничение: ${criterionText}`,
      reason: `Главное ограничение GRI в блоке «${blockName}».`,
      cta: { label: 'Открыть GRI', href: '/gri' },
      source: { type: 'gri_top5', ref: '0' },
    })
  }

  // S4 — unfinished survey.
  if (input.surveyCompletion != null && input.surveyCompletion < SURVEY_DONE_THRESHOLD) {
    const pct = Math.round(input.surveyCompletion * 100)
    signals.push({
      key: 'survey_incomplete',
      actionKey: 'survey_incomplete',
      active: true,
      title: 'Завершить диагностику',
      reason: `Анкета заполнена на ${pct}%. Без неё оценка неполная.`,
      cta: { label: 'Продолжить анкету', href: '/client/onboarding' },
      source: { type: 'survey' },
    })
  }

  // S5 — next plan task.
  if (input.planNextTask) {
    signals.push({
      key: 'plan_task',
      actionKey: `plan_task:${input.planNextTask.id}`,
      active: true,
      title: input.planNextTask.title,
      reason: 'Следующий шаг вашего плана на 90 дней.',
      cta: { label: 'Открыть план', href: '/gri' },
      source: { type: 'action_plan', ref: input.planNextTask.id },
    })
  }

  // S6 — stale pulse.
  if (input.daysSincePulse != null && input.daysSincePulse > PULSE_STALE_DAYS) {
    signals.push({
      key: 'pulse_stale',
      actionKey: 'pulse_stale',
      active: true,
      title: 'Снять пульс за 2 минуты',
      reason: `Пульс не снимался ${input.daysSincePulse} дней — динамику не видно.`,
      cta: { label: 'Снять пульс', href: '/gri' },
      source: { type: 'pulse' },
    })
  }

  // S7 — GRI re-scan due.
  if (input.griAssessmentAgeDays != null && input.griAssessmentAgeDays > RESCAN_DUE_DAYS) {
    signals.push({
      key: 'gri_rescan',
      actionKey: 'gri_rescan',
      active: true,
      title: 'Переснять GRI',
      reason: `Прошло ${input.griAssessmentAgeDays} дней с последней диагностики — пора обновить.`,
      cta: { label: 'Переснять GRI', href: '/gri' },
      source: { type: 'gri' },
    })
  }

  // S8 — psych profile missing (only meaningful once there is a report).
  if (input.hasReport && !input.hasPsychProfile) {
    signals.push({
      key: 'psych_missing',
      actionKey: 'psych_missing',
      active: true,
      title: 'Заполнить психопрофиль фаундера',
      reason: 'ГРИ будет отвечать под ваш стиль управления.',
      cta: { label: 'Открыть психопрофиль', href: '/profile/psych' },
      source: { type: 'psych_profile' },
    })
  }

  // S9 — no documents yet (only after the survey is largely done).
  if ((input.surveyCompletion ?? 0) >= SURVEY_DONE_THRESHOLD && (input.documentsCount ?? 0) === 0) {
    signals.push({
      key: 'docs_missing',
      actionKey: 'docs_missing',
      active: true,
      title: 'Загрузить финансовые документы',
      reason: 'С документами (P&L, выгрузки) диагностика и ответы ГРИ точнее.',
      cta: { label: 'Загрузить', href: '/client/onboarding' },
      source: { type: 'documents' },
    })
  }

  return signals
}
