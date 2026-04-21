// ─────────────────────────────────────────────────────────────────────────────
// Central registry of every element an expert can attach a comment to.
// Targets ARE the exact UI elements on the client-facing pages
// (/client/dashboard, /point-a, /gri, /pulse). When the expert views a
// client in /expert/clients/[id], each tab mirrors the client page layout
// so the items the expert sees match what the client sees.
// ─────────────────────────────────────────────────────────────────────────────
// Storage: `expert_comments.block_key TEXT` (no CHECK constraint). Any string
// up to 200 chars is valid; unknown ids render under "Общее" gracefully.

import { CATEGORIES, SUB_FACTORS } from '@/lib/gri-calculator/gri-data'

export type TargetGroup =
  | 'general'
  | 'point-a'
  | 'dashboard'
  | 'gri'
  | 'pulse'
  | 'survey'
  | 'clinic'

export interface CommentTarget {
  id: string
  label: string
  group: TargetGroup
  section?: string
}

// ── POINT A — 5 blocks (backwards-compat ids) + supporting items ─────────────
const POINT_A_TARGETS: CommentTarget[] = [
  // Legacy 5-block ids (kept for existing comments)
  { id: 'finance',    label: 'Финансы',   group: 'point-a', section: 'Блоки' },
  { id: 'sales',      label: 'Продажи',   group: 'point-a', section: 'Блоки' },
  { id: 'operations', label: 'Операции',  group: 'point-a', section: 'Блоки' },
  { id: 'marketing',  label: 'Маркетинг', group: 'point-a', section: 'Блоки' },
  { id: 'strategy',   label: 'Стратегия', group: 'point-a', section: 'Блоки' },
  // Hero / AI sections
  { id: 'pointa:hero:gauge',              label: 'Индекс здоровья бизнеса (шкала)', group: 'point-a', section: 'Hero' },
  { id: 'pointa:ai:executiveSummary',     label: 'AI-анализ бизнеса',               group: 'point-a', section: 'AI' },
  { id: 'pointa:priorities:section',      label: 'Стратегические приоритеты',       group: 'point-a', section: 'Анализ' },
  { id: 'pointa:risks:section',           label: 'Риски',                           group: 'point-a', section: 'Анализ' },
  { id: 'pointa:insights:section',        label: 'Инсайты',                         group: 'point-a', section: 'Анализ' },
  { id: 'pointa:quickWins:section',       label: 'Быстрые победы',                  group: 'point-a', section: 'Анализ' },
  { id: 'pointa:roadmap:30d',             label: 'Дорожная карта: 30 дней',         group: 'point-a', section: 'Roadmap' },
  { id: 'pointa:roadmap:90d',             label: 'Дорожная карта: 90 дней',         group: 'point-a', section: 'Roadmap' },
  { id: 'pointa:roadmap:180d',            label: 'Дорожная карта: 180 дней',        group: 'point-a', section: 'Roadmap' },
  { id: 'pointa:industryContext',         label: 'Отраслевой контекст',             group: 'point-a', section: 'Контекст' },
]

// ── CLIENT DASHBOARD items ───────────────────────────────────────────────────
const DASHBOARD_TARGETS: CommentTarget[] = [
  { id: 'dashboard:hero:radar',            label: 'Point A Radar',                group: 'dashboard', section: 'Hero' },
  { id: 'dashboard:kpi:overallScore',      label: 'KPI: Overall Score',           group: 'dashboard', section: 'KPI' },
  { id: 'dashboard:kpi:healthIndex',       label: 'KPI: Health Index',            group: 'dashboard', section: 'KPI' },
  { id: 'dashboard:kpi:documents',         label: 'KPI: Документы',               group: 'dashboard', section: 'KPI' },
  { id: 'dashboard:kpi:stage',             label: 'KPI: Стадия',                  group: 'dashboard', section: 'KPI' },
  { id: 'dashboard:ai:executiveSummary',   label: 'AI Executive Summary',         group: 'dashboard', section: 'AI' },
  { id: 'dashboard:priorities:section',    label: 'Стратегические приоритеты',    group: 'dashboard', section: 'AI' },
  { id: 'dashboard:risks:section',         label: 'Риски',                        group: 'dashboard', section: 'Анализ' },
  { id: 'dashboard:insights:section',      label: 'Инсайты',                      group: 'dashboard', section: 'Анализ' },
  { id: 'dashboard:quickWins:section',     label: 'Quick Wins',                   group: 'dashboard', section: 'Анализ' },
  { id: 'dashboard:roadmap:30d',           label: 'Roadmap: 30 дней',             group: 'dashboard', section: 'Roadmap' },
  { id: 'dashboard:roadmap:90d',           label: 'Roadmap: 90 дней',             group: 'dashboard', section: 'Roadmap' },
  { id: 'dashboard:roadmap:180d',          label: 'Roadmap: 180 дней',            group: 'dashboard', section: 'Roadmap' },
  { id: 'dashboard:industryContext',       label: 'Industry Context',             group: 'dashboard', section: 'Контекст' },
  { id: 'dashboard:documents:section',     label: 'Документы клиента',            group: 'dashboard', section: 'Документы' },
]

// ── GRI categories + sub-factors (from gri-data.ts) + calculator items ──────
function slugifyCategory(cat: string): string {
  return cat.toLowerCase().replace(/&/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}

const GRI_TARGETS: CommentTarget[] = [
  // High-level GRI page items
  { id: 'gri:alert:redZone',        label: 'Красная зона (алерт)',     group: 'gri', section: 'Алерты' },
  { id: 'gri:radar:card',           label: 'Индекс готовности к росту (радар)', group: 'gri', section: 'Радар' },
  { id: 'gri:kpi:currentGRI',       label: 'Текущий GRI (0–10)',       group: 'gri', section: 'KPI' },
  { id: 'gri:kpi:plannedGRI',       label: 'Плановый GRI',             group: 'gri', section: 'KPI' },
  { id: 'gri:kpi:targetGRI',        label: 'Целевой GRI',              group: 'gri', section: 'KPI' },
  { id: 'gri:financialAnalyst:card', label: 'Financial Analyst (загрузка)', group: 'gri', section: 'Financial Analyst' },
  { id: 'gri:financialResults:card', label: 'Результаты фин-анализа', group: 'gri', section: 'Financial Analyst' },
  { id: 'gri:strategy:resultCard',  label: 'Сгенерированная стратегия', group: 'gri', section: 'Стратегия' },
  // 7 categories (commentable slider cards)
  ...CATEGORIES.map<CommentTarget>((cat) => ({
    id: `gri:category:${slugifyCategory(cat)}`,
    label: cat,
    group: 'gri',
    section: 'Категории',
  })),
  // 35 sub-factors
  ...CATEGORIES.flatMap<CommentTarget>((cat) =>
    (SUB_FACTORS[cat] ?? []).map((sf) => ({
      id: `gri:sub:${sf.id}`,
      label: sf.ru,
      group: 'gri',
      section: cat,
    })),
  ),
]

// ── GRI Pulse — mirrors /pulse page structure ───────────────────────────────
const PULSE_TARGETS: CommentTarget[] = [
  // Header + briefing
  { id: 'pulse:header:title',         label: 'Заголовок «Кому звонить сегодня»', group: 'pulse', section: 'Header' },
  { id: 'pulse:header:dataSource',    label: 'Источник данных CRM',              group: 'pulse', section: 'Header' },
  { id: 'pulse:briefing:card',        label: 'Рекомендация на сегодня',          group: 'pulse', section: 'Header' },
  // 5 stat cards (the user's screenshot)
  { id: 'pulse:header:revenueAtRisk', label: 'Выручка под угрозой',              group: 'pulse', section: 'Статистика' },
  { id: 'pulse:header:highRisk',      label: 'Высокий риск',                     group: 'pulse', section: 'Статистика' },
  { id: 'pulse:header:mediumRisk',    label: 'Средний риск',                     group: 'pulse', section: 'Статистика' },
  { id: 'pulse:header:totalClients',  label: 'Всего клиентов',                   group: 'pulse', section: 'Статистика' },
  { id: 'pulse:header:processedToday', label: 'Обработано сегодня',              group: 'pulse', section: 'Статистика' },
  // 4 tabs
  { id: 'pulse:tab:today',            label: 'Вкладка: Кому продавать сегодня', group: 'pulse', section: 'Вкладки' },
  { id: 'pulse:tab:risk',             label: 'Вкладка: Топ в зоне риска',       group: 'pulse', section: 'Вкладки' },
  { id: 'pulse:tab:card',             label: 'Вкладка: Карточка клиента',       group: 'pulse', section: 'Вкладки' },
  { id: 'pulse:tab:crm',              label: 'Вкладка: CRM-интеграции',         group: 'pulse', section: 'Вкладки' },
  // Risk filter chips
  { id: 'pulse:filter:all',           label: 'Фильтр риска: Все',                group: 'pulse', section: 'Фильтры' },
  { id: 'pulse:filter:high',          label: 'Фильтр риска: Высокий',            group: 'pulse', section: 'Фильтры' },
  { id: 'pulse:filter:medium',        label: 'Фильтр риска: Средний',            group: 'pulse', section: 'Фильтры' },
  { id: 'pulse:filter:low',           label: 'Фильтр риска: Низкий',             group: 'pulse', section: 'Фильтры' },
  // Today tab banner + table columns
  { id: 'pulse:today:alertBanner',    label: 'Баннер «просрочили цикл»',         group: 'pulse', section: 'Сегодня' },
  { id: 'pulse:table:col:client',     label: 'Таблица: Клиент',                  group: 'pulse', section: 'Таблица' },
  { id: 'pulse:table:col:lastOrder',  label: 'Таблица: Последний заказ',         group: 'pulse', section: 'Таблица' },
  { id: 'pulse:table:col:avgCheck',   label: 'Таблица: Ср. чек',                 group: 'pulse', section: 'Таблица' },
  { id: 'pulse:table:col:volumeChange', label: 'Таблица: Изм. объёма',           group: 'pulse', section: 'Таблица' },
  { id: 'pulse:table:col:riskScore',  label: 'Таблица: Риск-скор',               group: 'pulse', section: 'Таблица' },
  { id: 'pulse:table:col:churnProb',  label: 'Таблица: Вер-сть оттока',          group: 'pulse', section: 'Таблица' },
  { id: 'pulse:table:col:comment',   label: 'Таблица: Комментарий',             group: 'pulse', section: 'Таблица' },
  { id: 'pulse:table:col:action',    label: 'Таблица: Действие',                group: 'pulse', section: 'Таблица' },
  // 3 priority cards
  { id: 'pulse:priority:call',       label: 'Приоритет 1 — Звонок',             group: 'pulse', section: 'Приоритеты' },
  { id: 'pulse:priority:message',    label: 'Приоритет 2 — Написать',           group: 'pulse', section: 'Приоритеты' },
  { id: 'pulse:priority:monitor',    label: 'Приоритет 3 — Мониторинг',         group: 'pulse', section: 'Приоритеты' },
  // Card tab (per-client deep dive metrics)
  { id: 'pulse:card:metric:avgCheck',     label: 'Карточка: Средний чек',        group: 'pulse', section: 'Карточка клиента' },
  { id: 'pulse:card:metric:volumeChange', label: 'Карточка: Изм. объёма',        group: 'pulse', section: 'Карточка клиента' },
  { id: 'pulse:card:metric:riskScore',    label: 'Карточка: Риск-скор',          group: 'pulse', section: 'Карточка клиента' },
  { id: 'pulse:card:metric:daysSince',    label: 'Карточка: Дней без заказа',    group: 'pulse', section: 'Карточка клиента' },
  { id: 'pulse:card:historyChart',        label: 'Карточка: История заказов',    group: 'pulse', section: 'Карточка клиента' },
  { id: 'pulse:card:comment',             label: 'Карточка: Комментарий',        group: 'pulse', section: 'Карточка клиента' },
  // CRM tab
  { id: 'pulse:crm:header',          label: 'CRM-интеграции (заголовок)',       group: 'pulse', section: 'CRM' },
  { id: 'pulse:crm:bitrix24',        label: 'Bitrix24 интеграция',              group: 'pulse', section: 'CRM' },
  { id: 'pulse:crm:amocrm',          label: 'AmoCRM интеграция',                group: 'pulse', section: 'CRM' },
]

// ── Clinic vertical (medical) ───────────────────────────────────────────────
// Segment / Bundle / Loss ids mirror the DB columns so an expert comment on
// e.g. 'clinic:bundle:no_show' shows up next to that bundle on the client
// dashboard.
const CLINIC_TARGETS: CommentTarget[] = [
  // 8 RFM segments
  { id: 'clinic:segment:vip_retention',    label: 'VIP удержание',      group: 'clinic', section: 'Сегменты' },
  { id: 'clinic:segment:vip_reactivation', label: 'VIP реактивация',    group: 'clinic', section: 'Сегменты' },
  { id: 'clinic:segment:loyal_active',     label: 'Лояльные активные',  group: 'clinic', section: 'Сегменты' },
  { id: 'clinic:segment:churn_risk',       label: 'Риск оттока',        group: 'clinic', section: 'Сегменты' },
  { id: 'clinic:segment:sleeping',         label: 'Спящие',             group: 'clinic', section: 'Сегменты' },
  { id: 'clinic:segment:one_time_fresh',   label: 'Разовые свежие',     group: 'clinic', section: 'Сегменты' },
  { id: 'clinic:segment:one_time_old',     label: 'Разовые старые',     group: 'clinic', section: 'Сегменты' },
  { id: 'clinic:segment:dead_lead',        label: 'Мёртвые лиды',       group: 'clinic', section: 'Сегменты' },
  // 9 growth bundles
  { id: 'clinic:bundle:no_show',                label: 'Связка: No-show защита',           group: 'clinic', section: 'Связки' },
  { id: 'clinic:bundle:cross_sell_after_ekg',   label: 'Связка: Cross-sell после ЭКГ',     group: 'clinic', section: 'Связки' },
  { id: 'clinic:bundle:follow_up_diagnostics',  label: 'Связка: Follow-up диагностики',    group: 'clinic', section: 'Связки' },
  { id: 'clinic:bundle:reactivation',           label: 'Связка: Реактивация базы',         group: 'clinic', section: 'Связки' },
  { id: 'clinic:bundle:nps_referral',           label: 'Связка: NPS + реферал',            group: 'clinic', section: 'Связки' },
  { id: 'clinic:bundle:instant_callback',       label: 'Связка: Callback 60 сек',          group: 'clinic', section: 'Связки' },
  { id: 'clinic:bundle:upsell_at_booking',      label: 'Связка: Upsell при подтверждении', group: 'clinic', section: 'Связки' },
  { id: 'clinic:bundle:seasonal_campaigns',     label: 'Связка: Сезонные кампании',        group: 'clinic', section: 'Связки' },
  { id: 'clinic:bundle:chronic_control',        label: 'Связка: Контроль хроников',        group: 'clinic', section: 'Связки' },
  // 9 revenue loss categories
  { id: 'clinic:loss:no_shows',                label: 'Потери: No-show',                 group: 'clinic', section: 'Потери' },
  { id: 'clinic:loss:missed_calls',            label: 'Потери: Пропущенные звонки',      group: 'clinic', section: 'Потери' },
  { id: 'clinic:loss:missing_follow_up',       label: 'Потери: Нет follow-up',           group: 'clinic', section: 'Потери' },
  { id: 'clinic:loss:missing_upsell',          label: 'Потери: Нет upsell',              group: 'clinic', section: 'Потери' },
  { id: 'clinic:loss:missing_reactivation',    label: 'Потери: Нет реактивации',         group: 'clinic', section: 'Потери' },
  { id: 'clinic:loss:missing_chronic_control', label: 'Потери: Провал с хрониками',      group: 'clinic', section: 'Потери' },
  { id: 'clinic:loss:weak_nps',                label: 'Потери: Слабый NPS',              group: 'clinic', section: 'Потери' },
  { id: 'clinic:loss:missing_seasonal',        label: 'Потери: Нет сезонных кампаний',   group: 'clinic', section: 'Потери' },
  { id: 'clinic:loss:post_diagnostic_drop',    label: 'Потери: Пост-диагностический провал', group: 'clinic', section: 'Потери' },
  // Clinic intake items
  { id: 'clinic:intake:patient_base',          label: 'Загрузка: База пациентов',        group: 'clinic', section: 'Anketa' },
  { id: 'clinic:intake:pricelist',             label: 'Загрузка: Прейскурант',           group: 'clinic', section: 'Anketa' },
  { id: 'clinic:intake:services',              label: 'Загрузка: Услуги',                group: 'clinic', section: 'Anketa' },
]

// ── Canonical flat registry ──────────────────────────────────────────────────
export const TARGETS: CommentTarget[] = [
  ...POINT_A_TARGETS,
  ...DASHBOARD_TARGETS,
  ...GRI_TARGETS,
  ...PULSE_TARGETS,
  ...CLINIC_TARGETS,
]

const TARGETS_BY_ID = new Map(TARGETS.map((t) => [t.id, t]))

export function getTarget(id: string | null | undefined): CommentTarget | null {
  if (!id) return null
  return TARGETS_BY_ID.get(id) ?? null
}

export function targetLabel(id: string | null | undefined): string {
  if (!id) return 'Общее'
  return getTarget(id)?.label ?? id
}

export function targetsByGroup(group: TargetGroup): CommentTarget[] {
  return TARGETS.filter((t) => t.group === group)
}

export function targetsBySection(group: TargetGroup): Record<string, CommentTarget[]> {
  const buckets: Record<string, CommentTarget[]> = {}
  for (const t of targetsByGroup(group)) {
    const key = t.section ?? ''
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(t)
  }
  return buckets
}

export function isValidTargetId(id: unknown): id is string {
  if (typeof id !== 'string') return false
  if (id.length < 1 || id.length > 200) return false
  return true
}

export const MAX_TARGET_ID_LENGTH = 200

// ── Display metadata per group ───────────────────────────────────────────────

export const GROUP_LABEL: Record<TargetGroup, string> = {
  general:   'Общее',
  'point-a': 'Точка А',
  dashboard: 'Дэшборд',
  gri:       'GRI',
  pulse:     'GRI Pulse',
  survey:    'Анкета',
  clinic:    'Клиника',
}

export const GROUP_ICON: Record<TargetGroup, string> = {
  general:   'chat',
  'point-a': 'radar',
  dashboard: 'dashboard',
  gri:       'target',
  pulse:     'monitor_heart',
  survey:    'assignment',
  clinic:    'medical_services',
}

export const GROUP_CHIP: Record<TargetGroup, string> = {
  general:   'bg-white/[0.05] text-on-surface-variant border-white/[0.08]',
  'point-a': 'bg-primary/10 text-primary border-primary/20',
  dashboard: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  gri:       'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  pulse:     'bg-amber-500/10 text-amber-300 border-amber-500/20',
  survey:    'bg-violet-500/10 text-violet-300 border-violet-500/20',
  clinic:    'bg-teal-500/10 text-teal-300 border-teal-500/20',
}

export const GROUP_ORDER: TargetGroup[] = [
  'general',
  'point-a',
  'dashboard',
  'gri',
  'pulse',
  'survey',
  'clinic',
]

export function groupOf(id: string | null | undefined): TargetGroup {
  const t = getTarget(id)
  return t ? t.group : 'general'
}
