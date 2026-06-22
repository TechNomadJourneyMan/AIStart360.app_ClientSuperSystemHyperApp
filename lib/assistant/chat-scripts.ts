/**
 * lib/assistant/chat-scripts.ts — CHAT_SCRIPTS catalog + pure hydrate().
 *
 * The 12 ready-made assistant Q&A scripts (sections 7.1–7.12) authored in the
 * design spec (chatScripts), exported verbatim as {@link ChatScript}[]. The chat
 * API renders an answer by calling {@link hydrate}(script, ctx, locale): it fills
 * the locale-matched outline template against the curated {@link AssistantContext}
 * snapshot — NEVER raw DB rows. Russian is the default; English ships now too.
 * Adding a language later = extend the per-locale `T` dictionaries below.
 *
 * ANTI-HALLUCINATION (никаких выдуманных цифр / no invented numbers): every
 * numeric slot has an EXPLICIT null-guard. When a referenced ctx field is
 * null/missing, hydrate renders the honest "Недостаточно данных — загрузите …" /
 * "Not enough data — upload …" branch instead of inventing a value, sets
 * `insufficient: true`, and reports which ctx fields it actually read in
 * `used_data`. Completion figures (overall_pct, missing lists) are derived
 * in-process from `ctx.answers` via computeCompletion(ctx) — the snapshot is the
 * single input, so hydrate stays a pure function of (script, ctx, locale).
 */

import type { AssistantContext, ChatScript } from './types'
import { computeCompletion } from './completion'
import { SURVEY_LABELS } from '@/lib/survey-labels'
import { type Locale, DEFAULT_LOCALE } from '@/lib/i18n/locale'

// ─── The catalog (verbatim from /tmp/assist_design.json → chatScripts) ──────────

export const CHAT_SCRIPTS: ChatScript[] = [
  {
    id: '7.1',
    section: '1 Главная ценность',
    question: 'Какую главную пользу даёт мне эта платформа прямо сейчас?',
    question_en: 'What is the main value this platform gives me right now?',
    intent:
      'Объяснить ценность AIStart360 на данных клиента, а не абстрактно (7.1 Главная ценность)',
    usesData: 'ctx.pointA.overall_score, ctx.pointA.stage, completion.overall_pct, completion.missing_required',
    scriptOutline:
      'Кратко: «AIStart360 переводит ваш бизнес из ощущений в цифры: Точка А — объективная оценка сегодня, Точка Б — цель, Карта роста — путь между ними.» Затем 1–2 факта из ctx: текущий overall_score и стадия; если данных мало → «Сейчас заполнено {overall_pct}% — чтобы польза была максимальной, добавьте {top missing_required}.»',
    outline_en:
      'Briefly: "AIStart360 turns your business from gut feel into numbers: Point A — an objective assessment today, Point B — the goal, the Growth Map — the path between them." Then 1–2 facts from ctx: current overall_score and stage; if data is thin → "You\'ve filled {overall_pct}% so far — to get the most value, add {top missing_required}."',
    valueLine: 'Из ощущений — в цифры: оценка сегодня, цель и путь между ними.',
    valueLine_en: 'From gut feel to numbers: today\'s score, the goal, and the path between.',
  },
  {
    id: '7.2',
    section: '2 Dashboard',
    question: 'Что показывает мой дашборд и на что смотреть в первую очередь?',
    question_en: 'What does my dashboard show and what should I look at first?',
    intent: 'Сориентировать в дашборде и приоритезировать внимание (7.2 Dashboard)',
    usesData: 'ctx.pointA.blocks (слабейший по score), ctx.pointA.risks[0], completion.status',
    scriptOutline:
      'Перечислить блоки дашборда (Точка А, метрики, риски, инсайты, карта роста) и указать 1 приоритет: самый слабый блок Точки А. Если блоки не рассчитаны → «Дашборд оживёт после расчёта Точки А — пройдите анкету или загрузите отчёты.»',
    outline_en:
      'List the dashboard blocks (Point A, metrics, risks, insights, growth map) and name 1 priority: the weakest Point A block. If the blocks are not computed → "The dashboard comes alive once Point A is calculated — complete the survey or upload reports."',
    valueLine: 'Один экран — и сразу видно, куда смотреть первым.',
    valueLine_en: 'One screen — and you see where to look first.',
  },
  {
    id: '7.3',
    section: '3 Анкета',
    question: 'Насколько заполнена моя анкета и что осталось?',
    question_en: 'How complete is my survey and what is left?',
    intent: 'Показать прогресс и точные пробелы без воды (7.3 Анкета)',
    usesData: 'completion.overall_pct, completion.sections, completion.missing_required',
    scriptOutline:
      '«Заполнено {overall_pct}%. Полностью готовы: {sections done}. Осталось: {missing_required по секциям}.» Дать следующий конкретный шаг (ближайшая незавершённая обязательная секция). Никаких догадок о содержании ответов.',
    outline_en:
      '"You\'ve filled {overall_pct}%. Fully done: {sections done}. Still missing: {missing_required by section}." Give the next concrete step (the nearest incomplete required section). No guessing about the content of the answers.',
    valueLine: 'Точный процент и конкретный следующий шаг — без догадок.',
    valueLine_en: 'An exact percentage and a concrete next step — no guesswork.',
  },
  {
    id: '7.4',
    section: '4 Загрузка файлов',
    question: 'Какие файлы загрузить, чтобы анализ был точнее?',
    question_en: 'Which files should I upload to make the analysis more accurate?',
    intent: 'Объяснить пользу загрузки файлов и закрыть пробелы данными (7.4 Загрузка файлов)',
    usesData: 'ctx.pointA.data_gaps, ctx.dataSufficiency.missing, completion.missing_required',
    scriptOutline:
      'Связать конкретные пробелы с документами: нет выручки → «загрузите P&L / управленческий отчёт»; нет базы клиентов → «выгрузка из CRM/Excel»; нет воронки → «отчёт по сделкам». Если всё ключевое есть → подтвердить и предложить уточняющие выгрузки.',
    outline_en:
      'Tie concrete gaps to documents: no revenue → "upload a P&L / management report"; no client base → "an export from CRM/Excel"; no funnel → "a deals report". If everything key is present → confirm and suggest clarifying exports.',
    valueLine: 'Каждый пробел — это конкретный документ, который его закрывает.',
    valueLine_en: 'Every gap maps to one concrete document that closes it.',
  },
  {
    id: '7.5',
    section: '5 Point A',
    question: 'Что такое моя Точка А и почему такой результат?',
    question_en: 'What is my Point A and why this result?',
    intent: 'Прозрачно объяснить оценку текущего состояния (7.5 Point A)',
    usesData: 'ctx.pointA.overall_score, health_index, stage, blocks[*].score/status',
    scriptOutline:
      '«Точка А — это снимок «как есть»: общий балл {overall_score}/100, индекс здоровья {health_index}, стадия {stage}.» Назвать 2 сильных и 2 слабых блока с их баллами. Если diagnostic отсутствует → честно: «Точка А ещё не рассчитана».',
    outline_en:
      '"Point A is an as-is snapshot: overall score {overall_score}/100, health index {health_index}, stage {stage}." Name 2 strong and 2 weak blocks with their scores. If the diagnostic is missing → honestly: "Point A has not been calculated yet."',
    valueLine: 'Прозрачная оценка «как есть» — с разбивкой по блокам.',
    valueLine_en: 'A transparent as-is assessment — broken down by block.',
  },
  {
    id: '7.6',
    section: '6 Point B',
    question: 'Какая у меня Точка Б и реалистична ли цель?',
    question_en: 'What is my Point B and is the goal realistic?',
    intent: 'Показать цель, разрыв и реалистичность без выдуманных чисел (7.6 Point B)',
    usesData:
      'ctx.pointB.gap (multiplier, required_cagr), ctx.pointB.realism.level/rationale, ctx.pointB.data_sufficiency',
    scriptOutline:
      'Если есть цель и текущая выручка → «Разрыв: ×{multiplier}, нужен CAGR {required_cagr}%, реалистичность: {realism.level}» + 1 строка обоснования. Если цели/выручки нет → «Недостаточно данных для Точки Б: укажите текущую выручку и цель на 12 мес — тогда посчитаю разрыв и темп роста.»',
    outline_en:
      'If there is a goal and current revenue → "Gap: ×{multiplier}, required CAGR {required_cagr}%, realism: {realism.level}" + 1 line of rationale. If goal/revenue is missing → "Not enough data for Point B: set your current revenue and a 12-month goal — then I\'ll compute the gap and the required growth rate."',
    valueLine: 'Честный разрыв до цели и оценка её реалистичности.',
    valueLine_en: 'An honest gap to the goal and how realistic it is.',
  },
  {
    id: '7.7',
    section: '7 GRI',
    question: 'Что такое индекс GRI и что он говорит о готовности к росту?',
    question_en: 'What is the GRI index and what does it say about growth readiness?',
    intent: 'Объяснить GRI и топ-ограничения (7.7 GRI)',
    usesData: 'ctx.gri.gri_index, ctx.gri.top_5_limits[0..2]',
    scriptOutline:
      '«GRI — индекс готовности к росту по 7 блокам.» Назвать индекс и ТОП-3 ограничения из top_5_limits с их блоками. Если GRI не пройден → «Оценка GRI ещё не заполнена — пройдите её, чтобы увидеть главные ограничения роста.»',
    outline_en:
      '"GRI is a growth-readiness index across 7 blocks." State the index and the TOP-3 limits from top_5_limits with their blocks. If GRI is not done → "The GRI assessment is not filled in yet — complete it to see your main growth constraints."',
    valueLine: 'Один индекс готовности к росту и его главные ограничения.',
    valueLine_en: 'One growth-readiness index and its main constraints.',
  },
  {
    id: '7.8',
    section: '8 Метрики',
    question: 'Какие метрики у меня в норме, а какие проседают?',
    question_en: 'Which of my metrics are healthy and which are lagging?',
    intent: 'Дать честный срез ключевых метрик (7.8 Метрики)',
    usesData:
      'ctx.answers (s9n_revenue_2024, s2_avg_check, s5n_funnel_*, s2_ltv/s2_cac), ctx.metrics.revenue',
    scriptOutline:
      'Перечислить доступные метрики (выручка, средний чек, конверсии воронки, LTV/CAC, повторные продажи) со значениями из ctx и пометкой норма/риск по простым порогам. Каждая отсутствующая метрика → «нет данных — добавьте {источник}», без выдуманных значений.',
    outline_en:
      'List the available metrics (revenue, average check, funnel conversions, LTV/CAC, repeat sales) with values from ctx, flagged healthy/at-risk by simple thresholds. Each missing metric → "no data — add {source}", without invented values.',
    valueLine: 'Срез ключевых метрик: что в норме, что проседает, чего не хватает.',
    valueLine_en: 'A snapshot of key metrics: what\'s healthy, what\'s lagging, what\'s missing.',
  },
  {
    id: '7.9',
    section: '9 Карта роста / Action Plan',
    question: 'Каков мой план роста и что делать в ближайшие 90 дней?',
    question_en: 'What is my growth plan and what should I do in the next 90 days?',
    intent: 'Превратить разрыв в конкретные шаги (7.9 Карта роста/Action Plan)',
    usesData: 'ctx.gri.top_5_limits, ctx.pointB.levers (top по expected_effect), ctx.pointB.horizons',
    scriptOutline:
      'Если Точка Б и GRI ТОП-5 есть → «Фокус на 90 дней: {top5_limits→действия по горизонтам 1-30/31-60/61-90}» + 1 рычаг роста с наибольшим эффектом. Если данных мало → «Чтобы построить карту роста, нужны цель и текущие показатели — заполните {missing}.»',
    outline_en:
      'If Point B and the GRI TOP-5 exist → "90-day focus: {top5_limits→actions across horizons 1-30/31-60/61-90}" + 1 growth lever with the largest effect. If data is thin → "To build the growth map I need a goal and current figures — fill in {missing}."',
    valueLine: 'Разрыв до цели — превращённый в шаги на ближайшие 90 дней.',
    valueLine_en: 'The gap to your goal — turned into steps for the next 90 days.',
  },
  {
    id: '7.10',
    section: '10 AI-инсайты',
    question: 'Какие AI-инсайты и риски нашёл анализ по моему бизнесу?',
    question_en: 'What AI insights and risks did the analysis find for my business?',
    intent: 'Передать выводы LLM-анализа с пометкой уверенности (7.10 AI-инсайты)',
    usesData:
      'ctx.llm_analysis.situation_summary/strengths/risks/opportunities/next_actions/missing_data/insufficient_data',
    scriptOutline:
      'Если llm_analysis есть → выдать situation_summary + по 2 пункта strengths/risks/opportunities и next_actions. Если insufficient_data:true → честно перечислить missing_data и что загрузить. Если анализа нет → предложить запустить его кнопкой.',
    outline_en:
      'If llm_analysis exists → give situation_summary + 2 items each of strengths/risks/opportunities and next_actions. If insufficient_data:true → honestly list missing_data and what to upload. If there is no analysis → suggest running it with the button.',
    valueLine: 'Выводы AI-анализа — с честной пометкой уверенности.',
    valueLine_en: 'AI-analysis findings — with an honest confidence note.',
  },
  {
    id: '7.11',
    section: '11 Экспертная проверка',
    question: 'Когда мне нужен живой эксперт и как его позвать?',
    question_en: 'When do I need a human expert and how do I call one?',
    intent: 'Объяснить экспертную проверку и запустить эскалацию (7.11 Экспертная проверка)',
    usesData: 'issues (error-severity), ctx.pointB.realism.level, существующие expert_cases.status',
    scriptOutline:
      '«Эксперт нужен, когда: есть противоречия в данных, цель выглядит нереалистичной, или вы хотите проверку человеком.» Показать текущие триггеры из ctx (например realism=unrealistic или error-issues). Кнопка «Позвать эксперта» → создаёт ExpertCase. Если уже создан → показать статус.',
    outline_en:
      '"You need an expert when: there are contradictions in the data, the goal looks unrealistic, or you simply want a human review." Show current triggers from ctx (e.g. realism=unrealistic or error-issues). The "Call an expert" button → creates an ExpertCase. If one already exists → show its status.',
    valueLine: 'Понятно, когда подключать человека — и кнопка, чтобы его позвать.',
    valueLine_en: 'Clear on when to bring in a human — and a button to call one.',
  },
  {
    id: '7.12',
    section: '12 Админ-панель',
    question: 'Что видит администратор/команда и кто работает с моими данными?',
    question_en: 'What does the admin/team see and who works with my data?',
    intent: 'Прозрачно объяснить роль админ-панели и конфиденциальность (7.12 Админ-панель)',
    usesData: 'completion.status, наличие expert_cases (факт, не содержимое)',
    scriptOutline:
      '«Ваши данные видят только вы и закреплённые специалисты платформы для диагностики; данные не передаются третьим лицам.» Объяснить, что админ/эксперт видит статус заполнения и кейсы, чтобы помогать. Без раскрытия чужих данных.',
    outline_en:
      '"Your data is seen only by you and the platform specialists assigned for diagnostics; it is not shared with third parties." Explain that the admin/expert sees completion status and cases in order to help. Without disclosing anyone else\'s data.',
    valueLine: 'Прозрачность: кто видит ваши данные и зачем — без раскрытия чужих.',
    valueLine_en: 'Transparency: who sees your data and why — without exposing anyone else\'s.',
  },
]

// ─── hydrate() — pure (script, ctx, locale) → answer, никаких выдуманных цифр ────

/**
 * Locale-keyed copy for the fixed (non-ctx) parts of every answer. To add a
 * language later, add a key to {@link Locale} and an entry to each record below.
 */
const COPY: Record<Locale, {
  insufficient: string
  money: (n: number) => string
  // 7.1
  s71_intro: string
  s71_filled: (pct: number) => string
  s71_score: (score: number, stagePart: string, pct: number) => string
  s71_stage: (stage: string) => string
  s71_nudge: (pct: number, next: string) => string
  s71_add: (list: string) => string
  s71_runPointA: string
  // 7.2
  s72_intro: string
  s72_noDiag: (status: string) => string
  s72_weakNamed: (label: string, score: number) => string
  s72_weak: string
  s72_risk: (text: string) => string
  // 7.3
  s73_doneNone: string
  s73_done: (list: string) => string
  s73_allDone: (pct: number, donePart: string) => string
  s73_next: (label: string, list: string) => string
  s73_remaining: (pct: number, donePart: string, list: string, nextPart: string) => string
  // 7.4
  s74_revenue: string
  s74_funnel: string
  s74_base: string
  s74_refine: (gaps: string) => string
  s74_allGood: string
  s74_close: (list: string) => string
  // 7.5
  s75_noDiag: string
  s75_health: (h: number) => string
  s75_stage: (stage: string) => string
  s75_strong: (list: string) => string
  s75_weak: (list: string) => string
  s75_body: (score: number, healthPart: string, stagePart: string, strongPart: string, weakPart: string) => string
  // 7.6
  s76_noGoal: (missPart: string) => string
  s76_miss: (list: string) => string
  s76_cagr: (cagr: number) => string
  s76_body: (mult: number, cagrPart: string, level: string, rationalePart: string) => string
  // 7.7
  s77_intro: string
  s77_noAssessment: (intro: string) => string
  s77_limits: (list: string) => string
  s77_noLimits: string
  s77_body: (intro: string, idx: number, limitsPart: string) => string
  // 7.8
  s78_revenueRow: (m: string) => string
  s78_revenueGap: string
  s78_avgCheckRow: (m: string) => string
  s78_avgCheckGap: string
  flagOk: string
  flagRisk: string
  s78_ltvRow: (ratio: number, flag: string) => string
  s78_ltvGap: string
  s78_funnelRow: (funnel: number, flag: string) => string
  s78_funnelGap: string
  s78_available: (list: string) => string
  s78_gaps: (sep: string, list: string) => string
  s78_empty: string
  // 7.9
  s79_noData: (miss: string) => string
  s79_missFallback: string
  s79_horizons: [string, string, string]
  s79_lever: (label: string, effect: string) => string
  s79_body: (plan: string, leverPart: string) => string
  // 7.10
  s710_notRun: string
  s710_insufficient: (missPart: string) => string
  s710_miss: (list: string) => string
  s710_strengths: string
  s710_risks: string
  s710_opportunities: string
  s710_nextActions: string
  s710_body: (summary: string, body: string, confidence: number) => string
  // 7.11
  s711_intro: string
  s711_triggerUnrealistic: string
  s711_triggers: (list: string) => string
  s711_noTriggers: string
  s711_body: (intro: string, triggerPart: string) => string
  // 7.12
  s712_body: (status: string) => string
}> = {
  ru: {
    insufficient: 'Недостаточно данных',
    money: (n) => `${Math.round(n).toLocaleString('ru-RU')} ₸`,
    s71_intro:
      'AIStart360 переводит ваш бизнес из ощущений в цифры: Точка А — объективная оценка сегодня, Точка Б — цель, Карта роста — путь между ними.',
    s71_filled: (pct) => `Анкета заполнена на ${pct}%.`,
    s71_score: (score, stagePart, pct) =>
      `Сейчас ваш общий балл — ${score}/100${stagePart}. Анкета заполнена на ${pct}%.`,
    s71_stage: (_stage) => ``, // «Стадия» removed from display per product decision (kept in data only)
    s71_nudge: (pct, next) =>
      `Сейчас заполнено ${pct}% — чтобы польза была максимальной, ${next}.`,
    s71_add: (list) => `добавьте: ${list}`,
    s71_runPointA: 'пройдите расчёт Точки А',
    s72_intro:
      'Дашборд собирает всё в одном экране: Точка А (оценка), ключевые метрики, риски, AI-инсайты и карта роста.',
    s72_noDiag: (status) =>
      `дашборд оживёт после расчёта Точки А — пройдите анкету или загрузите отчёты (сейчас статус: «${status}»).`,
    s72_weakNamed: (label, score) =>
      `Смотрите в первую очередь на самый слабый блок Точки А — «${label}» (${score}/100).`,
    s72_weak: 'Смотрите в первую очередь на самый слабый блок Точки А.',
    s72_risk: (text) => ` Ближайший риск: ${text}.`,
    s73_doneNone: 'Готовых секций пока нет.',
    s73_done: (list) => `Полностью готовы: ${list}.`,
    s73_allDone: (pct, donePart) =>
      `Заполнено ${pct}%. ${donePart} Все обязательные поля заполнены — можно запускать анализ.`,
    s73_next: (label, list) => ` Следующий шаг — секция «${label}»: ${list}.`,
    s73_remaining: (pct, donePart, list, nextPart) =>
      `Заполнено ${pct}%. ${donePart} Осталось заполнить: ${list}.${nextPart}`,
    s74_revenue: 'нет данных о выручке → загрузите P&L / управленческий отчёт',
    s74_funnel: 'нет воронки → выгрузите отчёт по сделкам из CRM',
    s74_base: 'нет базы клиентов → выгрузка из CRM/Excel',
    s74_refine: (gaps) =>
      `Ключевые отчёты загружены. Для более точного анализа можно уточнить: ${gaps}.`,
    s74_allGood:
      'Ключевые данные на месте. Дополнительно можно загрузить уточняющие выгрузки (детальный P&L, помесячная воронка, RFM-выгрузка) — но это необязательно.',
    s74_close: (list) => `для точного анализа. Закройте пробелы документами:\n- ${list}`,
    s75_noDiag:
      'Точка А ещё не рассчитана. Пройдите анкету или загрузите отчёты — тогда я покажу общий балл, индекс здоровья и разбивку по блокам.',
    s75_health: (h) => `, индекс здоровья ${h}`,
    s75_stage: (_stage) => ``, // «Стадия» removed from display per product decision (kept in data only)
    s75_strong: (list) => ` Сильнее всего: ${list}.`,
    s75_weak: (list) => ` Слабее всего: ${list}.`,
    s75_body: (score, healthPart, stagePart, strongPart, weakPart) =>
      `Точка А — это снимок «как есть»: общий балл ${score}/100${healthPart}${stagePart}.${strongPart}${weakPart}`,
    s76_noGoal: (missPart) =>
      `для Точки Б: укажите текущую выручку и цель на 12 месяцев — тогда посчитаю разрыв и нужный темп роста.${missPart}`,
    s76_miss: (list) => ` Не хватает: ${list}.`,
    s76_cagr: (cagr) => `, нужен CAGR ${cagr}%`,
    s76_body: (mult, cagrPart, level, rationalePart) =>
      `Разрыв до цели: ×${mult}${cagrPart}. Реалистичность: ${level}.${rationalePart}`,
    s77_intro: 'GRI — индекс готовности к росту по 7 блокам (шкала 0–10).',
    s77_noAssessment: (intro) =>
      `${intro} оценка GRI ещё не заполнена — пройдите её, чтобы увидеть индекс и главные ограничения роста.`,
    s77_limits: (list) => ` ${list}.`,
    s77_noLimits: ' Главные ограничения пока не выделены.',
    s77_body: (intro, idx, limitsPart) => `${intro} Ваш индекс — ${idx}/10.${limitsPart}`,
    s78_revenueRow: (m) => `Выручка: ${m}`,
    s78_revenueGap: 'выручка — добавьте P&L / управленческий отчёт',
    s78_avgCheckRow: (m) => `Средний чек: ${m}`,
    s78_avgCheckGap: 'средний чек — добавьте данные продаж',
    flagOk: 'норма',
    flagRisk: 'риск',
    s78_ltvRow: (ratio, flag) => `LTV/CAC: ${ratio}× (${flag})`,
    s78_ltvGap: 'LTV/CAC — добавьте стоимость привлечения и ценность клиента',
    s78_funnelRow: (funnel, flag) => `Конверсия лид → продажа: ${funnel}% (${flag})`,
    s78_funnelGap: 'воронка — выгрузите отчёт по сделкам из CRM',
    s78_available: (list) => `Доступные метрики:\n- ${list}`,
    s78_gaps: (sep, list) => `${sep}по части метрик:\n- ${list}`,
    s78_empty: 'добавьте финансовые и продажные данные, чтобы я показал срез метрик.',
    s79_noData: (miss) =>
      `для карты роста: нужны цель и текущие показатели — заполните ${miss}, и я разложу путь на горизонты 1–30 / 31–60 / 61–90 дней.`,
    s79_missFallback: 'цель на 12 мес и текущую выручку',
    s79_horizons: ['1–30 дней', '31–60 дней', '61–90 дней'],
    s79_lever: (label, effect) => `\n\nРычаг с наибольшим эффектом: ${label} — ${effect}.`,
    s79_body: (plan, leverPart) => `Фокус на 90 дней:\n- ${plan}${leverPart}`,
    s710_notRun:
      'AI-анализ ещё не запускался. Нажмите «Запустить AI-анализ» — я разберу сильные и слабые стороны, риски и возможности по вашим данным.',
    s710_insufficient: (missPart) =>
      `для надёжных выводов.${missPart} Загрузите эти данные и запустите анализ снова.`,
    s710_miss: (list) => ` Не хватает: ${list}.`,
    s710_strengths: 'Сильные стороны',
    s710_risks: 'Риски',
    s710_opportunities: 'Возможности',
    s710_nextActions: 'Следующие шаги',
    s710_body: (summary, body, confidence) =>
      `${summary}${body}\n\nУверенность анализа: ${confidence}%.`,
    s711_intro:
      'Живой эксперт нужен, когда: в данных есть противоречия, цель выглядит нереалистичной, или вы просто хотите проверку человеком.',
    s711_triggerUnrealistic: 'цель оценена как малореалистичная',
    s711_triggers: (list) => ` Сейчас сработали триггеры: ${list}.`,
    s711_noTriggers:
      ' Сейчас критичных триггеров не вижу, но вы можете запросить проверку в любой момент.',
    s711_body: (intro, triggerPart) =>
      `${intro}${triggerPart} Нажмите «Позвать эксперта» — я создам заявку и закреплённый специалист посмотрит ваш кейс.`,
    s712_body: (status) =>
      `Ваши данные видят только вы и закреплённые специалисты платформы для диагностики — третьим лицам они не передаются. Эксперт/администратор видит статус заполнения (сейчас: «${status}») и заявки на проверку, чтобы помогать вам, но не данные других клиентов.`,
  },
  en: {
    insufficient: 'Not enough data',
    money: (n) => `${Math.round(n).toLocaleString('en-US')} ₸`,
    s71_intro:
      'AIStart360 turns your business from gut feel into numbers: Point A — an objective assessment today, Point B — the goal, the Growth Map — the path between them.',
    s71_filled: (pct) => `Your survey is ${pct}% complete.`,
    s71_score: (score, stagePart, pct) =>
      `Right now your overall score is ${score}/100${stagePart}. The survey is ${pct}% complete.`,
    s71_stage: (stage) => `, stage — "${stage}"`,
    s71_nudge: (pct, next) =>
      `You've filled ${pct}% so far — to get the most value, ${next}.`,
    s71_add: (list) => `add: ${list}`,
    s71_runPointA: 'run the Point A calculation',
    s72_intro:
      'The dashboard pulls everything into one screen: Point A (the score), key metrics, risks, AI insights and the growth map.',
    s72_noDiag: (status) =>
      `the dashboard comes alive once Point A is calculated — complete the survey or upload reports (current status: "${status}").`,
    s72_weakNamed: (label, score) =>
      `Look first at the weakest Point A block — "${label}" (${score}/100).`,
    s72_weak: 'Look first at the weakest Point A block.',
    s72_risk: (text) => ` Nearest risk: ${text}.`,
    s73_doneNone: 'No fully completed sections yet.',
    s73_done: (list) => `Fully done: ${list}.`,
    s73_allDone: (pct, donePart) =>
      `${pct}% complete. ${donePart} All required fields are filled — you can run the analysis.`,
    s73_next: (label, list) => ` Next step — the "${label}" section: ${list}.`,
    s73_remaining: (pct, donePart, list, nextPart) =>
      `${pct}% complete. ${donePart} Still to fill in: ${list}.${nextPart}`,
    s74_revenue: 'no revenue data → upload a P&L / management report',
    s74_funnel: 'no funnel → export a deals report from your CRM',
    s74_base: 'no client base → an export from CRM/Excel',
    s74_refine: (gaps) =>
      `Key reports are uploaded. For a more accurate analysis you could add: ${gaps}.`,
    s74_allGood:
      'The key data is in place. Optionally you can upload clarifying exports (a detailed P&L, a monthly funnel, an RFM export) — but it is not required.',
    s74_close: (list) => `for an accurate analysis. Close the gaps with documents:\n- ${list}`,
    s75_noDiag:
      'Point A has not been calculated yet. Complete the survey or upload reports — then I\'ll show the overall score, the health index and a per-block breakdown.',
    s75_health: (h) => `, health index ${h}`,
    s75_stage: (stage) => `, stage "${stage}"`,
    s75_strong: (list) => ` Strongest: ${list}.`,
    s75_weak: (list) => ` Weakest: ${list}.`,
    s75_body: (score, healthPart, stagePart, strongPart, weakPart) =>
      `Point A is an as-is snapshot: overall score ${score}/100${healthPart}${stagePart}.${strongPart}${weakPart}`,
    s76_noGoal: (missPart) =>
      `for Point B: set your current revenue and a 12-month goal — then I'll compute the gap and the required growth rate.${missPart}`,
    s76_miss: (list) => ` Missing: ${list}.`,
    s76_cagr: (cagr) => `, required CAGR ${cagr}%`,
    s76_body: (mult, cagrPart, level, rationalePart) =>
      `Gap to the goal: ×${mult}${cagrPart}. Realism: ${level}.${rationalePart}`,
    s77_intro: 'GRI is a growth-readiness index across 7 blocks (0–10 scale).',
    s77_noAssessment: (intro) =>
      `${intro} the GRI assessment is not filled in yet — complete it to see your index and main growth constraints.`,
    s77_limits: (list) => ` ${list}.`,
    s77_noLimits: ' The main constraints have not been identified yet.',
    s77_body: (intro, idx, limitsPart) => `${intro} Your index is ${idx}/10.${limitsPart}`,
    s78_revenueRow: (m) => `Revenue: ${m}`,
    s78_revenueGap: 'revenue — add a P&L / management report',
    s78_avgCheckRow: (m) => `Average check: ${m}`,
    s78_avgCheckGap: 'average check — add sales data',
    flagOk: 'healthy',
    flagRisk: 'at risk',
    s78_ltvRow: (ratio, flag) => `LTV/CAC: ${ratio}× (${flag})`,
    s78_ltvGap: 'LTV/CAC — add acquisition cost and customer value',
    s78_funnelRow: (funnel, flag) => `Lead → sale conversion: ${funnel}% (${flag})`,
    s78_funnelGap: 'funnel — export a deals report from your CRM',
    s78_available: (list) => `Available metrics:\n- ${list}`,
    s78_gaps: (sep, list) => `${sep}for some metrics:\n- ${list}`,
    s78_empty: 'add financial and sales data so I can show a metrics snapshot.',
    s79_noData: (miss) =>
      `for the growth map: I need a goal and current figures — fill in ${miss}, and I'll lay the path out across the 1–30 / 31–60 / 61–90 day horizons.`,
    s79_missFallback: 'a 12-month goal and current revenue',
    s79_horizons: ['Days 1–30', 'Days 31–60', 'Days 61–90'],
    s79_lever: (label, effect) => `\n\nHighest-impact lever: ${label} — ${effect}.`,
    s79_body: (plan, leverPart) => `90-day focus:\n- ${plan}${leverPart}`,
    s710_notRun:
      'The AI analysis has not been run yet. Click "Run AI analysis" — I\'ll break down strengths and weaknesses, risks and opportunities from your data.',
    s710_insufficient: (missPart) =>
      `for reliable conclusions.${missPart} Upload this data and run the analysis again.`,
    s710_miss: (list) => ` Missing: ${list}.`,
    s710_strengths: 'Strengths',
    s710_risks: 'Risks',
    s710_opportunities: 'Opportunities',
    s710_nextActions: 'Next actions',
    s710_body: (summary, body, confidence) =>
      `${summary}${body}\n\nAnalysis confidence: ${confidence}%.`,
    s711_intro:
      'You need a human expert when: there are contradictions in the data, the goal looks unrealistic, or you simply want a human review.',
    s711_triggerUnrealistic: 'the goal is rated as barely realistic',
    s711_triggers: (list) => ` Triggers currently firing: ${list}.`,
    s711_noTriggers:
      ' I don\'t see critical triggers right now, but you can request a review at any time.',
    s711_body: (intro, triggerPart) =>
      `${intro}${triggerPart} Click "Call an expert" — I'll create a case and an assigned specialist will review it.`,
    s712_body: (status) =>
      `Your data is seen only by you and the platform specialists assigned for diagnostics — it is not shared with third parties. The expert/admin sees the completion status (currently: "${status}") and review cases in order to help you, but never other clients' data.`,
  },
}

/** Human label for a survey question key (falls back to the raw key). */
function label(key: string): string {
  return SURVEY_LABELS[key] ?? key
}

/** Render up to `n` missing-required keys as a readable, comma-joined list. */
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

export interface HydratedScript {
  /**
   * The hydrated answer in the requested locale. Kept named `answer_ru` for
   * backward compatibility with the chat route + panel; it carries Russian when
   * locale==='ru' and English when locale==='en'.
   */
  answer_ru: string
  used_data: string[]
  insufficient: boolean
}

/**
 * Fill the locale-matched outline against `ctx`. Pure: depends only on
 * (script, ctx, locale). Each numeric slot is null-guarded; a referenced-but-null
 * field flips the answer to the honest "Недостаточно данных …" / "Not enough
 * data …" branch and marks the result `insufficient`. `used_data` lists the ctx
 * paths actually consumed. Defaults to Russian.
 */
export function hydrate(
  script: ChatScript,
  ctx: AssistantContext,
  locale: Locale = DEFAULT_LOCALE,
): HydratedScript {
  const t = COPY[locale] ?? COPY[DEFAULT_LOCALE]
  const INSUFFICIENT = t.insufficient
  const used: string[] = []
  const use = (path: string) => {
    if (!used.includes(path)) used.push(path)
  }

  switch (script.id) {
    // ── 7.1 Главная ценность / Main value ───────────────────────────────────
    case '7.1': {
      const completion = computeCompletion(ctx)
      use('completion.overall_pct')
      const intro = t.s71_intro

      const score = ctx.pointA.overall_score
      const stage = ctx.pointA.stage
      if (ctx.pointA.has_diagnostic && hasNum(score)) {
        use('ctx.pointA.overall_score')
        const stagePart = stage ? t.s71_stage(stage) : ''
        if (stage) use('ctx.pointA.stage')
        return {
          answer_ru: `${intro} ${t.s71_score(score, stagePart, completion.overall_pct)}`,
          used_data: used,
          insufficient: false,
        }
      }

      // No diagnostic yet → honest, completion-driven nudge (no invented score).
      use('completion.missing_required')
      const next = completion.missing_required.length
        ? t.s71_add(missingList(completion.missing_required))
        : t.s71_runPointA
      return {
        answer_ru: `${intro} ${INSUFFICIENT} — ${t.s71_nudge(completion.overall_pct, next)}`,
        used_data: used,
        insufficient: true,
      }
    }

    // ── 7.2 Dashboard ──────────────────────────────────────────────────────
    case '7.2': {
      const completion = computeCompletion(ctx)
      use('completion.status')
      const intro = t.s72_intro

      if (!ctx.pointA.has_diagnostic) {
        return {
          answer_ru: `${intro} ${INSUFFICIENT}: ${t.s72_noDiag(completion.status)}`,
          used_data: used,
          insufficient: true,
        }
      }

      use('ctx.pointA.blocks')
      const weakest = [...ctx.pointA.blocks].sort((a, b) => a.score - b.score)[0]
      const weakPart =
        weakest && hasNum(weakest.score)
          ? t.s72_weakNamed(weakest.label, weakest.score)
          : t.s72_weak

      const risk = ctx.pointA.risks[0]
      let riskPart = ''
      if (risk) {
        use('ctx.pointA.risks[0]')
        riskPart = t.s72_risk(risk.text)
      }
      return {
        answer_ru: `${intro} ${weakPart}${riskPart}`,
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.3 Анкета / Survey ─────────────────────────────────────────────────
    case '7.3': {
      const completion = computeCompletion(ctx)
      use('completion.overall_pct')
      use('completion.sections')

      const done = completion.sections.filter((s) => s.pct >= 100).map((s) => s.label)
      const donePart = done.length ? t.s73_done(done.join(', ')) : t.s73_doneNone

      if (completion.missing_required.length === 0) {
        return {
          answer_ru: t.s73_allDone(completion.overall_pct, donePart),
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
        ? t.s73_next(nextSection.label, missingList(nextSection.missing_required))
        : ''
      return {
        answer_ru: t.s73_remaining(
          completion.overall_pct,
          donePart,
          missingList(completion.missing_required, 5),
          nextPart,
        ),
        used_data: used,
        insufficient: completion.overall_pct < 100,
      }
    }

    // ── 7.4 Загрузка файлов / File upload ───────────────────────────────────
    case '7.4': {
      const completion = computeCompletion(ctx)
      const recs: string[] = []

      use('ctx.pointB.data_sufficiency.missing')
      const sufMissing = ctx.pointB.data_sufficiency?.missing ?? []

      // Map concrete gaps → concrete documents (deterministic, no numbers).
      const revenueMissing =
        answerNum(ctx, 's9n_revenue_2024') == null && answerNum(ctx, 's2_revenue_2024') == null
      use('ctx.answers.s9n_revenue_2024')
      if (revenueMissing) recs.push(t.s74_revenue)

      const funnelMissing =
        answerNum(ctx, 's5n_funnel_lead_to_sale') == null &&
        answerNum(ctx, 's5n_funnel_call_to_sale') == null
      use('ctx.answers.s5n_funnel_*')
      if (funnelMissing) recs.push(t.s74_funnel)

      const baseMissing = !ctx.answers?.['s5n_client_list_table']
      use('ctx.answers.s5n_client_list_table')
      if (baseMissing) recs.push(t.s74_base)

      if (recs.length === 0 && (sufMissing.length > 0 || completion.missing_required.length > 0)) {
        use('completion.missing_required')
        const gaps = sufMissing.length ? sufMissing : completion.missing_required.map(label)
        return {
          answer_ru: t.s74_refine(gaps.slice(0, 3).join(', ')),
          used_data: used,
          insufficient: false,
        }
      }

      if (recs.length === 0) {
        return {
          answer_ru: t.s74_allGood,
          used_data: used,
          insufficient: false,
        }
      }

      return {
        answer_ru: `${INSUFFICIENT} ${t.s74_close(recs.join('\n- '))}`,
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
          answer_ru: `${INSUFFICIENT}: ${t.s75_noDiag}`,
          used_data: used,
          insufficient: true,
        }
      }
      use('ctx.pointA.overall_score')

      const healthPart = hasNum(health) ? t.s75_health(health) : ''
      if (hasNum(health)) use('ctx.pointA.health_index')
      const stagePart = stage ? t.s75_stage(stage) : ''
      if (stage) use('ctx.pointA.stage')

      use('ctx.pointA.blocks')
      const sorted = [...ctx.pointA.blocks].filter((b) => hasNum(b.score)).sort((a, b) => b.score - a.score)
      const fmt = (b: { label: string; score: number }) => `${b.label} (${b.score}/100)`
      const strong = sorted.slice(0, 2).map(fmt)
      const weak = sorted.slice(-2).reverse().map(fmt)
      const strongPart = strong.length ? t.s75_strong(strong.join(', ')) : ''
      const weakPart = weak.length ? t.s75_weak(weak.join(', ')) : ''

      return {
        answer_ru: t.s75_body(score, healthPart, stagePart, strongPart, weakPart),
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
        const missPart = miss.length ? t.s76_miss(miss.slice(0, 3).join(', ')) : ''
        return {
          answer_ru: `${INSUFFICIENT} ${t.s76_noGoal(missPart)}`,
          used_data: used,
          insufficient: true,
        }
      }

      use('ctx.pointB.realism.level')
      const level = ctx.pointB.realism.level
      const cagrPart = hasNum(cagr) ? t.s76_cagr(cagr) : ''
      let rationalePart = ''
      const rationale = ctx.pointB.realism.rationale?.[0]
      if (rationale) {
        use('ctx.pointB.realism.rationale[0]')
        rationalePart = ` ${rationale}`
      }
      return {
        answer_ru: t.s76_body(mult, cagrPart, level, rationalePart),
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.7 GRI ────────────────────────────────────────────────────────────
    case '7.7': {
      const idx = ctx.gri.gri_index
      use('ctx.gri.gri_index')
      const intro = t.s77_intro

      if (!ctx.gri.has_assessment || !hasNum(idx)) {
        return {
          answer_ru: t.s77_noAssessment(`${intro} ${INSUFFICIENT}:`),
          used_data: used,
          insufficient: true,
        }
      }

      use('ctx.gri.top_5_limits')
      const top3 = ctx.gri.top_5_limits.slice(0, 3)
      const limitsPart = top3.length
        ? t.s77_limits(
            top3.map((l, i) => `${i + 1}) ${l.title}${l.block ? ` (${l.block})` : ''}`).join('; '),
          )
        : t.s77_noLimits
      return {
        answer_ru: t.s77_body(intro, idx, limitsPart),
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.8 Метрики / Metrics ───────────────────────────────────────────────
    case '7.8': {
      const rows: string[] = []
      const gaps: string[] = []

      // Revenue: prefer canonical metrics, fall back to survey, else gap.
      const revenue = hasNum(ctx.metrics.revenue)
        ? ctx.metrics.revenue
        : answerNum(ctx, 's9n_revenue_2024') ?? answerNum(ctx, 's2_revenue_2024')
      use('ctx.metrics.revenue')
      use('ctx.answers.s9n_revenue_2024')
      if (hasNum(revenue)) rows.push(t.s78_revenueRow(t.money(revenue)))
      else gaps.push(t.s78_revenueGap)

      const avgCheck = answerNum(ctx, 's2_avg_check') ?? answerNum(ctx, 's7_avg_check_target_kzt')
      use('ctx.answers.s2_avg_check')
      if (hasNum(avgCheck)) rows.push(t.s78_avgCheckRow(t.money(avgCheck)))
      else gaps.push(t.s78_avgCheckGap)

      const ltv = answerNum(ctx, 's2_ltv')
      const cac = answerNum(ctx, 's2_cac')
      use('ctx.answers.s2_ltv')
      use('ctx.answers.s2_cac')
      if (hasNum(ltv) && hasNum(cac) && cac > 0) {
        const ratio = Math.round((ltv / cac) * 10) / 10
        const flag = ratio >= 3 ? t.flagOk : t.flagRisk
        rows.push(t.s78_ltvRow(ratio, flag))
      } else {
        gaps.push(t.s78_ltvGap)
      }

      const funnel = answerNum(ctx, 's5n_funnel_lead_to_sale')
      use('ctx.answers.s5n_funnel_lead_to_sale')
      if (hasNum(funnel)) {
        const flag = funnel >= 20 ? t.flagOk : t.flagRisk
        rows.push(t.s78_funnelRow(funnel, flag))
      } else {
        gaps.push(t.s78_funnelGap)
      }

      const rowsPart = rows.length ? t.s78_available(rows.join('\n- ')) : ''
      const gapsPart = gaps.length
        ? t.s78_gaps(`${rows.length ? '\n\n' : ''}${INSUFFICIENT} `, gaps.join('\n- '))
        : ''
      return {
        answer_ru: (rowsPart + gapsPart).trim() || `${INSUFFICIENT}: ${t.s78_empty}`,
        used_data: used,
        insufficient: gaps.length > 0,
      }
    }

    // ── 7.9 Карта роста / Growth Map ────────────────────────────────────────
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
          : t.s79_missFallback
        return {
          answer_ru: `${INSUFFICIENT} ${t.s79_noData(miss)}`,
          used_data: used,
          insufficient: true,
        }
      }

      // Distribute the top-5 GRI limits across the three 30-day horizons.
      const horizons: [string, string][] = [
        [t.s79_horizons[0], ''],
        [t.s79_horizons[1], ''],
        [t.s79_horizons[2], ''],
      ]
      top5.slice(0, 3).forEach((l, i) => {
        horizons[i][1] = l.title
      })
      const plan = horizons
        .filter(([, txt]) => txt)
        .map(([h, txt]) => `${h}: ${txt}`)
        .join('\n- ')

      use('ctx.pointB.levers')
      const lever = [...ctx.pointB.levers]
        .filter((l) => l.data_available)
        .sort((a, b) => b.expected_effect.length - a.expected_effect.length)[0]
      const leverPart = lever ? t.s79_lever(lever.label, lever.expected_effect) : ''
      return {
        answer_ru: t.s79_body(plan, leverPart),
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.10 AI-инсайты / AI insights ───────────────────────────────────────
    case '7.10': {
      use('ctx.llm_analysis')
      const a = ctx.llm_analysis
      if (!a) {
        return {
          answer_ru: t.s710_notRun,
          used_data: used,
          insufficient: true,
        }
      }

      if (a.insufficient_data) {
        use('ctx.llm_analysis.missing_data')
        const miss = a.missing_data?.slice(0, 4) ?? []
        const missPart = miss.length ? t.s710_miss(miss.join(', ')) : ''
        return {
          answer_ru: `${INSUFFICIENT} ${t.s710_insufficient(missPart)}`,
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
        block(t.s710_strengths, a.strengths, 'ctx.llm_analysis.strengths') +
        block(t.s710_risks, a.risks, 'ctx.llm_analysis.risks') +
        block(t.s710_opportunities, a.opportunities, 'ctx.llm_analysis.opportunities') +
        block(t.s710_nextActions, a.next_actions, 'ctx.llm_analysis.next_actions')
      return {
        answer_ru: t.s710_body(a.situation_summary, body, Math.round((a.confidence ?? 0) * 100)),
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.11 Экспертная проверка / Expert review ────────────────────────────
    case '7.11': {
      const intro = t.s711_intro
      const triggers: string[] = []

      use('ctx.pointB.realism.level')
      const level = (ctx.pointB.realism?.level ?? '').toLowerCase()
      if (level === 'unrealistic' || level === 'нереалистична' || level === 'low') {
        triggers.push(t.s711_triggerUnrealistic)
      }

      const triggerPart = triggers.length
        ? t.s711_triggers(triggers.join('; '))
        : t.s711_noTriggers
      return {
        answer_ru: t.s711_body(intro, triggerPart),
        used_data: used,
        insufficient: false,
      }
    }

    // ── 7.12 Админ-панель / Admin panel ─────────────────────────────────────
    case '7.12': {
      const completion = computeCompletion(ctx)
      use('completion.status')
      return {
        answer_ru: t.s712_body(completion.status),
        used_data: used,
        insufficient: false,
      }
    }

    default: {
      // Unknown script id — never fabricate; fall back to the outline verbatim
      // in the requested locale.
      return {
        answer_ru: locale === 'en' ? script.outline_en : script.scriptOutline,
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
