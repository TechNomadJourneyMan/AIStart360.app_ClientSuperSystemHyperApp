/**
 * lib/survey/questions.ts — the registry of the 174 questionnaire questions
 * (spec 2026-10-23 «три режима анкеты» §5.5, appendix A).
 *
 * One place that knows, for every `survey_answers.question_key`: the wizard
 * step, a label that reads on its own («Мои ответы», GIGA, the expert), the
 * label as the step form shows it, the answer type and unit, the choice
 * options, whether «Не знаю» / «примерно» are offered, where the question
 * lives in the express flow or in a deepening block, why we ask, the term it
 * explains, its twin question, whether it is delicate, how the AI chat treats
 * it, and which «Минимум для Точки А» checks it closes.
 *
 * The 12 step forms (components/onboarding/steps/Step*.tsx) are NOT generated
 * from this file (spec §3): they stay the owners of their layout, and
 * tests/unit/survey/questions.test.ts checks the registry against them (keys,
 * steps, labels, options, number fields) so the two cannot drift apart.
 *
 * Pure and browser-safe: data plus a few lookups. «Где взять цифру» is
 * written separately (lib/survey/where-to-find.ts) and merged here.
 */
import { CHECK_INPUTS } from '@/lib/point-a/v4/check-input-keys'
import { FIELD_NOTES } from '@/components/onboarding/constants/step-config'
import {
  BUSINESS_MODELS, INDUSTRIES, MARKETING_CHANNELS, REGIONS, REPORTING_TOOLS,
} from '@/components/onboarding/constants/options'
import { SURVEY_KEY_STEP, AUTO_KEYS } from './steps'
import type { SurveyTerm } from './terms'
import { WHERE_TO_FIND } from './where-to-find'

// ─── Types ───────────────────────────────────────────────────────────────────

export const SURVEY_QUESTION_TYPES = [
  'text', 'longtext', 'number', 'money', 'percent', 'select', 'multiselect', 'bool', 'scale', 'table', 'file', 'auto',
] as const
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number]

/** Deepening blocks of the «Экспресс + блоки» mode (appendix A). */
export const SURVEY_BLOCK_IDS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11', 'b12', 'b13', 'b14', 'b15'] as const
export type SurveyBlockId = (typeof SURVEY_BLOCK_IDS)[number]
/** Where a question lives in mode 2: the express flow or one deepening block. */
export type SurveyPlace = 'express' | SurveyBlockId

export interface SurveyOption { value: string; label: string }

/** A Point A v4 check this question closes («Минимум для Точки А»). */
export interface MinimumRef { block: string; check: string }

export interface SurveyQuestion {
  /** survey_answers.question_key. */
  key: string
  /** Step of the full questionnaire (SURVEY_KEY_STEP). */
  step: number
  /** Order inside the step (as the form shows it). */
  order: number
  /** A label that reads without the form around it (views, GIGA, expert, PDF). */
  label: string
  /**
   * The label exactly as the step form shows it; null when the form builds it
   * at run time (year labels, «Конкурент {n}»).
   */
  formLabel: string | null
  /** The question in plain words (express screens, the AI chat). */
  plain?: string
  type: SurveyQuestionType
  /** '₸', '₸/мес', '₸/год', '%', 'дней', 'ч/день', 'чел.' … */
  unit?: string
  /** Stored values never change; only labels may. */
  options?: readonly SurveyOption[]
  /** Scale bounds (sliders). */
  range?: readonly [number, number]
  /** Whole number (no decimals). */
  integer?: boolean
  /** Negative numbers allowed (loss, NPS). */
  allowNegative?: boolean
  /** «Не знаю / не считаем» is offered (as NumberField in the form). */
  allowUnknown: boolean
  /** «Примерно» (a range) is offered — money questions. */
  allowApprox: boolean
  /** Mode 2: the express flow or a deepening block (appendix A). */
  place: SurveyPlace
  /** Express screen number (1..15) when `place === 'express'`. */
  express?: { screen: number }
  /** Why we ask (one line; delicate questions say «можно пропустить»). */
  why?: string
  /** Where to find the number — one line (lib/survey/where-to-find.ts has the details). */
  whereToFind?: string
  term?: SurveyTerm
  /** A twin question (spec §7.6): modes 2 and 3 offer its answer, never copy it silently. */
  twin?: string
  /** Delicate: shown with a «можно пропустить» note (FIELD_NOTES). */
  delicate: boolean
  /** The AI chat: ask it, send to the form (tables, files, contacts), or skip (auto keys). */
  chat: 'ask' | 'form_only' | 'skip'
  /** «Год = месяц × 12»: computed from `autoFrom`, not a question. */
  auto: boolean
  autoFrom?: string
  /** «Минимум для Точки А» checks this key answers (from CHECK_INPUTS). */
  minimum: readonly MinimumRef[]
}

type Def = Omit<SurveyQuestion, 'step' | 'order' | 'allowUnknown' | 'allowApprox' | 'delicate' | 'chat' | 'auto' | 'minimum' | 'place' | 'why' | 'whereToFind'> & {
  allowUnknown?: boolean
  allowApprox?: boolean
  chat?: SurveyQuestion['chat']
  autoFrom?: string
}

// ─── Options (values exactly as the forms store them) ───────────────────────

const opts = (list: ReadonlyArray<string | { value: string; label: string }>): SurveyOption[] =>
  list.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label }))

/** Step 2 «Барьеры роста» (the form keeps its own copy of this list). */
const GROWTH_BLOCKERS = [
  'Деньги / Финансирование', 'Команда / Кадры', 'Процессы / Операции', 'Технологии / IT',
  'Рынок / Конкуренция', 'Маркетинг / Продажи', 'Другое',
]
const PRICE_SEGMENTS = [{ value: 'economy', label: 'Эконом' }, { value: 'medium', label: 'Средний' }, { value: 'premium', label: 'Премиум' }]
const PLANNING_OPTIONS = [{ value: 'one_person', label: 'Один человек' }, { value: 'team', label: 'Команда' }]
const CONTROL_OPTIONS = [
  { value: 'reports', label: 'Отчёты' }, { value: 'tasks', label: 'Задачи' }, { value: 'kpi', label: 'KPI' }, { value: 'fire_fighting', label: 'Тушение пожаров' },
]
const FREQ_OPTIONS = [{ value: 'daily', label: 'Ежедневно' }, { value: 'weekly', label: 'Еженедельно' }, { value: 'monthly', label: 'Ежемесячно' }]
const PLANNING_FREQ = [
  { value: 'never', label: 'Не планируем' }, { value: 'monthly', label: 'Ежемесячно' },
  { value: 'quarterly', label: 'Ежеквартально' }, { value: 'yearly', label: 'Ежегодно' },
]
const ANALYSIS_FREQ = [{ value: 'never', label: 'Не анализируем' }, { value: 'monthly', label: 'Ежемесячно' }, { value: 'quarterly', label: 'Ежеквартально' }]
const CRM_TOOLS = [
  { value: 'none', label: 'Нет' }, { value: 'bitrix24', label: 'Bitrix24' }, { value: 'amocrm', label: 'AmoCRM' },
  { value: '1c', label: '1C' }, { value: 'excel', label: 'Excel' }, { value: 'other', label: 'Другая' },
]
const EDM_OPTIONS = [
  { value: 'none', label: 'Нет' }, { value: '1c_doc', label: '1С:Документооборот' }, { value: 'elma', label: 'ELMA' },
  { value: 'docsvision', label: 'DocsVision' }, { value: 'other', label: 'Другой' },
]
const ERP_OPTIONS = [
  { value: 'none', label: 'Нет' }, { value: '1c_erp', label: '1С:ERP' }, { value: 'sap', label: 'SAP' },
  { value: 'oracle', label: 'Oracle' }, { value: 'other', label: 'Другая' },
]
const BI_OPTIONS = [
  { value: 'none', label: 'Нет' }, { value: 'power_bi', label: 'Power BI' }, { value: 'tableau', label: 'Tableau' },
  { value: 'google_ds', label: 'Google Data Studio / Looker' }, { value: 'excel', label: 'Excel' }, { value: 'other', label: 'Другой' },
]
const MESSENGER_OPTIONS = [
  { value: 'telegram', label: 'Telegram' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'slack', label: 'Slack' },
  { value: 'teams', label: 'Microsoft Teams' }, { value: 'other', label: 'Другой' },
]
const TELEPHONY_OPTIONS = [
  { value: 'none', label: 'Нет' }, { value: 'mango', label: 'Mango Office' }, { value: 'sipuni', label: 'Sipuni' },
  { value: 'zadarma', label: 'Zadarma' }, { value: 'asterisk', label: 'Asterisk' }, { value: 'other', label: 'Другая' },
]
const PROJECT_MGMT_OPTIONS = [
  { value: 'none', label: 'Нет' }, { value: 'trello', label: 'Trello' }, { value: 'jira', label: 'Jira' }, { value: 'notion', label: 'Notion' },
  { value: 'asana', label: 'Asana' }, { value: 'bitrix24', label: 'Bitrix24' }, { value: 'other', label: 'Другой' },
]
const MARKETING_PLATFORM_OPTIONS = [
  { value: 'none', label: 'Нет' }, { value: 'google_ads', label: 'Google Ads' }, { value: 'yandex_direct', label: 'Яндекс.Директ' },
  { value: 'meta_ads', label: 'Meta Ads (Facebook/Instagram)' }, { value: 'sendpulse', label: 'SendPulse' }, { value: 'other', label: 'Другие' },
]

// ─── Shorthands ──────────────────────────────────────────────────────────────

const long = (key: string, label: string, formLabel: string | null = label, extra: Partial<Def> = {}): Def =>
  ({ key, label, formLabel, type: 'longtext', ...extra })
const text = (key: string, label: string, formLabel: string | null = label, extra: Partial<Def> = {}): Def =>
  ({ key, label, formLabel, type: 'text', ...extra })
const bool = (key: string, label: string, formLabel: string | null = label, extra: Partial<Def> = {}): Def =>
  ({ key, label, formLabel, type: 'bool', ...extra })
const select = (key: string, label: string, formLabel: string | null, options: SurveyOption[], extra: Partial<Def> = {}): Def =>
  ({ key, label, formLabel, type: 'select', options, ...extra })
const num = (key: string, label: string, formLabel: string | null, unit: string | undefined, extra: Partial<Def> = {}): Def =>
  ({ key, label, formLabel, type: 'number', unit, ...extra })
const pct = (key: string, label: string, formLabel: string | null, extra: Partial<Def> = {}): Def =>
  ({ key, label, formLabel, type: 'percent', unit: '%', ...extra })
const money = (key: string, label: string, formLabel: string | null, unit = '₸', extra: Partial<Def> = {}): Def =>
  ({ key, label, formLabel, type: 'money', unit, integer: true, allowApprox: true, ...extra })
const table = (key: string, label: string, formLabel: string): Def => ({ key, label, formLabel, type: 'table', chat: 'form_only' })
const file = (key: string, label: string, formLabel: string): Def => ({ key, label, formLabel, type: 'file', chat: 'form_only' })
const auto = (key: string, label: string, from: string): Def =>
  ({ key, label, formLabel: 'Выручка / год, ₸ (автоматически)', type: 'auto', unit: '₸/год', integer: true, autoFrom: from, chat: 'skip' })

// ─── The 12 steps, in form order ─────────────────────────────────────────────

const STEP_DEFS: Record<number, Def[]> = {
  1: [
    text('s1_company_name', 'Название компании', 'Название компании', { chat: 'form_only', plain: 'Как называется компания?' }),
    select('s1_industry', 'Отрасль', 'Отрасль', opts(INDUSTRIES), { plain: 'Чем занимается компания — какая отрасль?' }),
    num('s1_employee_count', 'Количество сотрудников', 'Кол-во сотрудников', 'чел.', { integer: true, allowUnknown: false, plain: 'Сколько человек в команде, включая вас?' }),
    select('s1_business_model', 'Бизнес-модель', 'Бизнес-модель', opts(BUSINESS_MODELS), { plain: 'Кому вы продаёте — компаниям, людям или и тем и другим?' }),
    num('s1_years_on_market', 'Лет на рынке', 'Лет на рынке', 'лет', { integer: true, allowUnknown: false }),
    text('s1_website', 'Сайт компании', 'Веб-сайт'),
    text('s1_social_media', 'Соцсети компании', 'Социальные сети компании / владельца'),
    { key: 's1_regions', label: 'География присутствия', formLabel: 'Регионы', type: 'multiselect', options: opts(REGIONS) },
    file('s1_uploaded_files', 'Загруженные файлы', 'Загрузка данных за 3 года'),
    money('s1_current_revenue_month', 'Текущая выручка / месяц', 'Выручка в месяц', '₸/мес', { plain: 'Сколько денег приходит от клиентов в месяц сейчас?' }),
    auto('s1_current_revenue_year', 'Текущая выручка / год', 's1_current_revenue_month'),
    money('s1_goal_12m_revenue_month', 'Цель через 12 мес — выручка / месяц', 'Выручка в месяц', '₸/мес', { allowUnknown: false, plain: 'Какую выручку в месяц хотите через год?' }),
    auto('s1_goal_12m_revenue_year', 'Цель через 12 мес — выручка / год', 's1_goal_12m_revenue_month'),
    money('s1_goal_3y_revenue_month', 'Цель через 3 года — выручка / месяц', 'Выручка в месяц', '₸/мес', { allowUnknown: false, plain: 'А через 3 года — сколько в месяц?' }),
    auto('s1_goal_3y_revenue_year', 'Цель через 3 года — выручка / год', 's1_goal_3y_revenue_month'),
    long('s1_products_list', 'Список продуктов/услуг', 'Список продуктов / услуг'),
    long('s1_competitors_list', 'Основные конкуренты', 'Основные конкуренты'),
    text('s1_contact_name', 'Контактное лицо (ФИО)', 'ФИО', { chat: 'form_only' }),
    text('s1_contact_position', 'Должность контактного лица', 'Должность', { chat: 'form_only' }),
    text('s1_contact_phone', 'Телефон', 'Телефон', { chat: 'form_only' }),
    text('s1_contact_email', 'Email контакта', 'Email', { chat: 'form_only' }),
  ],
  2: [
    long('s2n_goal_12m_what', 'Цель на 12 месяцев — что', 'Что хотите достичь', { plain: 'Ради чего эта цель? Одной фразой' }),
    long('s2n_goal_12m_metrics', 'Цель на 12 месяцев — метрики', 'Метрики достижения'),
    long('s2n_goal_3y_what', 'Цель на 3 года — что', 'Что хотите достичь за 3 года'),
    long('s2n_goal_3y_metrics', 'Цель на 3 года — метрики', 'Метрики на 3 года'),
    long('s2n_tried_for_growth', 'Что уже пробовали для роста', 'Что уже пробовали для роста'),
    long('s2n_what_blocks_growth', 'Что мешает расти', 'Что мешает расти'),
    long('s6_main_pain', 'Главная боль бизнеса', 'Главная боль бизнеса', { plain: 'Что сейчас болит в бизнесе сильнее всего?' }),
    { key: 's6_growth_blockers', label: 'Барьеры роста', formLabel: 'Барьеры роста', type: 'multiselect', options: opts(GROWTH_BLOCKERS), plain: 'Что мешает расти?' },
    long('s6_expectations', 'Ожидания от платформы', 'Ожидания от платформы'),
  ],
  3: [
    long('s5_target_audience', 'Целевая аудитория', 'Целевая аудитория', { plain: 'Кто ваш клиент?' }),
    long('s3n_client_portrait', 'Портрет клиента', 'Портрет клиента'),
    select('s3n_price_segment', 'Ценовой сегмент', 'Ценовой сегмент', PRICE_SEGMENTS),
    long('s3n_decision_maker', 'Лицо, принимающее решение', 'Лицо, принимающее решение', { term: 'ЛПР' }),
    long('s3n_purchase_participants', 'Участники процесса покупки', 'Участники процесса покупки'),
    long('s5_usp', 'Чем вы лучше конкурентов (УТП)', 'Чем вы лучше конкурентов?', { term: 'УТП', plain: 'Почему выбирают вас, а не других?' }),
    long('s3n_client_problem', 'Проблема клиента', 'Проблема клиента'),
    long('s3n_problem_impact', 'Влияние проблемы', 'Влияние проблемы'),
    long('s3n_current_solution', 'Текущее решение клиента', 'Текущее решение клиента'),
    long('s3n_if_unsolved', 'Если проблему не решать', 'Если проблему не решать'),
    long('s3n_life_after_solution', 'Жизнь после решения', 'Жизнь после решения'),
    long('s3n_measurable_results', 'Измеримые результаты', 'Измеримые результаты'),
    long('s3n_short_wins', 'Быстрые победы', 'Быстрые победы'),
    long('s3n_competitor_why_us', 'Почему выбирают нас, а не конкурентов', 'Почему выбирают нас'),
    long('s3n_cannot_copy', 'Что нельзя скопировать', 'Что нельзя скопировать'),
    long('s3n_competitors_better', 'В чём конкуренты лучше', 'В чём конкуренты лучше'),
    long('s3n_industry_standard', 'Отраслевой стандарт', 'Отраслевой стандарт'),
  ],
  4: [
    num('s4_dept_count', 'Количество отделов', 'Кол-во отделов', 'отд.', { integer: true, allowUnknown: false }),
    bool('s4_has_org_chart', 'Есть оргструктура', 'Есть орг. структура', { plain: 'Есть ли у компании оргструктура?' }),
    table('s4n_staffing_table', 'Штатное расписание', 'Штатное расписание'),
    bool('s4n_structure_matches', 'Структура соответствует задачам'),
    bool('s4n_open_vacancies', 'Есть открытые вакансии'),
    bool('s4n_multi_roles', 'Совмещение ролей'),
    text('s4m_strategic_planning', 'Стратегическое планирование', 'Стратегическое планирование'),
    select('s4m_planning_team_or_solo', 'Планирование — команда или один', 'Планирование', PLANNING_OPTIONS),
    select('s4m_control_method', 'Метод контроля', 'Метод контроля', CONTROL_OPTIONS, { plain: 'Как вы контролируете работу команды?' }),
    text('s4m_communication', 'Каналы коммуникации', 'Каналы коммуникации'),
    bool('s4m_dept_sync', 'Синхронизация между отделами'),
    bool('s4_has_regular_meetings', 'Регулярные совещания', 'Регулярные совещания', { plain: 'Проводите регулярные совещания?' }),
    bool('s4m_meeting_structure', 'Совещания структурированы'),
    text('s4m_meeting_efficiency', 'Эффективность совещаний', 'Эффективность совещаний'),
    text('s4m_report_types', 'Виды отчётов', 'Виды отчётов'),
    select('s4m_report_automated', 'Инструмент отчётности', 'Инструмент отчётности', opts(REPORTING_TOOLS), { plain: 'В чём собираете отчёты?' }),
    select('s4m_report_frequency', 'Частота отчётности', 'Частота отчётности', FREQ_OPTIONS),
    num('s4m_hours_on_ops', 'Часов в день на операционку (управление)', 'Часов/день на операционку', 'ч/день', { twin: 's10_hours_on_ops', plain: 'Сколько часов в день вы сами занимаетесь текучкой?' }),
    { key: 's4m_delegation_readiness', label: 'Готовность к делегированию (1–10)', formLabel: 'Готовность делегировать (1-10)', type: 'scale', range: [1, 10], twin: 's10_delegation_ready' },
  ],
  5: [
    text('s3_has_crm', 'Наличие CRM', 'Наличие CRM'),
    num('s3_deal_cycle_days', 'Цикл сделки (дней)', 'Цикл сделки (дней)', 'дней', { integer: true, plain: 'Сколько дней проходит от заявки до оплаты?' }),
    num('s3_deals_2023', 'Завершённых сделок 2023', null, 'шт.', { integer: true }),
    num('s3_deals_2024', 'Завершённых сделок 2024', null, 'шт.', { integer: true }),
    num('s3_deals_2025', 'Завершённых сделок 2025', null, 'шт.', { integer: true }),
    num('s3_rejections_2023', 'Отказов 2023', null, 'шт.', { integer: true }),
    num('s3_rejections_2024', 'Отказов 2024', null, 'шт.', { integer: true }),
    num('s3_rejections_2025', 'Отказов 2025', null, 'шт.', { integer: true }),
    text('s3_promo_channels', 'Каналы привлечения', 'Каналы привлечения'),
    num('s3_product_count', 'Количество продуктов', 'Кол-во продуктов', 'шт.', { integer: true, allowUnknown: false }),
    text('s3_flagship_product', 'Флагманский продукт', 'Флагманский продукт'),
    pct('s5n_funnel_lead_to_call', 'Конверсия лид → звонок', 'Лид -> Звонок (%)'),
    pct('s5n_funnel_call_to_meeting', 'Конверсия звонок → встреча', 'Звонок -> Встреча (%)'),
    pct('s5n_funnel_meeting_to_proposal', 'Конверсия встреча → КП', 'Встреча -> КП (%)'),
    pct('s5n_funnel_proposal_to_negotiation', 'Конверсия КП → переговоры', 'КП -> Переговоры (%)'),
    pct('s5n_funnel_negotiation_to_contract', 'Конверсия переговоры → договор', 'Переговоры -> Договор (%)'),
    pct('s5n_funnel_contract_to_payment', 'Конверсия договор → оплата', 'Договор -> Оплата (%)'),
    pct('s5n_funnel_payment_to_delivery', 'Конверсия оплата → поставка', 'Оплата -> Поставка (%)'),
    pct('s5n_funnel_lead_to_sale', 'Конверсия лид → продажа', 'Лид -> Продажа общ. (%)'),
    long('s5n_abc_analysis', 'Кто из клиентов даёт основную выручку (ABC-анализ)', 'Кто из клиентов даёт основную выручку?', { term: 'ABC-анализ' }),
    long('s5n_rfm_analysis', 'Давность, частота и сумма покупок (RFM-анализ)', 'Как давно, как часто и на сколько покупают клиенты?', { term: 'RFM-анализ' }),
    text('s5n_product_locomotive', 'Продукт-локомотив', 'Продукт-локомотив'),
    text('s5n_most_marginal', 'Самый маржинальный продукт', 'Самый маржинальный'),
    text('s5n_entry_product', 'Входной продукт', 'Входной продукт'),
    long('s5n_why_bought', 'Почему покупают', 'Почему покупают'),
    long('s5n_deciding_factor', 'Решающий фактор', 'Решающий фактор'),
    long('s5n_compared_with', 'С кем сравнивают', 'С кем сравнивают'),
    long('s5n_barriers', 'Барьеры покупки', 'Барьеры покупки'),
    long('s5n_how_found_us', 'Как нашли нас', 'Как нашли нас'),
    long('s5n_will_return_nps', 'Вернутся ли клиенты и посоветуют ли вас (NPS)', 'Вернутся ли клиенты и посоветуют ли вас?', { term: 'NPS' }),
    long('s5n_improve_suggestions', 'Что улучшить', 'Что улучшить'),
    long('s5n_upsell_crosssell', 'Допродажи (upsell / cross-sell)', 'Что ещё можно продать тем же клиентам?', { term: 'Upsell / Cross-sell' }),
  ],
  6: [
    { ...table('s6n_journey_table', 'Путь клиента (таблица этапов)', 'Путь клиента: от первого контакта до покупки'), term: 'CJM' },
    long('s6n_weak_funnel_points', 'Где теряем больше всего клиентов', 'На каких этапах теряем больше всего клиентов'),
    long('s6n_post_sale_touchpoints', 'Точки касания после продажи', 'Точки касания после продажи'),
    file('s6n_script_first_contact', 'Скрипт первого контакта', 'Скрипт первого контакта'),
    file('s6n_script_meeting', 'Скрипт встречи', 'Скрипт встречи'),
    file('s6n_script_proposal', 'Скрипт коммерческого предложения', 'Скрипт коммерческого предложения'),
  ],
  7: [
    { key: 's5_marketing_channels', label: 'Каналы маркетинга', formLabel: 'Используемые каналы', type: 'multiselect', options: opts(MARKETING_CHANNELS), plain: 'Откуда приходят клиенты?' },
    pct('s5_marketing_budget_pct', 'Бюджет маркетинга (% выручки)', 'Бюджет на маркетинг (% от выручки)', { plain: 'Какую долю выручки тратите на рекламу?' }),
    bool('s5_has_competitor_analysis', 'Есть анализ конкурентов', 'Есть конкурентный анализ', { plain: 'Разбирали конкурентов?' }),
    { ...table('s7n_channels_table', 'Эффективность каналов (таблица)', 'Эффективность каналов'), term: 'ROI' },
    long('s7n_content_strategy', 'Контент-стратегия', 'Описание контент-стратегии'),
    num('s7_leads_per_month', 'Лидов в месяц (входящие)', 'Лидов в месяц (входящие)', 'в мес', { integer: true }),
    pct('s7_no_show_rate', 'Записались и не пришли, % (no-show)', 'Сколько клиентов записались и не пришли', { term: 'no-show' }),
    pct('s7_missed_calls_rate', 'Доля пропущенных звонков (%)', 'Пропущенных звонков'),
    money('s7_avg_check_target_kzt', 'Целевой средний чек (₸)', 'Целевой средний чек', '₸'),
    num('s7_repeat_freq_days', 'Частота повторной покупки (дни)', 'Частота повторной покупки', 'дней', { integer: true }),
    num('s7_nps_score', 'Оценка клиентов по 10-балльной шкале (NPS)', 'Как клиенты оценивают вас по 10-балльной шкале?', undefined, { integer: true, allowNegative: true, term: 'NPS' }),
    text('s5_competitor_1', 'Конкурент 1', null),
    long('s7n_competitor_1_analysis', 'Анализ конкурента 1', 'Детальный анализ'),
    text('s5_competitor_2', 'Конкурент 2', null),
    long('s7n_competitor_2_analysis', 'Анализ конкурента 2', 'Детальный анализ'),
    text('s5_competitor_3', 'Конкурент 3', null),
    long('s7n_competitor_3_analysis', 'Анализ конкурента 3', 'Детальный анализ'),
  ],
  8: [
    table('s8n_metrics_table', 'Ключевые метрики по годам (таблица)', 'Ключевые метрики'),
  ],
  9: [
    money('s9n_revenue_2024', 'Выручка 2024', null),
    text('s9n_change_vs_2023', 'Изменение выручки к 2023', null),
    money('s9n_net_profit', 'Чистая прибыль / убыток', null, '₸', { allowNegative: true }),
    pct('s9n_net_margin', 'Чистая маржа', null, { allowNegative: true, plain: 'Сколько остаётся чистыми с каждых 100 ₸ выручки?' }),
    long('s9n_revenue_sources', 'Основные источники дохода', 'Основные источники дохода'),
    long('s9n_seasonality', 'Сезонность: пики и провалы', 'Сезонность: пики и провалы'),
    text('s9n_breakeven_point', 'Точка безубыточности', 'Точка безубыточности', { allowUnknown: true, plain: 'Знаете точку безубыточности — при какой выручке бизнес выходит в ноль?' }),
    long('s9n_dividend_policy', 'Дивидендная политика', 'Дивидендная политика'),
    money('s9n_expense_cogs', 'Расходы: себестоимость', 'Себестоимость продукции/услуг', '₸/год'),
    money('s9n_expense_marketing', 'Расходы: маркетинг и реклама', 'Маркетинг и реклама', '₸/год'),
    money('s9n_expense_rent', 'Расходы: аренда, коммунальные', 'Аренда, коммунальные', '₸/год'),
    money('s9n_expense_other', 'Расходы: прочие', 'Прочие расходы', '₸/год'),
    text('s9n_accounting_method', 'Способ ведения финансового учёта', 'Способ ведения финансового учёта'),
    select('s9n_planning_frequency', 'Частота финансового планирования', 'Частота финансового планирования', PLANNING_FREQ),
    select('s9n_analysis_frequency', 'Частота анализа результатов', 'Частота анализа результатов', ANALYSIS_FREQ),
    text('s9n_responsible_person', 'Ответственный за финансы', 'Ответственный за финансы'),
    long('s9n_tracked_kpis', 'Какие ключевые показатели ведутся', 'Какие ключевые показатели ведутся'),
    num('s9n_debtor_days', 'Средний срок оплаты (дебиторка)', 'Средний срок оплаты (дебиторка)', 'дней', { integer: true }),
    money('s9n_debts_amount', 'Текущие кредиты / долги', 'Текущие кредиты/долги', '₸', { plain: 'Есть кредиты и долги — сколько всего?' }),
    text('s9n_tax_system', 'Система налогообложения', 'Система налогообложения'),
    pct('s9n_transparency_pct', 'Прозрачность (% белой выручки)', 'Прозрачность (% белой выручки)'),
    text('s9n_tax_audits', 'Налоговые проверки за 2 года', 'Были ли налоговые проверки за 2 года'),
    text('s9n_audit_preparedness', 'Подготовленность к проверкам', 'Подготовленность к проверкам'),
    long('s9n_financial_blockers', 'Что мешает улучшить финансы', 'Что мешает улучшить финансы'),
  ],
  10: [
    long('s10_why_opened', 'Почему открыли бизнес', 'Почему открыли бизнес'),
    long('s10_best_result_2y', 'Лучший результат за 2 года', 'Лучший результат за 2 года'),
    long('s10_best_result_5y', 'Лучший результат за 5 лет', 'Лучший результат за 5 лет'),
    long('s10_best_result_10y', 'Лучший результат за 10 лет', 'Лучший результат за 10 лет'),
    long('s10_company_vision_2y', 'Видение компании на 2 года', 'Видение на 2 года'),
    long('s10_company_vision_5y', 'Видение компании на 5 лет', 'Видение на 5 лет'),
    long('s10_company_vision_10y', 'Видение компании на 10 лет', 'Видение на 10 лет'),
    long('s10_problems_faced', 'С какими проблемами столкнулись', 'С какими проблемами столкнулись'),
    long('s10_who_to_blame', 'Из-за чего возникли проблемы', 'Из-за чего, по-вашему, возникли эти проблемы?'),
    long('s10_dept_assessment', 'Оценка отделов', 'Оценка отделов'),
    long('s10_what_depts_lack', 'Чего не хватает отделам', 'Чего не хватает отделам'),
    long('s10_competitor_comparison', 'Сравнение с конкурентами', 'Сравнение с конкурентами'),
    long('s10_brand_perception', 'Как воспринимают бренд', 'Как воспринимают бренд'),
    long('s10_when_they_buy', 'Когда у вас покупают', 'Когда у вас покупают'),
    num('s10_hours_on_ops', 'Часов в день на операционку (о себе)', 'Часов в день на операционку', 'ч/день', { twin: 's4m_hours_on_ops' }),
    { key: 's10_delegation_ready', label: 'Готовность делегировать (1–10)', formLabel: 'Готовность делегировать (1-10)', type: 'scale', range: [1, 10], twin: 's4m_delegation_readiness' },
    long('s10_what_stops_delegating', 'Что мешает делегировать', 'Что мешает делегировать'),
  ],
  11: [
    table('s11_influence_map', 'Карта влияния', 'Карта влияния'),
  ],
  12: [
    select('s12_crm_tool', 'CRM-система', 'CRM-система', CRM_TOOLS, { plain: 'Где вы ведёте клиентов — какая CRM?' }),
    select('s12_edm', 'Электронный документооборот (EDM)', 'Электронный документооборот', EDM_OPTIONS, { term: 'EDM' }),
    select('s12_erp', 'Учётная система предприятия (ERP)', 'Учётная система предприятия', ERP_OPTIONS, { term: 'ERP' }),
    select('s12_bi_tool', 'Аналитика и отчёты (BI)', 'Аналитика и отчёты', BI_OPTIONS, { term: 'BI' }),
    select('s12_messengers', 'Мессенджеры', 'Мессенджеры', MESSENGER_OPTIONS),
    select('s12_telephony', 'Телефония', 'Телефония', TELEPHONY_OPTIONS),
    select('s12_project_mgmt', 'Управление проектами', 'Управление проектами', PROJECT_MGMT_OPTIONS, { plain: 'Где ставите задачи команде?' }),
    select('s12_marketing_platforms', 'Маркетинговые платформы', 'Маркетинговые платформы', MARKETING_PLATFORM_OPTIONS),
    long('s12_automation_details', 'Детали автоматизации', 'Детали автоматизации'),
    bool('s12_it_support', 'IT-поддержка', 'IT-поддержка (внутренняя или внешняя)'),
  ],
}

// ─── Mode 2: express screens and deepening blocks (spec §7.1, §7.4, appendix A) ──

export interface ExpressScreen {
  screen: number
  /** The screen's question in plain words. */
  title: string
  keys: readonly string[]
}

/** 15 screens, 26 questions + 3 auto keys (written with their month key). */
export const EXPRESS_SCREENS: readonly ExpressScreen[] = [
  { screen: 1, title: 'Как называется компания и чем занимаетесь?', keys: ['s1_company_name', 's1_industry'] },
  { screen: 2, title: 'Кому вы продаёте?', keys: ['s1_business_model'] },
  { screen: 3, title: 'Сколько человек в команде, включая вас?', keys: ['s1_employee_count'] },
  { screen: 4, title: 'Сколько денег приходит от клиентов в месяц сейчас?', keys: ['s1_current_revenue_month', 's1_current_revenue_year'] },
  { screen: 5, title: 'Сколько хотите через год? А через 3 года?', keys: ['s1_goal_12m_revenue_month', 's1_goal_12m_revenue_year', 's1_goal_3y_revenue_month', 's1_goal_3y_revenue_year'] },
  { screen: 6, title: 'Ради чего эта цель? Одной фразой', keys: ['s2n_goal_12m_what'] },
  { screen: 7, title: 'Что сейчас болит сильнее всего?', keys: ['s6_main_pain'] },
  { screen: 8, title: 'Что мешает расти?', keys: ['s6_growth_blockers'] },
  { screen: 9, title: 'Кто ваш клиент?', keys: ['s5_target_audience'] },
  { screen: 10, title: 'Почему выбирают вас, а не других? Разбирали конкурентов?', keys: ['s5_usp', 's5_has_competitor_analysis'] },
  { screen: 11, title: 'Откуда приходят клиенты и какую долю выручки тратите на рекламу?', keys: ['s5_marketing_channels', 's5_marketing_budget_pct'] },
  { screen: 12, title: 'Как вы продаёте: где ведёте клиентов и сколько дней проходит от заявки до оплаты?', keys: ['s12_crm_tool', 's3_deal_cycle_days'] },
  { screen: 13, title: 'Как устроено управление?', keys: ['s4_has_org_chart', 's4_has_regular_meetings', 's4m_control_method', 's4m_report_automated', 's12_project_mgmt'] },
  { screen: 14, title: 'Сколько часов в день вы сами занимаетесь текучкой?', keys: ['s4m_hours_on_ops'] },
  { screen: 15, title: 'Деньги: сколько остаётся чистыми, где точка безубыточности, есть ли долги?', keys: ['s9n_net_margin', 's9n_breakeven_point', 's9n_debts_amount'] },
]

export interface SurveyBlock {
  id: SurveyBlockId
  title: string
  /** Typing time without searching for data, minutes (survey inventory). */
  minutes: number
  /** «Зачем» — the block header. */
  why: string
  /** What it improves in Point A and further. */
  gives: string
  keys: readonly string[]
}

export const SURVEY_BLOCKS: readonly SurveyBlock[] = [
  { id: 'b1', title: 'О компании подробнее', minutes: 2, why: 'Контакты, регионы, сайт, история', gives: 'Анализ рынка по регионам, контакты для эксперта',
    keys: ['s1_years_on_market', 's1_website', 's1_social_media', 's1_regions', 's1_uploaded_files', 's1_contact_name', 's1_contact_position', 's1_contact_phone', 's1_contact_email'] },
  { id: 'b2', title: 'Цели и видение', minutes: 9, why: 'Цель своими словами, что пробовали, видение на 2, 5 и 10 лет', gives: 'Стратегия в разборе ИИ, план Точки Б, психопрофиль',
    keys: ['s2n_goal_12m_metrics', 's2n_goal_3y_what', 's2n_goal_3y_metrics', 's2n_tried_for_growth', 's2n_what_blocks_growth', 's6_expectations', 's10_company_vision_2y', 's10_company_vision_5y', 's10_company_vision_10y'] },
  { id: 'b3', title: 'Клиент и ценность', minutes: 8, why: 'Портрет, проблема клиента, за что платят', gives: 'Блок «Продукт» и разбор позиционирования',
    keys: ['s3n_client_portrait', 's3n_price_segment', 's3n_decision_maker', 's3n_purchase_participants', 's3n_client_problem', 's3n_problem_impact', 's3n_current_solution', 's3n_if_unsolved', 's3n_life_after_solution', 's3n_measurable_results', 's3n_short_wins', 's3n_competitor_why_us', 's3n_cannot_copy', 's3n_industry_standard'] },
  { id: 'b4', title: 'Продукты', minutes: 2, why: 'Что продаёте, что тянет продажи, что маржинально', gives: 'Блок «Продукт» — до порога оценки',
    keys: ['s1_products_list', 's3_product_count', 's3_flagship_product', 's5n_product_locomotive', 's5n_most_marginal', 's5n_entry_product', 's5n_upsell_crosssell'] },
  { id: 'b5', title: 'Продажи и воронка', minutes: 5, why: 'Сделки и отказы по годам, конверсии, заявки, неявки', gives: 'Блок «Продажи» (воронка, отказы), карта потерь',
    keys: ['s3_has_crm', 's3_deals_2023', 's3_deals_2024', 's3_deals_2025', 's3_rejections_2023', 's3_rejections_2024', 's3_rejections_2025', 's5n_funnel_lead_to_call', 's5n_funnel_call_to_meeting', 's5n_funnel_meeting_to_proposal', 's5n_funnel_proposal_to_negotiation', 's5n_funnel_negotiation_to_contract', 's5n_funnel_contract_to_payment', 's5n_funnel_payment_to_delivery', 's5n_funnel_lead_to_sale', 's7_leads_per_month', 's7_no_show_rate', 's7_missed_calls_rate', 's7_avg_check_target_kzt'] },
  { id: 'b6', title: 'Почему покупают и возвращаются', minutes: 6, why: 'Решающий фактор, барьеры, NPS, повторные покупки', gives: 'Блок «Продукт» (NPS), карта потерь, разбор ИИ',
    keys: ['s5n_why_bought', 's5n_deciding_factor', 's5n_barriers', 's5n_will_return_nps', 's5n_improve_suggestions', 's5n_abc_analysis', 's5n_rfm_analysis', 's7_nps_score', 's7_repeat_freq_days', 's10_when_they_buy', 's10_brand_perception'] },
  { id: 'b7', title: 'Путь клиента', minutes: 7, why: 'Этапы пути, где теряем, скрипты', gives: 'Рекомендации по воронке в разборе',
    keys: ['s6n_journey_table', 's6n_weak_funnel_points', 's6n_post_sale_touchpoints', 's6n_script_first_contact', 's6n_script_meeting', 's6n_script_proposal'] },
  { id: 'b8', title: 'Маркетинг', minutes: 2, why: 'Каналы подробно, контент, платформы', gives: 'Метрики каналов, маркетинг в разборе',
    keys: ['s3_promo_channels', 's5n_how_found_us', 's7n_channels_table', 's7n_content_strategy', 's12_marketing_platforms'] },
  { id: 'b9', title: 'Конкуренты', minutes: 9, why: 'Кто конкуренты, в чём они лучше, разбор трёх', gives: 'Блок «Маркетинг» (разбор конкурентов), анализ рынка',
    keys: ['s1_competitors_list', 's3n_competitors_better', 's5n_compared_with', 's5_competitor_1', 's5_competitor_2', 's5_competitor_3', 's7n_competitor_1_analysis', 's7n_competitor_2_analysis', 's7n_competitor_3_analysis', 's10_competitor_comparison'] },
  { id: 'b10', title: 'Цифры по годам', minutes: 8, why: 'Выручка, продажи, чек, CAC и LTV по годам', gives: 'Блоки «Финансы» и «Продажи», реалистичность цели',
    keys: ['s8n_metrics_table'] },
  { id: 'b11', title: 'Финансы', minutes: 7, why: 'Прибыль, расходы, учёт, налоги, дебиторка', gives: 'Блок «Финансы» до полной оценки, финмодель Точки Б, Reality Check',
    keys: ['s9n_revenue_2024', 's9n_change_vs_2023', 's9n_net_profit', 's9n_revenue_sources', 's9n_seasonality', 's9n_dividend_policy', 's9n_expense_cogs', 's9n_expense_marketing', 's9n_expense_rent', 's9n_expense_other', 's9n_accounting_method', 's9n_planning_frequency', 's9n_analysis_frequency', 's9n_responsible_person', 's9n_tracked_kpis', 's9n_debtor_days', 's9n_tax_system', 's9n_transparency_pct', 's9n_tax_audits', 's9n_audit_preparedness', 's9n_financial_blockers'] },
  { id: 'b12', title: 'Команда и управление', minutes: 6, why: 'Отделы, штат, планирование, отчёты, делегирование', gives: 'Блок «Команда» — до порога оценки',
    keys: ['s4_dept_count', 's4n_staffing_table', 's4n_structure_matches', 's4n_open_vacancies', 's4n_multi_roles', 's4m_strategic_planning', 's4m_planning_team_or_solo', 's4m_communication', 's4m_dept_sync', 's4m_meeting_structure', 's4m_meeting_efficiency', 's4m_report_types', 's4m_report_frequency', 's4m_delegation_readiness', 's10_dept_assessment', 's10_what_depts_lack'] },
  { id: 'b13', title: 'Вы как собственник', minutes: 5, why: 'Почему открыли бизнес, лучшие результаты, делегирование', gives: 'Психопрофиль, рекомендации по делегированию',
    keys: ['s10_why_opened', 's10_best_result_2y', 's10_best_result_5y', 's10_best_result_10y', 's10_problems_faced', 's10_who_to_blame', 's10_hours_on_ops', 's10_delegation_ready', 's10_what_stops_delegating'] },
  { id: 'b14', title: 'Карта влияния', minutes: 4, why: 'Кто может ускорить рост или помешать', gives: 'Материал для эксперта',
    keys: ['s11_influence_map'] },
  { id: 'b15', title: 'Системы и инструменты', minutes: 2, why: 'Учёт, документооборот, телефония', gives: 'Блок «Операции», что автоматизировать',
    keys: ['s12_edm', 's12_erp', 's12_bi_tool', 's12_messengers', 's12_telephony', 's12_automation_details', 's12_it_support'] },
]

// ─── Build ───────────────────────────────────────────────────────────────────

const AUTO_SET = new Set<string>(AUTO_KEYS)

/**
 * The one-line «где взять цифру» of a key. lib/survey/where-to-find.ts is
 * written separately: an entry is either a plain line or an object whose
 * `short` is the line (its `how` / `sources` / `ifUnknown` are read there).
 */
export function whereToFindLine(key: string): string | null {
  const entry: unknown = (WHERE_TO_FIND as Record<string, unknown>)[key]
  const line = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? (entry as { short?: unknown }).short : null
  return typeof line === 'string' && line.trim() ? line.trim() : null
}

function minimumIndex(): Map<string, MinimumRef[]> {
  const out = new Map<string, MinimumRef[]>()
  for (const [block, checks] of Object.entries(CHECK_INPUTS)) {
    for (const [check, input] of Object.entries(checks ?? {})) {
      for (const key of input.keys) {
        if (!(key in SURVEY_KEY_STEP)) continue
        const list = out.get(key) ?? []
        list.push({ block, check })
        out.set(key, list)
      }
    }
  }
  return out
}

function placeIndex(): Map<string, { place: SurveyPlace; screen?: number }> {
  const out = new Map<string, { place: SurveyPlace; screen?: number }>()
  for (const s of EXPRESS_SCREENS) for (const k of s.keys) out.set(k, { place: 'express', screen: s.screen })
  for (const b of SURVEY_BLOCKS) for (const k of b.keys) if (!out.has(k)) out.set(k, { place: b.id })
  return out
}

function build(): SurveyQuestion[] {
  const minimum = minimumIndex()
  const places = placeIndex()
  const list: SurveyQuestion[] = []
  for (const [stepText, defs] of Object.entries(STEP_DEFS)) {
    const step = Number(stepText)
    defs.forEach((d, i) => {
      const where = places.get(d.key)
      const numeric = d.type === 'number' || d.type === 'money' || d.type === 'percent'
      const q: SurveyQuestion = {
        ...d,
        step,
        order: i + 1,
        allowUnknown: d.allowUnknown ?? numeric,
        allowApprox: d.allowApprox ?? false,
        place: where?.place ?? 'express',
        ...(where?.screen ? { express: { screen: where.screen } } : {}),
        delicate: d.key in FIELD_NOTES,
        chat: d.chat ?? (AUTO_SET.has(d.key) ? 'skip' : 'ask'),
        auto: AUTO_SET.has(d.key),
        minimum: minimum.get(d.key) ?? [],
      }
      const why = FIELD_NOTES[d.key]
      if (why) q.why = why
      const whereToFind = whereToFindLine(d.key)
      if (whereToFind) q.whereToFind = whereToFind
      list.push(q)
    })
  }
  return list
}

/** All questions in the order of the full questionnaire (step, then form order). */
export const SURVEY_QUESTION_LIST: readonly SurveyQuestion[] = build()

/** question_key → question. */
export const SURVEY_QUESTIONS: Readonly<Record<string, SurveyQuestion>> = Object.freeze(
  Object.fromEntries(SURVEY_QUESTION_LIST.map((q) => [q.key, q])),
)

export function surveyQuestion(key: string): SurveyQuestion | null {
  return SURVEY_QUESTIONS[key] ?? null
}

export function questionsOfStep(step: number): SurveyQuestion[] {
  return SURVEY_QUESTION_LIST.filter((q) => q.step === step)
}

export function questionsOfPlace(place: SurveyPlace): SurveyQuestion[] {
  if (place === 'express') {
    return EXPRESS_SCREENS.flatMap((s) => s.keys.map((k) => SURVEY_QUESTIONS[k]).filter((q): q is SurveyQuestion => !!q))
  }
  const block = SURVEY_BLOCKS.find((b) => b.id === place)
  return (block?.keys ?? []).map((k) => SURVEY_QUESTIONS[k]).filter((q): q is SurveyQuestion => !!q)
}

export function surveyBlock(id: string): SurveyBlock | null {
  return SURVEY_BLOCKS.find((b) => b.id === id) ?? null
}

/** Numeric answer types (NumberField in the forms). */
export function isNumericQuestion(q: Pick<SurveyQuestion, 'type'>): boolean {
  return q.type === 'number' || q.type === 'money' || q.type === 'percent' || q.type === 'auto'
}

/** The label of a stored option value, or the value itself. */
export function optionLabel(q: Pick<SurveyQuestion, 'options'>, value: string): string {
  return q.options?.find((o) => o.value === value)?.label ?? value
}

/** Is the key part of «Минимум для Точки А»? */
export function isMinimumKey(key: string): boolean {
  return (SURVEY_QUESTIONS[key]?.minimum.length ?? 0) > 0
}
