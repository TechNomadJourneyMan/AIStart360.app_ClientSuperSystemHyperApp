/**
 * lib/automation/reminders.ts — ежедневные напоминания клиентам (F-057)
 * и приветственная серия (F-058). Вызывается из /api/cron/reminders.
 *
 * Планировщик (planReminders) — чистая функция: по состоянию клиента решает,
 * какие касания ему положены, в порядке важности. Раннер (runReminders)
 * отправляет через notifyClient не больше ОДНОГО касания на клиента за
 * запуск; потолок в неделю, общий выключатель и идемпотентность — внутри
 * notifyClient (automation_sends + email_deliveries).
 *
 * Правила (все — только для одобренных клиентов, status = approved):
 *   gri_draft   черновик GRI не менялся 3–30 дней → «продолжить с блока X»;
 *               ключ gri_draft_reminder:<user>:<дата черновика> — раз на черновик.
 *   survey      шаг 1 анкеты заполнен, анкета не отправлена, изменений нет
 *               3 / 7 / 14 дней (до 30) → «Вы остановились на шаге N»;
 *               ключ survey_reminder:d7:<user>:<понедельник недели последнего
 *               изменения> — каждая стадия раз на «эпизод застревания».
 *   welcome     шаг 1 не заполнен: D1 / D3 / D7 после открытия доступа
 *               (до 14 дней) → с чего начать; ключ welcome:d3:<user>.
 *   gri_start   Точка А есть 7–60 дней, GRI не начат → «пройдите GRI»;
 *               ключ gri_start_reminder:<user> — один раз.
 *   pulse       по пятницам: стрик пульса ≥ 2, на этой неделе пульса
 *               нет → «не прерывайте серию»; ключ pulse_reminder:<user>:<понедельник>.
 *               В субботу — тем, до кого в пятницу не дошло ни одно автоматическое
 *               напоминание (прогон упёрся в бюджет, ревью волны 1A); ключ тот же,
 *               поэтому дважды за неделю не уйдёт.
 *
 * Отложенное бюджетом (R-015) уходит в следующий ежедневный прогон (06:00 UTC):
 * окна касаний длятся днями, ключи от дня к дню не меняются, а уже отправленные
 * касания отбрасываются до старта прогона (один запрос к журналу), чтобы не
 * тратить на них бюджет. Исключение — пульс (только пятница): для него суббота.
 */

import { notifyClient, type NotifyClientResult } from '@/lib/notifications/notify'
import { completedStepsFromRows, SURVEY_KEY_STEP, SURVEY_TOTAL_STEPS, type SurveyStepRow } from '@/lib/survey/steps'
import { SURVEY_STEP_LABELS } from '@/lib/survey-labels'
import { GRI_BLOCK_RU } from '@/lib/gri-assessment/labels'
import { computePulseStreak } from '@/lib/gri/pulse-streak'
import {
  fetchClientStates,
  fetchGriDrafts,
  fetchPulseWeeks,
  fetchSentDedupeKeys,
  fetchSurveyRows,
  fetchTouchedSince,
  type ClientState,
  type GriDraft,
} from '@/lib/automation/data'
import { addDays, daysBetween, isoWeekday, localDate, mondayOf, startOfLocalDay } from '@/lib/automation/time'
import { fetchSurveyModes, type SurveyModeFacts } from '@/lib/automation/survey-modes'
import { fromAnswerEnvelope } from '@/lib/survey/answer-value'
import { expressSummary } from '@/lib/survey/express'
import { recommendedBlocks } from '@/lib/survey/blocks'
import { formatAttributionDate } from '@/lib/survey/attribution-label'
import { maintenanceSkipReason, type MaintenanceSkipReason } from '@/lib/automation/maintenance-gate'
import { dayRotation, runBudget, type RunBudget } from '@/lib/automation/run-budget'
import { beforeDeadline, runBounded } from '@/lib/crm/bounded-run'
import type { SurveyMode } from '@/lib/survey/modes'
import { getSurveyModes } from '@/lib/survey/modes-server'

export type ReminderKind = 'gri_draft_reminder' | 'survey_reminder' | 'welcome' | 'gri_start_reminder' | 'pulse_reminder'

export interface PlannedTouch {
  userId: string
  kind: ReminderKind
  /** Стадия внутри вида: d1/d3/d7/d14. */
  stage?: string
  dedupeKey: string
  title: string
  body: string
  ctaUrl: string
  ctaLabel: string
  eyebrow: string
}

export interface ReminderInput {
  state: ClientState
  /** Заполненные шаги анкеты (из ответов через lib/survey/steps). */
  surveySteps: number[]
  draft: GriDraft | null
  pulseWeeks: string[]
  /**
   * The questionnaire mode (survey Ф5): the express done → «уточните блоки»;
   * the express / the chat in progress → back to that mode. Absent → the classic
   * «N из 12 шагов».
   */
  survey?: SurveyModeFacts & { answers?: Readonly<Record<string, unknown>> }
  /**
   * R4 W3B-7: the modes switched on in GIGA (getSurveyModes().enabled). A mode
   * that is off gets the classic «шаг N» text into the full questionnaire, not a
   * link to its page. Absent → every mode (as before the setting).
   */
  enabledModes?: readonly SurveyMode[]
  /**
   * Review of wave 1A: on SATURDAY the pulse reminder is planned only with this flag — the client
   * was due on Friday and no automatic reminder reached them then (the run's budget was spent).
   */
  pulseCatchUp?: boolean
}

const QUESTION_COUNT = Object.keys(SURVEY_KEY_STEP).length
/** ~20 секунд на вопрос — честная оценка, а не «15 минут». */
const SECONDS_PER_QUESTION = 20

function roundMinutes(questions: number): number {
  return Math.max(5, Math.round((questions * SECONDS_PER_QUESTION) / 60 / 5) * 5)
}

/** Сколько вопросов на шаге N (по таблице lib/survey/steps.ts). */
export function questionsOnStep(step: number): number {
  return Object.values(SURVEY_KEY_STEP).filter((s) => s === step).length
}

/** Первый незаполненный шаг 1..12 или null, если заполнены все. */
export function firstMissingStep(filled: number[]): number | null {
  const set = new Set(filled)
  for (let n = 1; n <= SURVEY_TOTAL_STEPS; n++) if (!set.has(n)) return n
  return null
}

/** Первый незавершённый блок GRI (порядок блоков методики). */
export function nextGriBlock(completedSections: Record<string, boolean>): string | null {
  for (const [id, label] of Object.entries(GRI_BLOCK_RU)) if (!completedSections[id]) return label
  return null
}

function stepLabel(n: number): string {
  return SURVEY_STEP_LABELS[n] ? `${n} «${SURVEY_STEP_LABELS[n]}»` : String(n)
}

function surveyStage(ageDays: number): 'd3' | 'd7' | 'd14' | null {
  if (ageDays > 30) return null
  if (ageDays >= 14) return 'd14'
  if (ageDays >= 7) return 'd7'
  if (ageDays >= 3) return 'd3'
  return null
}

function welcomeStage(ageDays: number): 'd1' | 'd3' | 'd7' | null {
  if (ageDays > 14) return null
  if (ageDays >= 7) return 'd7'
  if (ageDays >= 3) return 'd3'
  if (ageDays >= 1) return 'd1'
  return null
}

function welcomeTouch(userId: string, stage: 'd1' | 'd3' | 'd7'): PlannedTouch {
  const totalMin = roundMinutes(QUESTION_COUNT)
  const step1Min = roundMinutes(questionsOnStep(1))
  const url = '/client/onboarding?step=1'
  const common = { userId, kind: 'welcome' as const, stage, dedupeKey: `welcome:${stage}:${userId}`, ctaUrl: url, eyebrow: 'Первые шаги' }
  if (stage === 'd1') {
    return {
      ...common,
      title: 'С чего начать в AIStart360',
      body:
        `Первый шаг — анкета о бизнесе: ${SURVEY_TOTAL_STEPS} шагов, около ${QUESTION_COUNT} вопросов. Если отвечать подробно, это примерно ${totalMin} минут, но заполнять можно частями — ответы сохраняются.\n\n` +
        `Начните с шага 1 «${SURVEY_STEP_LABELS[1]}» — это около ${step1Min} минут: название, отрасль, выручка и цели. Остальные шаги можно дополнить позже.`,
      ctaLabel: 'Начать анкету',
    }
  }
  if (stage === 'd3') {
    return {
      ...common,
      title: 'Что даст анкета',
      body:
        'По ответам платформа соберёт «Точку А» — снимок текущего состояния бизнеса с красными зонами, затем GRI-оценку и план на 90 дней.\n\n' +
        `Без анкеты этих расчётов нет: данных просто не из чего считать. Шаг 1 занимает около ${step1Min} минут.`,
      ctaLabel: 'Заполнить шаг 1',
    }
  }
  return {
    ...common,
    title: 'Помочь с анкетой?',
    body:
      `Анкета пока не начата. Если непонятно, что писать, или не хватает цифр — напишите нам (адрес поддержки внизу письма), и мы поможем. Заполнять можно примерно: точность растёт по мере того, как вы дополняете ответы.\n\n` +
      `Весь путь — ${SURVEY_TOTAL_STEPS} шагов, около ${totalMin} минут. Начать можно с 5 минут на шаг 1.`,
    ctaLabel: 'Открыть анкету',
  }
}

type SurveyTouchText = Pick<PlannedTouch, 'title' | 'body' | 'ctaUrl' | 'ctaLabel'>

/** «Вы остановились на шаге N» — the full questionnaire (as before survey Ф5). */
function classicSurveyTouch(input: ReminderInput, age: number): SurveyTouchText | null {
  const step = firstMissingStep(input.surveySteps)
  if (!step) return null
  const left = SURVEY_TOTAL_STEPS - input.surveySteps.length
  return {
    title: `Вы остановились на шаге ${step}`,
    body:
      `Анкета заполнена на ${input.surveySteps.length} из ${SURVEY_TOTAL_STEPS} шагов, последний раз вы её меняли ${age} дн. назад. ` +
      `Следующий — шаг ${stepLabel(step)}, около ${roundMinutes(questionsOnStep(step))} минут.\n\n` +
      `Пока анкета не отправлена, «Точка А» считается по неполным данным. Осталось шагов: ${left}; незаполненные можно пропустить и отправить анкету как есть.`,
    ctaUrl: `/client/onboarding?step=${step}`,
    ctaLabel: `Продолжить с шага ${step}`,
  }
}

/**
 * The reminder in the client's mode (survey Ф5; PO §18.3 item 1 — only the full
 * questionnaire is «отправлена», so the express never ends the reminders):
 *   express done      → «Первичная Точка А готова — уточните её»: three blocks, the full questionnaire;
 *   express started   → «Продолжите быстрый старт»;
 *   the chat          → «Продолжите беседу с помощником».
 * null → the classic text.
 */
export function modeSurveyTouch(input: ReminderInput, age: number): SurveyTouchText | null {
  const s = input.survey
  if (!s) return null
  // W3B-7: never into a mode switched off in GIGA — then the chat (if on) or the classic text (the full questionnaire).
  const on = (m: SurveyMode) => !input.enabledModes || input.enabledModes.includes(m)
  const answers = s.answers ?? {}
  if (s.expressCompletedAt && on('express')) {
    const blocks = recommendedBlocks(answers, null, 3).map((r) => `«${r.block.title}» (~${r.block.minutes} мин)`)
    return {
      title: 'Первичная Точка А готова — уточните её',
      body:
        `Быстрый старт пройден ${formatAttributionDate(s.expressCompletedAt) ?? ''}: Точка А посчитана по быстрым данным, последний раз вы меняли ответы ${age} дн. назад. ` +
        (blocks.length ? `Чтобы оценка стала точнее, ответьте на блоки — начните с ${blocks.join(', ')}.` : 'Чтобы оценка стала полной, проверьте и дополните ответы.') +
        '\n\nПолная анкета ещё не отправлена: эксперт получит полную картину бизнеса после отправки. Ответы быстрого старта уже в ней — повторно вводить не нужно.',
      ctaUrl: '/client/onboarding/blocks',
      ctaLabel: 'Открыть блоки',
    }
  }
  if (s.mode === 'express' && !s.expressCompletedAt && on('express')) {
    const e = expressSummary(answers)
    const left = Math.max(1, Math.round((e.skipped * SECONDS_PER_QUESTION) / 60))
    return {
      title: 'Продолжите быстрый старт',
      body:
        `Отвечено ${e.answered} из ${e.total} вопросов быстрого старта, последний раз ${age} дн. назад. Осталось около ${left} мин — ` +
        'после этого появятся снимок бизнеса и первичная Точка А. Если цифры нет под рукой, отвечайте «не знаю» или «примерно».',
      ctaUrl: '/client/onboarding/express',
      ctaLabel: 'Продолжить быстрый старт',
    }
  }
  if (s.mode === 'chat' && on('chat')) {
    return {
      title: 'Продолжите беседу с помощником анкеты',
      body:
        `Анкета заполнена на ${input.surveySteps.length} из ${SURVEY_TOTAL_STEPS} шагов, последний раз ${age} дн. назад. ` +
        'Помощник продолжит с вопроса, на котором вы остановились, объяснит его и подскажет, где взять цифру. В анкету попадает только то, что вы подтвердите.',
      ctaUrl: '/client/onboarding/chat',
      ctaLabel: 'Продолжить беседу',
    }
  }
  return null
}

/**
 * Все положенные клиенту касания, от важного к менее важному.
 * Раннер отправит первое, которое ещё не уходило (dedupe) и не упрётся в потолок.
 */
export function planReminders(input: ReminderInput, now: Date): PlannedTouch[] {
  const { state } = input
  if (state.status !== 'approved') return []
  const userId = state.user_id
  const out: PlannedTouch[] = []
  const step1Done = input.surveySteps.includes(1)

  // gri_draft — черновик GRI заброшен.
  if (input.draft) {
    const age = daysBetween(input.draft.updatedAt, now)
    if (age >= 3 && age <= 30) {
      const block = nextGriBlock(input.draft.completedSections)
      out.push({
        userId,
        kind: 'gri_draft_reminder',
        dedupeKey: `gri_draft_reminder:${userId}:${localDate(new Date(input.draft.updatedAt))}`,
        title: block ? `Продолжите GRI с блока «${block}»` : 'Завершите GRI-оценку',
        body: block
          ? `Вы начали GRI-оценку ${age} дн. назад, ответы сохранены. Осталось продолжить с блока «${block}» — результат и план на 90 дней появятся сразу после последнего блока.`
          : `Все блоки GRI заполнены, но оценка не отправлена. Нажмите «Рассчитать», чтобы получить индекс и план на 90 дней.`,
        ctaUrl: '/gri?tab=assess',
        ctaLabel: 'Продолжить GRI',
        eyebrow: 'GRI',
      })
    }
  }

  // survey / welcome — анкета.
  if (!state.survey_completed) {
    const mode = input.survey
    // The express / chat may start without step 1 (survey Ф5): they count as «начата» too.
    const modeStarted = !!mode?.expressCompletedAt || ((mode?.mode === 'express' || mode?.mode === 'chat') && input.surveySteps.length > 0)
    if (step1Done || modeStarted) {
      const last = state.survey_last_change_at ?? state.survey_first_at
      const age = last ? daysBetween(last, now) : -1
      const stage = surveyStage(age)
      if (stage && last) {
        const dedupeKey = `survey_reminder:${stage}:${userId}:${mondayOf(localDate(new Date(last)))}`
        const touch = modeSurveyTouch(input, age) ?? classicSurveyTouch(input, age)
        if (touch) out.push({ userId, kind: 'survey_reminder', stage, dedupeKey, eyebrow: 'Анкета', ...touch })
      }
    } else {
      const anchor = state.approved_at ?? state.registered_at
      const stage = anchor ? welcomeStage(daysBetween(anchor, now)) : null
      if (stage) out.push(welcomeTouch(userId, stage))
    }
  }

  // gri_start — Точка А есть, GRI не начат.
  if (state.point_a_at && !state.gri_started_at && !input.draft) {
    const age = daysBetween(state.point_a_at, now)
    if (age >= 7 && age <= 60) {
      out.push({
        userId,
        kind: 'gri_start_reminder',
        dedupeKey: `gri_start_reminder:${userId}`,
        title: 'Следующий шаг — GRI-оценка',
        body:
          `«Точка А» готова уже ${age} дн. Она показывает, где бизнес сейчас; GRI-оценка — насколько он готов к росту и что мешает больше всего.\n\n` +
          'По итогам GRI вы получите индекс по 7 блокам, топ-5 ограничений и план на 90 дней. Проходить можно частями — черновик сохраняется.',
        ctaUrl: '/gri?tab=assess',
        ctaLabel: 'Начать GRI',
        eyebrow: 'GRI',
      })
    }
  }

  // pulse — пятница (или суббота для тех, до кого пятничный прогон не дошёл), стрик под угрозой.
  const today = localDate(now)
  const weekday = isoWeekday(today)
  if (weekday === 5 || (weekday === 6 && input.pulseCatchUp === true)) {
    const week = mondayOf(today)
    const weeks = new Set(input.pulseWeeks)
    const streak = computePulseStreak(input.pulseWeeks, now.getTime())
    if (!weeks.has(week) && streak >= 2) {
      out.push({
        userId,
        kind: 'pulse_reminder',
        dedupeKey: `pulse_reminder:${userId}:${week}`,
        title: `Серия пульса: ${streak} нед. подряд`,
        body: `На этой неделе пульс ещё не снят. Это 2 минуты — и серия из ${streak} недель не прервётся, а динамика GRI между полными оценками останется непрерывной.`,
        ctaUrl: '/pulse',
        ctaLabel: 'Снять пульс',
        eyebrow: 'Пульс недели',
      })
    }
  }

  return out
}

export interface ReminderRunStats {
  clients: number
  candidates: number
  sent: number
  capped: number
  duplicate: number
  disabled: number
  failed: number
  byKind: Record<string, number>
  /** R-026: the run was skipped as a whole (the cabinet is in maintenance, or that is unknown). */
  skippedReason?: MaintenanceSkipReason
  /** R-015: clients with a due touch not started — the run's budget was spent (the next run sends). */
  deferred?: number
  /** R-015: sends cut by the run's deadline (a provider that did not answer in time). */
  timedOut?: number
  /** Review of wave 1A: planned touches already in the journal — dropped before the run started. */
  alreadySent?: number
}

/**
 * Отправляет касания по плану: первое неотправленное, не больше одного на клиента.
 * R-015: within the run's budget (lib/automation/run-budget.ts) — ≤ 2 clients at a time, nobody
 * started with too little time left (counted in `deferred`), every send cut at the deadline
 * (`timedOut`: that client's ladder stops there). Clients go in a per-day order, so when a run
 * cannot reach everyone, not the same ones are left every day; their touches are idempotent and
 * the next day's run sends what is still due.
 */
export async function deliverPlanned(
  plans: PlannedTouch[][],
  now: Date,
  stats: ReminderRunStats,
  budget: RunBudget = runBudget(),
): Promise<void> {
  const day = localDate(now)
  // Review of wave 1A: the touches already sent are dropped before the run spends its budget on
  // them (one read of the journal), so the clients deferred by the last run are not deferred again
  // behind duplicates. Journal not read → as before: the claim in notifyClient dedupes.
  const keys = plans.flat().map((t) => t.dedupeKey)
  const sent = keys.length ? await fetchSentDedupeKeys(keys) : null
  const pending = sent ? plans.map((touches) => touches.filter((t) => !sent.has(t.dedupeKey))) : plans
  stats.alreadySent = (stats.alreadySent ?? 0) + (keys.length - pending.flat().length)
  const due = pending
    .filter((touches) => touches.length > 0)
    .sort((a, b) => dayRotation(day, a[0].userId) - dayRotation(day, b[0].userId))
  stats.candidates += due.length
  let timedOut = 0
  const run = await runBounded(due, budget, async (touches) => {
    for (const t of touches) {
      const cut = await beforeDeadline(() => notifyClient(
        {
          userId: t.userId,
          category: 'reminders',
          event: t.kind,
          title: t.title,
          body: t.body,
          ctaUrl: t.ctaUrl,
          ctaLabel: t.ctaLabel,
          eyebrow: t.eyebrow,
          dedupeKey: t.dedupeKey,
          automated: { kind: t.kind },
          emailKind: t.kind === 'welcome' ? 'welcome' : 'reminder',
          metadata: t.stage ? { stage: t.stage } : undefined,
        },
        now,
      ), budget.deadlineAt, budget.now)
      if (!cut.ok) {
        timedOut += 1
        return
      }
      const res: NotifyClientResult = cut.value
      if (res.skipped === 'duplicate') {
        stats.duplicate += 1
        continue // это касание уже было — пробуем следующее по важности
      }
      if (res.skipped === 'capped' || res.skipped === 'journal_unavailable') stats.capped += 1
      else if (res.skipped === 'disabled' || res.skipped === 'automation_off') stats.disabled += 1
      else if (res.ok) {
        stats.sent += 1
        stats.byKind[t.kind] = (stats.byKind[t.kind] ?? 0) + 1
      } else stats.failed += 1
      break
    }
  })
  stats.deferred = (stats.deferred ?? 0) + run.deferred
  stats.timedOut = (stats.timedOut ?? 0) + timedOut
  if (run.deferred > 0 || timedOut > 0) {
    console.warn(JSON.stringify({ event: 'automation_budget_spent', job: 'reminders', deferred: run.deferred, timed_out: timedOut, candidates: due.length }))
  }
}

export async function runReminders(now: Date = new Date(), opts: { budget?: RunBudget } = {}): Promise<ReminderRunStats> {
  // R-015: the budget starts with the run — the reads below count against it too.
  const budget = opts.budget ?? runBudget()
  const stats: ReminderRunStats = { clients: 0, candidates: 0, sent: 0, capped: 0, duplicate: 0, disabled: 0, failed: 0, byKind: {}, deferred: 0, timedOut: 0, alreadySent: 0 }
  // R-026: no reminders into a cabinet that is closed for maintenance.
  const skip = await maintenanceSkipReason('reminders')
  if (skip) return { ...stats, skippedReason: skip }
  const states = (await fetchClientStates()).filter((s) => s.status === 'approved')
  stats.clients = states.length

  // Точные шаги анкеты читаем только тем, кому анкета вообще может напомнить.
  const surveyIds = states.filter((s) => !s.survey_completed).map((s) => s.user_id)
  const draftIds = states.filter((s) => s.gri_draft_updated_at).map((s) => s.user_id)
  const weekday = isoWeekday(localDate(now))
  const isFriday = weekday === 5
  // Review of wave 1A: Saturday catches up the pulse reminders Friday's run did not reach — only for
  // the clients no automatic reminder reached since Friday began (journal not read → nobody).
  const isSaturday = weekday === 6
  const pulseIds = isFriday || isSaturday ? states.filter((s) => s.gri_completed_at).map((s) => s.user_id) : []
  const touchedSinceFriday = isSaturday && pulseIds.length
    ? await fetchTouchedSince(pulseIds, startOfLocalDay(addDays(localDate(now), -1)).toISOString())
    : null

  const [surveyRows, drafts, pulse, modes, surveyModes] = await Promise.all([
    surveyIds.length ? fetchSurveyRows(surveyIds) : Promise.resolve(new Map<string, SurveyStepRow[]>()),
    draftIds.length ? fetchGriDrafts(draftIds) : Promise.resolve(new Map<string, GriDraft>()),
    pulseIds.length ? fetchPulseWeeks(pulseIds, addDays(localDate(now), -84)) : Promise.resolve(new Map<string, string[]>()),
    // The questionnaire mode (survey Ф5); a failure keeps the classic text.
    surveyIds.length ? fetchSurveyModes(surveyIds).catch(() => new Map<string, SurveyModeFacts>()) : Promise.resolve(new Map<string, SurveyModeFacts>()),
    // R4 W3B-7: the GIGA setting of the modes (never throws; a failed read → the defaults).
    getSurveyModes(),
  ])

  const plans = states.map((state) => {
    const rows = surveyRows.get(state.user_id)
    const surveySteps = rows ? completedStepsFromRows(rows) : (state.survey_filled_steps ?? [])
    const mode = modes.get(state.user_id)
    const survey = mode && (mode.mode || mode.expressCompletedAt)
      ? { ...mode, answers: Object.fromEntries((rows ?? []).map((r) => [r.question_key, fromAnswerEnvelope(r.answer)])) }
      : undefined
    return planReminders(
      {
        state, surveySteps, draft: drafts.get(state.user_id) ?? null, pulseWeeks: pulse.get(state.user_id) ?? [], survey, enabledModes: surveyModes.enabled,
        pulseCatchUp: isSaturday && touchedSinceFriday !== null && !touchedSinceFriday.has(state.user_id),
      },
      now,
    )
  })

  await deliverPlanned(plans, now, stats, budget)
  return stats
}
