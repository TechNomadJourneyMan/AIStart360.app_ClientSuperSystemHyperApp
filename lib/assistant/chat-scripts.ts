/**
 * lib/assistant/chat-scripts.ts — CHAT_SCRIPTS catalog + pure hydrate().
 *
 * The 12 ready-made assistant Q&A scripts (sections 7.1–7.12) authored in the
 * design spec (chatScripts), exported verbatim as {@link ChatScript}[]. The chat
 * API renders an answer by calling {@link hydrate}(script, ctx): it fills the
 * Russian `scriptOutline` template against the curated {@link AssistantContext}
 * snapshot — NEVER raw DB rows.
 *
 * ANTI-HALLUCINATION (никаких выдуманных цифр): every numeric slot has an
 * EXPLICIT null-guard. When a referenced ctx field is null/missing, hydrate
 * renders the honest "Недостаточно данных — загрузите …" branch instead of
 * inventing a value, sets `insufficient: true`, and reports which ctx fields it
 * actually read in `used_data`. Completion figures (overall_pct, missing lists)
 * are derived in-process from `ctx.answers` via computeCompletion(ctx) — the
 * snapshot is the single input, so hydrate stays a pure function of (script,ctx).
 */

import type { AssistantContext, ChatScript } from './types'
import { computeCompletion } from './completion'
import { SURVEY_LABELS } from '@/lib/survey-labels'

// ─── The catalog (verbatim from /tmp/assist_design.json → chatScripts) ──────────

export const CHAT_SCRIPTS: ChatScript[] = [
  {
    id: '7.1',
    section: '7.1 Главная ценность',
    question: 'Какую главную пользу даёт мне эта платформа прямо сейчас?',
    intent:
      'Объяснить ценность AIStart360 на данных клиента, а не абстрактно (7.1 Главная ценность)',
    usesData: 'ctx.pointA.overall_score, ctx.pointA.stage, completion.overall_pct, completion.missing_required',
    scriptOutline:
      'Кратко: «AIStart360 переводит ваш бизнес из ощущений в цифры: Точка А — объективная оценка сегодня, Точка Б — цель, Карта роста — путь между ними.» Затем 1–2 факта из ctx: текущий overall_score и стадия; если данных мало → «Сейчас заполнено {overall_pct}% — чтобы польза была максимальной, добавьте {top missing_required}.»',
    valueLine: 'Из ощущений — в цифры: оценка сегодня, цель и путь между ними.',
  },
  {
    id: '7.2',
    section: '7.2 Dashboard',
    question: 'Что показывает мой дашборд и на что смотреть в первую очередь?',
    intent: 'Сориентировать в дашборде и приоритезировать внимание (7.2 Dashboard)',
    usesData: 'ctx.pointA.blocks (слабейший по score), ctx.pointA.risks[0], completion.status',
    scriptOutline:
      'Перечислить блоки дашборда (Точка А, метрики, риски, инсайты, карта роста) и указать 1 приоритет: самый слабый блок Точки А. Если блоки не рассчитаны → «Дашборд оживёт после расчёта Точки А — пройдите анкету или загрузите отчёты.»',
    valueLine: 'Один экран — и сразу видно, куда смотреть первым.',
  },
  {
    id: '7.3',
    section: '7.3 Анкета',
    question: 'Насколько заполнена моя анкета и что осталось?',
    intent: 'Показать прогресс и точные пробелы без воды (7.3 Анкета)',
    usesData: 'completion.overall_pct, completion.sections, completion.missing_required',
    scriptOutline:
      '«Заполнено {overall_pct}%. Полностью готовы: {sections done}. Осталось: {missing_required по секциям}.» Дать следующий конкретный шаг (ближайшая незавершённая обязательная секция). Никаких догадок о содержании ответов.',
    valueLine: 'Точный процент и конкретный следующий шаг — без догадок.',
  },
  {
    id: '7.4',
    section: '7.4 Загрузка файлов',
    question: 'Какие файлы загрузить, чтобы анализ был точнее?',
    intent: 'Объяснить пользу загрузки файлов и закрыть пробелы данными (7.4 Загрузка файлов)',
    usesData: 'ctx.pointA.data_gaps, ctx.dataSufficiency.missing, completion.missing_required',
    scriptOutline:
      'Связать конкретные пробелы с документами: нет выручки → «загрузите P&L / управленческий отчёт»; нет базы клиентов → «выгрузка из CRM/Excel»; нет воронки → «отчёт по сделкам». Если всё ключевое есть → подтвердить и предложить уточняющие выгрузки.',
    valueLine: 'Каждый пробел — это конкретный документ, который его закрывает.',
  },
  {
    id: '7.5',
    section: '7.5 Point A',
    question: 'Что такое моя Точка А и почему такой результат?',
    intent: 'Прозрачно объяснить оценку текущего состояния (7.5 Point A)',
    usesData: 'ctx.pointA.overall_score, health_index, stage, blocks[*].score/status',
    scriptOutline:
      '«Точка А — это снимок «как есть»: общий балл {overall_score}/100, индекс здоровья {health_index}, стадия {stage}.» Назвать 2 сильных и 2 слабых блока с их баллами. Если diagnostic отсутствует → честно: «Точка А ещё не рассчитана».',
    valueLine: 'Прозрачная оценка «как есть» — с разбивкой по блокам.',
  },
  {
    id: '7.6',
    section: '7.6 Point B',
    question: 'Какая у меня Точка Б и реалистична ли цель?',
    intent: 'Показать цель, разрыв и реалистичность без выдуманных чисел (7.6 Point B)',
    usesData:
      'ctx.pointB.gap (multiplier, required_cagr), ctx.pointB.realism.level/rationale, ctx.pointB.data_sufficiency',
    scriptOutline:
      'Если есть цель и текущая выручка → «Разрыв: ×{multiplier}, нужен CAGR {required_cagr}%, реалистичность: {realism.level}» + 1 строка обоснования. Если цели/выручки нет → «Недостаточно данных для Точки Б: укажите текущую выручку и цель на 12 мес — тогда посчитаю разрыв и темп роста.»',
    valueLine: 'Честный разрыв до цели и оценка её реалистичности.',
  },
  {
    id: '7.7',
    section: '7.7 GRI',
    question: 'Что такое индекс GRI и что он говорит о готовности к росту?',
    intent: 'Объяснить GRI и топ-ограничения (7.7 GRI)',
    usesData: 'ctx.gri.gri_index, ctx.gri.top_5_limits[0..2]',
    scriptOutline:
      '«GRI — индекс готовности к росту по 7 блокам.» Назвать индекс и ТОП-3 ограничения из top_5_limits с их блоками. Если GRI не пройден → «Оценка GRI ещё не заполнена — пройдите её, чтобы увидеть главные ограничения роста.»',
    valueLine: 'Один индекс готовности к росту и его главные ограничения.',
  },
  {
    id: '7.8',
    section: '7.8 Метрики',
    question: 'Какие метрики у меня в норме, а какие проседают?',
    intent: 'Дать честный срез ключевых метрик (7.8 Метрики)',
    usesData:
      'ctx.answers (s9n_revenue_2024, s2_avg_check, s5n_funnel_*, s2_ltv/s2_cac), ctx.metrics.revenue',
    scriptOutline:
      'Перечислить доступные метрики (выручка, средний чек, конверсии воронки, LTV/CAC, повторные продажи) со значениями из ctx и пометкой норма/риск по простым порогам. Каждая отсутствующая метрика → «нет данных — добавьте {источник}», без выдуманных значений.',
    valueLine: 'Срез ключевых метрик: что в норме, что проседает, чего не хватает.',
  },
  {
    id: '7.9',
    section: '7.9 Карта роста / Action Plan',
    question: 'Каков мой план роста и что делать в ближайшие 90 дней?',
    intent: 'Превратить разрыв в конкретные шаги (7.9 Карта роста/Action Plan)',
    usesData: 'ctx.gri.top_5_limits, ctx.pointB.levers (top по expected_effect), ctx.pointB.horizons',
    scriptOutline:
      'Если Точка Б и GRI ТОП-5 есть → «Фокус на 90 дней: {top5_limits→действия по горизонтам 1-30/31-60/61-90}» + 1 рычаг роста с наибольшим эффектом. Если данных мало → «Чтобы построить карту роста, нужны цель и текущие показатели — заполните {missing}.»',
    valueLine: 'Разрыв до цели — превращённый в шаги на ближайшие 90 дней.',
  },
  {
    id: '7.10',
    section: '7.10 AI-инсайты',
    question: 'Какие AI-инсайты и риски нашёл анализ по моему бизнесу?',
    intent: 'Передать выводы LLM-анализа с пометкой уверенности (7.10 AI-инсайты)',
    usesData:
      'ctx.llm_analysis.situation_summary/strengths/risks/opportunities/next_actions/missing_data/insufficient_data',
    scriptOutline:
      'Если llm_analysis есть → выдать situation_summary + по 2 пункта strengths/risks/opportunities и next_actions. Если insufficient_data:true → честно перечислить missing_data и что загрузить. Если анализа нет → предложить запустить его кнопкой.',
    valueLine: 'Выводы AI-анализа — с честной пометкой уверенности.',
  },
  {
    id: '7.11',
    section: '7.11 Экспертная проверка',
    question: 'Когда мне нужен живой эксперт и как его позвать?',
    intent: 'Объяснить экспертную проверку и запустить эскалацию (7.11 Экспертная проверка)',
    usesData: 'issues (error-severity), ctx.pointB.realism.level, существующие expert_cases.status',
    scriptOutline:
      '«Эксперт нужен, когда: есть противоречия в данных, цель выглядит нереалистичной, или вы хотите проверку человеком.» Показать текущие триггеры из ctx (например realism=unrealistic или error-issues). Кнопка «Позвать эксперта» → создаёт ExpertCase. Если уже создан → показать статус.',
    valueLine: 'Понятно, когда подключать человека — и кнопка, чтобы его позвать.',
  },
  {
    id: '7.12',
    section: '7.12 Админ-панель',
    question: 'Что видит администратор/команда и кто работает с моими данными?',
    intent: 'Прозрачно объяснить роль админ-панели и конфиденциальность (7.12 Админ-панель)',
    usesData: 'completion.status, наличие expert_cases (факт, не содержимое)',
    scriptOutline:
      '«Ваши данные видят только вы и закреплённые специалисты платформы для диагностики; данные не передаются третьим лицам.» Объяснить, что админ/эксперт видит статус заполнения и кейсы, чтобы помогать. Без раскрытия чужих данных.',
    valueLine: 'Прозрачность: кто видит ваши данные и зачем — без раскрытия чужих.',
  },
]

// ─── hydrate() — pure (script, ctx) → answer, никаких выдуманных цифр ───────────

const INSUFFICIENT = 'Недостаточно данных'

/** Human label for a survey question key (falls back to the raw key). */
function label(key: string): string {
  return SURVEY_LABELS[key] ?? key
}

/** Render up to `n` missing-required keys as a readable Russian list. */
function missingList(keys: string[], n = 3): string {
  return keys
    .slice(0, n)
    .map(label)
    .join(', ')
}

/**
 * Number is "present" only when it is a finite number (NOT null/undefined/NaN).
 * Zero counts as a real value. This is the single null-guard every numeric slot
 * routes through — if it returns false, the caller MUST emit the insufficient
 * branch rather than print a fabricated figure.
 */
function hasNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Read a numeric survey answer from ctx.answers (string-or-number tolerant). */
function answerNum(ctx: AssistantContext, key: string): number | null {
  const v = ctx.answers?.[key]
  if (hasNum(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v)
  }
  return null
}

/** Format a money value in ₸ with thin-space grouping (only when present). */
function money(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ₸`
}

export interface HydratedScript {
  answer_ru: string
  used_data: string[]
  insufficient: boolean
}

/**
 * Fill `script.scriptOutline` against `ctx`. Pure: depends only on (script, ctx).
 * Each numeric slot is null-guarded; a referenced-but-null field flips the answer
 * to the honest "Недостаточно данных — загрузите …" branch and marks the result
 * `insufficient`. `used_data` lists the ctx paths actually consumed.
 */
export function hydrate(script: ChatScript, ctx: AssistantContext): HydratedScript {
  const used: string[] = []
  const use = (path: string) => {
    if (!used.includes(path)) used.push(path)
  }

  switch (script.id) {
    // ── 7.1 Главная ценность ───────────────────────────────────────────────
    case '7.1': {
      const completion = computeCompletion(ctx)
      use('completion.overall_pct')
      const intro =
        'AIStart360 переводит ваш бизнес из ощущений в цифры: Точка А — объективная оценка сегодня, Точка Б — цель, Карта роста — путь между ними.'

      const score = ctx.pointA.overall_score
      const stage = ctx.pointA.stage
      if (ctx.pointA.has_diagnostic && hasNum(score)) {
        use('ctx.pointA.overall_score')
        const stagePart = stage ? `, стадия — «${stage}»` : ''
        if (stage) use('ctx.pointA.stage')
        return {
          answer_ru: `${intro} Сейчас ваш общий балл — ${score}/100${stagePart}. Анкета заполнена на ${completion.overall_pct}%.`,
          used_data: used,
          insufficient: false,
        }
      }

      // No diagnostic yet → honest, completion-driven nudge (no invented score).
      use('completion.missing_required')
      const next = completion.missing_required.length
        ? `добавьте: ${missingList(completion.missing_required)}`
        : 'пройдите расчёт Точки А'
      return {
        answer_ru: `${intro} ${INSUFFICIENT} для персональной оценки: сейчас заполнено ${completion.overall_pct}% — чтобы польза была максимальной, ${next}.`,
        used_data: used,
        insufficient: true,
      }
    }

    // ── 7.2 Dashboard ──────────────────────────────────────────────────────
    case '7.2': {
      const completion = computeCompletion(ctx)
      use('completion.status')
      const intro =
        'Дашборд собирает всё в одном экране: Точка А (оценка), ключевые метрики, риски, AI-инсайты и карта роста.'

      if (!ctx.pointA.has_diagnostic) {
        return {
          answer_ru: `${intro} ${INSUFFICIENT}: дашборд оживёт после расчёта Точки А — пройдите анкету или загрузите отчёты (сейчас статус: «${completion.status}»).`,
          used_data: used,
          insufficient: true,
        }
      }

      use('ctx.pointA.blocks')
      const weakest = [...ctx.pointA.blocks].sort((a, b) => a.score - b.score)[0]
      const weakPart =
        weakest && hasNum(weakest.score)
          ? `Смотрите в первую очередь на самый слабый блок Точки А — «${weakest.label}» (${weakest.score}/100).`
          : 'Смотрите в первую очередь на самый слабый блок Точки А.'

      const risk = ctx.pointA.risks[0]
      let riskPart = ''
      if (risk) {
        use('ctx.pointA.risks[0]')
        riskPart = ` Ближайший риск: ${risk.text}.`
      }
      return {
        answer_ru: `${intro} ${weakPart}${riskPart}`,
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.3 Анкета ─────────────────────────────────────────────────────────
    case '7.3': {
      const completion = computeCompletion(ctx)
      use('completion.overall_pct')
      use('completion.sections')

      const done = completion.sections.filter((s) => s.pct >= 100).map((s) => s.label)
      const donePart = done.length ? `Полностью готовы: ${done.join(', ')}.` : 'Готовых секций пока нет.'

      if (completion.missing_required.length === 0) {
        return {
          answer_ru: `Заполнено ${completion.overall_pct}%. ${donePart} Все обязательные поля заполнены — можно запускать анализ.`,
          used_data: used,
          insufficient: false,
        }
      }

      use('completion.missing_required')
      // Next concrete step = nearest incomplete section by step number.
      const nextSection = [...completion.sections]
        .filter((s) => s.missing_required.length > 0)
        .sort((a, b) => a.step - b.step)[0]
      const nextPart = nextSection
        ? ` Следующий шаг — секция «${nextSection.label}»: ${missingList(nextSection.missing_required)}.`
        : ''
      return {
        answer_ru: `Заполнено ${completion.overall_pct}%. ${donePart} Осталось заполнить: ${missingList(completion.missing_required, 5)}.${nextPart}`,
        used_data: used,
        insufficient: completion.overall_pct < 100,
      }
    }

    // ── 7.4 Загрузка файлов ────────────────────────────────────────────────
    case '7.4': {
      const completion = computeCompletion(ctx)
      const recs: string[] = []

      use('ctx.pointB.data_sufficiency.missing')
      const sufMissing = ctx.pointB.data_sufficiency?.missing ?? []

      // Map concrete gaps → concrete documents (deterministic, no numbers).
      const revenueMissing =
        answerNum(ctx, 's9n_revenue_2024') == null && answerNum(ctx, 's2_revenue_2024') == null
      use('ctx.answers.s9n_revenue_2024')
      if (revenueMissing) recs.push('нет данных о выручке → загрузите P&L / управленческий отчёт')

      const funnelMissing =
        answerNum(ctx, 's5n_funnel_lead_to_sale') == null &&
        answerNum(ctx, 's5n_funnel_call_to_sale') == null
      use('ctx.answers.s5n_funnel_*')
      if (funnelMissing) recs.push('нет воронки → выгрузите отчёт по сделкам из CRM')

      const baseMissing = !ctx.answers?.['s5n_client_list_table']
      use('ctx.answers.s5n_client_list_table')
      if (baseMissing) recs.push('нет базы клиентов → выгрузка из CRM/Excel')

      if (recs.length === 0 && (sufMissing.length > 0 || completion.missing_required.length > 0)) {
        use('completion.missing_required')
        const gaps = sufMissing.length ? sufMissing : completion.missing_required.map(label)
        return {
          answer_ru: `Ключевые отчёты загружены. Для более точного анализа можно уточнить: ${gaps.slice(0, 3).join(', ')}.`,
          used_data: used,
          insufficient: false,
        }
      }

      if (recs.length === 0) {
        return {
          answer_ru:
            'Ключевые данные на месте. Дополнительно можно загрузить уточняющие выгрузки (детальный P&L, помесячная воронка, RFM-выгрузка) — но это необязательно.',
          used_data: used,
          insufficient: false,
        }
      }

      return {
        answer_ru: `${INSUFFICIENT} для точного анализа. Закройте пробелы документами:\n- ${recs.join('\n- ')}`,
        used_data: used,
        insufficient: true,
      }
    }

    // ── 7.5 Point A ────────────────────────────────────────────────────────
    case '7.5': {
      const score = ctx.pointA.overall_score
      const health = ctx.pointA.health_index
      const stage = ctx.pointA.stage

      if (!ctx.pointA.has_diagnostic || !hasNum(score)) {
        return {
          answer_ru: `${INSUFFICIENT}: Точка А ещё не рассчитана. Пройдите анкету или загрузите отчёты — тогда я покажу общий балл, индекс здоровья и разбивку по блокам.`,
          used_data: used,
          insufficient: true,
        }
      }
      use('ctx.pointA.overall_score')

      const healthPart = hasNum(health)
        ? `, индекс здоровья ${health}`
        : ''
      if (hasNum(health)) use('ctx.pointA.health_index')
      const stagePart = stage ? `, стадия «${stage}»` : ''
      if (stage) use('ctx.pointA.stage')

      use('ctx.pointA.blocks')
      const sorted = [...ctx.pointA.blocks].filter((b) => hasNum(b.score)).sort((a, b) => b.score - a.score)
      const fmt = (b: { label: string; score: number }) => `${b.label} (${b.score}/100)`
      const strong = sorted.slice(0, 2).map(fmt)
      const weak = sorted.slice(-2).reverse().map(fmt)
      const strongPart = strong.length ? ` Сильнее всего: ${strong.join(', ')}.` : ''
      const weakPart = weak.length ? ` Слабее всего: ${weak.join(', ')}.` : ''

      return {
        answer_ru: `Точка А — это снимок «как есть»: общий балл ${score}/100${healthPart}${stagePart}.${strongPart}${weakPart}`,
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.6 Point B ────────────────────────────────────────────────────────
    case '7.6': {
      const mult = ctx.pointB.gap.multiplier
      const cagr = ctx.pointB.gap.required_cagr
      use('ctx.pointB.gap.multiplier')
      use('ctx.pointB.gap.required_cagr')

      // Both the goal AND a computable gap must exist. Either null → honest branch.
      if (!ctx.pointB.has_goal || !hasNum(mult)) {
        use('ctx.pointB.data_sufficiency.missing')
        const miss = ctx.pointB.data_sufficiency?.missing ?? []
        const missPart = miss.length ? ` Не хватает: ${miss.slice(0, 3).join(', ')}.` : ''
        return {
          answer_ru: `${INSUFFICIENT} для Точки Б: укажите текущую выручку и цель на 12 месяцев — тогда посчитаю разрыв и нужный темп роста.${missPart}`,
          used_data: used,
          insufficient: true,
        }
      }

      use('ctx.pointB.realism.level')
      const level = ctx.pointB.realism.level
      const cagrPart = hasNum(cagr) ? `, нужен CAGR ${cagr}%` : ''
      let rationalePart = ''
      const rationale = ctx.pointB.realism.rationale?.[0]
      if (rationale) {
        use('ctx.pointB.realism.rationale[0]')
        rationalePart = ` ${rationale}`
      }
      return {
        answer_ru: `Разрыв до цели: ×${mult}${cagrPart}. Реалистичность: ${level}.${rationalePart}`,
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.7 GRI ────────────────────────────────────────────────────────────
    case '7.7': {
      const idx = ctx.gri.gri_index
      use('ctx.gri.gri_index')
      const intro = 'GRI — индекс готовности к росту по 7 блокам (шкала 0–10).'

      if (!ctx.gri.has_assessment || !hasNum(idx)) {
        return {
          answer_ru: `${intro} ${INSUFFICIENT}: оценка GRI ещё не заполнена — пройдите её, чтобы увидеть индекс и главные ограничения роста.`,
          used_data: used,
          insufficient: true,
        }
      }

      use('ctx.gri.top_5_limits')
      const top3 = ctx.gri.top_5_limits.slice(0, 3)
      const limitsPart = top3.length
        ? ` ТОП-${top3.length} ограничений: ${top3
            .map((l, i) => `${i + 1}) ${l.title}${l.block ? ` (${l.block})` : ''}`)
            .join('; ')}.`
        : ' Главные ограничения пока не выделены.'
      return {
        answer_ru: `${intro} Ваш индекс — ${idx}/10.${limitsPart}`,
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.8 Метрики ────────────────────────────────────────────────────────
    case '7.8': {
      const rows: string[] = []
      const gaps: string[] = []

      // Revenue: prefer canonical metrics, fall back to survey, else gap.
      const revenue = hasNum(ctx.metrics.revenue)
        ? ctx.metrics.revenue
        : answerNum(ctx, 's9n_revenue_2024') ?? answerNum(ctx, 's2_revenue_2024')
      use('ctx.metrics.revenue')
      use('ctx.answers.s9n_revenue_2024')
      if (hasNum(revenue)) rows.push(`Выручка: ${money(revenue)}`)
      else gaps.push('выручка — добавьте P&L / управленческий отчёт')

      const avgCheck = answerNum(ctx, 's2_avg_check') ?? answerNum(ctx, 's7_avg_check_target_kzt')
      use('ctx.answers.s2_avg_check')
      if (hasNum(avgCheck)) rows.push(`Средний чек: ${money(avgCheck)}`)
      else gaps.push('средний чек — добавьте данные продаж')

      const ltv = answerNum(ctx, 's2_ltv')
      const cac = answerNum(ctx, 's2_cac')
      use('ctx.answers.s2_ltv')
      use('ctx.answers.s2_cac')
      if (hasNum(ltv) && hasNum(cac) && cac > 0) {
        const ratio = Math.round((ltv / cac) * 10) / 10
        const flag = ratio >= 3 ? 'норма' : 'риск'
        rows.push(`LTV/CAC: ${ratio}× (${flag})`)
      } else {
        gaps.push('LTV/CAC — добавьте стоимость привлечения и ценность клиента')
      }

      const funnel = answerNum(ctx, 's5n_funnel_lead_to_sale')
      use('ctx.answers.s5n_funnel_lead_to_sale')
      if (hasNum(funnel)) {
        const flag = funnel >= 20 ? 'норма' : 'риск'
        rows.push(`Конверсия лид → продажа: ${funnel}% (${flag})`)
      } else {
        gaps.push('воронка — выгрузите отчёт по сделкам из CRM')
      }

      const rowsPart = rows.length ? `Доступные метрики:\n- ${rows.join('\n- ')}` : ''
      const gapsPart = gaps.length
        ? `${rows.length ? '\n\n' : ''}${INSUFFICIENT} по части метрик:\n- ${gaps.join('\n- ')}`
        : ''
      return {
        answer_ru: (rowsPart + gapsPart).trim() ||
          `${INSUFFICIENT}: добавьте финансовые и продажные данные, чтобы я показал срез метрик.`,
        used_data: used,
        insufficient: gaps.length > 0,
      }
    }

    // ── 7.9 Карта роста / Action Plan ──────────────────────────────────────
    case '7.9': {
      const completion = computeCompletion(ctx)
      use('ctx.gri.top_5_limits')
      const top5 = ctx.gri.top_5_limits
      const hasGoal = ctx.pointB.has_goal
      use('ctx.pointB.has_goal')

      if (!top5.length || !hasGoal) {
        use('completion.missing_required')
        const miss = completion.missing_required.length
          ? missingList(completion.missing_required)
          : 'цель на 12 мес и текущую выручку'
        return {
          answer_ru: `${INSUFFICIENT} для карты роста: нужны цель и текущие показатели — заполните ${miss}, и я разложу путь на горизонты 1–30 / 31–60 / 61–90 дней.`,
          used_data: used,
          insufficient: true,
        }
      }

      // Distribute the top-5 GRI limits across the three 30-day horizons.
      const horizons: [string, string][] = [
        ['1–30 дней', ''],
        ['31–60 дней', ''],
        ['61–90 дней', ''],
      ]
      top5.slice(0, 3).forEach((l, i) => {
        horizons[i][1] = l.title
      })
      const plan = horizons
        .filter(([, t]) => t)
        .map(([h, t]) => `${h}: ${t}`)
        .join('\n- ')

      use('ctx.pointB.levers')
      const lever = [...ctx.pointB.levers]
        .filter((l) => l.data_available)
        .sort((a, b) => b.expected_effect.length - a.expected_effect.length)[0]
      const leverPart = lever
        ? `\n\nРычаг с наибольшим эффектом: ${lever.label} — ${lever.expected_effect}.`
        : ''
      return {
        answer_ru: `Фокус на 90 дней:\n- ${plan}${leverPart}`,
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.10 AI-инсайты ────────────────────────────────────────────────────
    case '7.10': {
      use('ctx.llm_analysis')
      const a = ctx.llm_analysis
      if (!a) {
        return {
          answer_ru:
            'AI-анализ ещё не запускался. Нажмите «Запустить AI-анализ» — я разберу сильные и слабые стороны, риски и возможности по вашим данным.',
          used_data: used,
          insufficient: true,
        }
      }

      if (a.insufficient_data) {
        use('ctx.llm_analysis.missing_data')
        const miss = a.missing_data?.slice(0, 4) ?? []
        const missPart = miss.length ? ` Не хватает: ${miss.join(', ')}.` : ''
        return {
          answer_ru: `${INSUFFICIENT} для надёжных выводов.${missPart} Загрузите эти данные и запустите анализ снова.`,
          used_data: used,
          insufficient: true,
        }
      }

      use('ctx.llm_analysis.situation_summary')
      const pick = (arr: string[]) => (arr ?? []).slice(0, 2)
      const block = (title: string, arr: string[], path: string) => {
        const v = pick(arr)
        if (!v.length) return ''
        use(path)
        return `\n\n${title}:\n- ${v.join('\n- ')}`
      }
      const body =
        block('Сильные стороны', a.strengths, 'ctx.llm_analysis.strengths') +
        block('Риски', a.risks, 'ctx.llm_analysis.risks') +
        block('Возможности', a.opportunities, 'ctx.llm_analysis.opportunities') +
        block('Следующие шаги', a.next_actions, 'ctx.llm_analysis.next_actions')
      return {
        answer_ru: `${a.situation_summary}${body}\n\nУверенность анализа: ${Math.round((a.confidence ?? 0) * 100)}%.`,
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.11 Экспертная проверка ───────────────────────────────────────────
    case '7.11': {
      const intro =
        'Живой эксперт нужен, когда: в данных есть противоречия, цель выглядит нереалистичной, или вы просто хотите проверку человеком.'
      const triggers: string[] = []

      use('ctx.pointB.realism.level')
      const level = (ctx.pointB.realism?.level ?? '').toLowerCase()
      if (level === 'unrealistic' || level === 'нереалистична' || level === 'low') {
        triggers.push('цель оценена как малореалистичная')
      }

      const triggerPart = triggers.length
        ? ` Сейчас сработали триггеры: ${triggers.join('; ')}.`
        : ' Сейчас критичных триггеров не вижу, но вы можете запросить проверку в любой момент.'
      return {
        answer_ru: `${intro}${triggerPart} Нажмите «Позвать эксперта» — я создам заявку и закреплённый специалист посмотрит ваш кейс.`,
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.12 Админ-панель ──────────────────────────────────────────────────
    case '7.12': {
      const completion = computeCompletion(ctx)
      use('completion.status')
      return {
        answer_ru: `Ваши данные видят только вы и закреплённые специалисты платформы для диагностики — третьим лицам они не передаются. Эксперт/администратор видит статус заполнения (сейчас: «${completion.status}») и заявки на проверку, чтобы помогать вам, но не данные других клиентов.`,
        used_data: used,
        insufficient: false,
      }
    }

    default: {
      // Unknown script id — never fabricate; fall back to the outline verbatim.
      return {
        answer_ru: script.scriptOutline,
        used_data: used,
        insufficient: true,
      }
    }
  }
}

/** Look up a chat script by its section id (e.g. '7.6'). */
export function getChatScript(id: string): ChatScript | undefined {
  return CHAT_SCRIPTS.find((s) => s.id === id)
}
