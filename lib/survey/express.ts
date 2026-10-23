/**
 * lib/survey/express.ts — the express flow of «Экспресс + блоки» (spec
 * 2026-10-23 §7.1): 15 screens, 26 questions (+3 «год = месяц × 12» keys
 * written with their month). Pure, browser-safe.
 *
 *  • a page = one screen; on a phone the hard screens (3+ questions: «как
 *    устроено управление», «деньги») show one question per page;
 *  • «Готово — показать снимок» from the 5th screen on (after the 4th), the
 *    main button after the 15th; skipping never blocks it;
 *  • calculations after screens 5, 11, 14, 15 (§9: темп к цели, деньги на
 *    рекламу, часы в месяц, маржа и деньги).
 */
import { isAnswerFilled } from './answer-filled'
import { isUnknownAnswer } from './answer-value'
import type { CalcId } from './calcs'
import { EXPRESS_SCREENS, SURVEY_QUESTIONS, type SurveyQuestion } from './questions'

export const EXPRESS_TOTAL_SCREENS = EXPRESS_SCREENS.length
/** «Готово» is offered from this screen on (spec: «на любом экране после 4-го»). */
export const EXPRESS_FINISH_FROM_SCREEN = 5

export interface ExpressPage {
  /** 0-based position in the flow. */
  index: number
  screen: number
  title: string
  /** Questions shown on the page (auto keys are never shown). */
  questions: SurveyQuestion[]
  /** One question of a split screen: «вопрос 2 из 5». */
  part?: { index: number; total: number }
}

/** Questions asked in the express flow, in screen order (26). */
export const EXPRESS_QUESTIONS: readonly SurveyQuestion[] = EXPRESS_SCREENS.flatMap((s) =>
  s.keys.map((k) => SURVEY_QUESTIONS[k]).filter((q): q is SurveyQuestion => !!q && !q.auto),
)

/** A screen is «hard» on a phone: three or more questions. */
export const isHardScreen = (screen: number): boolean =>
  (EXPRESS_SCREENS.find((s) => s.screen === screen)?.keys.filter((k) => !SURVEY_QUESTIONS[k]?.auto).length ?? 0) >= 3

/** The pages of the flow. `oneQuestionPerHardScreen`: phone layout. */
export function expressPages(opts: { oneQuestionPerHardScreen?: boolean } = {}): ExpressPage[] {
  const pages: ExpressPage[] = []
  for (const s of EXPRESS_SCREENS) {
    const questions = s.keys.map((k) => SURVEY_QUESTIONS[k]).filter((q): q is SurveyQuestion => !!q && !q.auto)
    if (opts.oneQuestionPerHardScreen && isHardScreen(s.screen)) {
      questions.forEach((q, i) => pages.push({ index: pages.length, screen: s.screen, title: s.title, questions: [q], part: { index: i + 1, total: questions.length } }))
    } else {
      pages.push({ index: pages.length, screen: s.screen, title: s.title, questions })
    }
  }
  return pages
}

/** «Готово — показать снимок» is available on this page. */
export const canFinishExpress = (page: Pick<ExpressPage, 'screen'>): boolean => page.screen >= EXPRESS_FINISH_FROM_SCREEN

/** Calculations shown after a screen (lib/survey/calcs). Screen 15 adds «маржа и деньги» (lib/survey/snapshot.ts). */
export const EXPRESS_SCREEN_CALCS: Readonly<Record<number, readonly CalcId[]>> = {
  5: ['goal_pace'],
  11: ['marketing_money'],
  14: ['owner_hours'],
}

export interface ExpressSummary {
  total: number
  answered: number
  unknown: number
  skipped: number
}

/** answered = a real answer or «не знаю»; unknown ⊂ answered; skipped = the rest. */
export function expressSummary(answers: Readonly<Record<string, unknown>>): ExpressSummary {
  let answered = 0
  let unknown = 0
  for (const q of EXPRESS_QUESTIONS) {
    const v = answers[q.key]
    if (isUnknownAnswer(v)) { answered++; unknown++ } else if (isAnswerFilled(v) || typeof v === 'boolean') answered++
  }
  return { total: EXPRESS_QUESTIONS.length, answered, unknown, skipped: EXPRESS_QUESTIONS.length - answered }
}

/** The first page with an unanswered question (where a returning owner continues). */
export function firstOpenPage(pages: readonly ExpressPage[], answers: Readonly<Record<string, unknown>>): number {
  const i = pages.findIndex((p) => p.questions.some((q) => !isAnswerFilled(answers[q.key]) && typeof answers[q.key] !== 'boolean'))
  return i < 0 ? pages.length - 1 : i
}

/** SURVEY_EXPRESS_COMPLETED metadata (spec §15). */
export function expressCompletedMetadata(answers: Readonly<Record<string, unknown>>, startedAt: number | null, now: number): Record<string, number> {
  const s = expressSummary(answers)
  return {
    answered: s.answered,
    unknown: s.unknown,
    skipped: s.skipped,
    minutes: startedAt !== null ? Math.max(0, Math.round((now - startedAt) / 60000)) : 0,
  }
}

/** «Зачем спрашиваем» of each express screen: what it closes in Point A (spec §7.1). */
export const EXPRESS_WHY: Readonly<Record<number, string>> = {
  1: 'Отрасль выбирает шаблон оценки Точки А под ваш бизнес.',
  2: 'От того, кому вы продаёте, зависят метрики, которые мы смотрим.',
  3: 'Нужно для выручки на человека и оценки команды.',
  4: 'Это база: от неё считаем разрыв до цели.',
  5: 'Без цели не посчитать, какой нужен темп роста.',
  6: 'Цель своими словами — основа стратегии и плана Точки Б.',
  7: 'С главной боли эксперт начнёт разбор.',
  8: 'Барьеры роста попадут в блок «Стратегия».',
  9: 'Портрет клиента — основа оценки маркетинга.',
  10: 'Отличие от конкурентов и их разбор — блок «Маркетинг».',
  11: 'Каналы и бюджет — блок «Маркетинг».',
  12: 'Где ведёте клиентов и цикл сделки — блок «Продажи».',
  13: 'Пять быстрых ответов закрывают блок «Операции» целиком.',
  14: 'Покажет, сколько времени уходит на текучку и не вы ли узкое место.',
  15: 'Без этих трёх цифр блок «Финансы» не оценить. Можно ответить «не знаю» — это тоже честный ответ.',
}
