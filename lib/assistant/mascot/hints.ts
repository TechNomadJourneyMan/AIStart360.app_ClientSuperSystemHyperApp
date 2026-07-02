/**
 * lib/assistant/mascot/hints.ts — the scripted hint catalog (ТЗ §7–§8).
 *
 * Every proactive bubble the mascot «Гри» can show lives here — id, type,
 * priority, allowed screens, copy and actions. Deterministic by design: NO LLM
 * is ever called for a bubble (ТЗ §0.2); numbers arrive as params from
 * GET /api/v1/assistant/context and are interpolated, never invented.
 *
 * The server sends only {id, priority, params}; this catalog owns the copy, so
 * texts ship once. Client-local candidates (greeting, idle, …) are built with
 * localCandidate(). All copy is Russian (portal default); the panel itself is
 * already localized, bubble en-copy is deferred per ТЗ §20.3.
 */

import type { HintCandidate, MascotState } from './types'

export type HintType =
  | 'greeting'
  | 'error'
  | 'incomplete'
  | 'next_step'
  | 'insight'
  | 'education'
  | 'motivation'
  | 'idle'

export interface HintAction {
  label: string
  kind: 'navigate' | 'open_chat' | 'later'
  href?: string
}

export interface HintDef {
  id: string
  type: HintType
  /** Mascot pose while the bubble is up (subset of MascotState). */
  state: Extract<MascotState, 'greeting' | 'hint' | 'question' | 'insight'>
  /** 0 (greeting) / 1 … 5 per ТЗ §9; lower wins. */
  priority: number
  /** Screen prefixes where the hint may appear; [] = anywhere in the portal. */
  screens: string[]
  /** true → bubble offers «Не показывать такие советы» (mutes the TYPE). */
  mutable: boolean
  build: (p: HintParams) => { text: string; actions: HintAction[] }
}

export type HintParams = Record<string, string | number | null | undefined>

/** A catalog entry resolved against candidate params — ready to render. */
export interface ResolvedHint {
  id: string
  type: HintType
  state: HintDef['state']
  priority: number
  screens: string[]
  mutable: boolean
  text: string
  actions: HintAction[]
}

// ─── Screen groups (real route prefixes of the portal) ──────────────────────

const HOME = ['/dashboard', '/client/dashboard', '/client/welcome']
const SURVEY = ['/client/onboarding']
const RESULTS = ['/gri', '/point-a', '/point-b', '/client/point-a', '/client/point-b', '/pulse']

/** '/client/onboarding/documents?x' → '/client/onboarding' (first 2 segments). */
export function normalizeScreen(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0] ?? ''
  const segs = clean.split('/').filter(Boolean).slice(0, 2)
  return segs.length ? `/${segs.join('/')}` : '/'
}

export function screenAllowed(def: Pick<HintDef, 'screens'>, screen: string): boolean {
  if (def.screens.length === 0) return true
  return def.screens.some((s) => screen === s || screen.startsWith(`${s}/`))
}

// ─── Word-form helper (лёгкая русская плюрализация для счётчиков) ───────────

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

const num = (v: HintParams[string], fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const str = (v: HintParams[string]): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

// ─── The catalog ─────────────────────────────────────────────────────────────

const DEFS: HintDef[] = [
  {
    id: 'greeting',
    type: 'greeting',
    state: 'greeting',
    priority: 0,
    screens: [],
    mutable: false,
    build: () => ({
      text: 'Привет! Я Гри 🐾 Помогу пройти диагностику и подскажу, где у бизнеса точки роста.',
      actions: [
        { label: 'Начать диагностику', kind: 'navigate', href: '/client/onboarding' },
        { label: 'Позже', kind: 'later' },
      ],
    }),
  },
  {
    id: 'fix_errors',
    type: 'error',
    state: 'hint',
    priority: 1,
    screens: [...HOME, ...SURVEY],
    mutable: false,
    build: (p) => {
      const c = num(p.count, 1)
      return {
        text: `В анкете ${c} ${plural(c, 'противоречие', 'противоречия', 'противоречий')} — из-за них расчёт будет неточным.`,
        actions: [
          { label: 'Исправить', kind: 'navigate', href: '/client/onboarding' },
          { label: 'Позже', kind: 'later' },
        ],
      }
    },
  },
  {
    id: 'finish_section',
    type: 'incomplete',
    state: 'hint',
    priority: 1,
    screens: [...HOME, ...SURVEY],
    mutable: false,
    build: (p) => {
      const label = str(p.sectionLabel) ?? 'анкеты'
      const m = num(p.missing, 1)
      return {
        text: `В разделе «${label}» ${m === 1 ? 'осталось' : 'осталось'} ${m} ${plural(m, 'обязательное поле', 'обязательных поля', 'обязательных полей')}.`,
        actions: [
          { label: 'Дозаполнить', kind: 'navigate', href: '/client/onboarding' },
          { label: 'Позже', kind: 'later' },
        ],
      }
    },
  },
  {
    id: 'continue_diagnostic',
    type: 'next_step',
    state: 'question',
    priority: 2,
    screens: HOME,
    mutable: false,
    build: (p) => {
      const left = num(p.left, 0)
      const done = num(p.done, 0)
      return {
        text: `Продолжим диагностику? Осталось ${left} из ${left + done} разделов.`,
        actions: [
          { label: 'Продолжить', kind: 'navigate', href: '/client/onboarding' },
          { label: 'Позже', kind: 'later' },
        ],
      }
    },
  },
  {
    id: 'run_analysis',
    type: 'next_step',
    state: 'question',
    priority: 2,
    screens: [...HOME, ...SURVEY, '/client/point-a'],
    mutable: false,
    build: () => ({
      text: 'Анкета заполнена — можно получить Точку А и GRI. Запустить?',
      actions: [
        { label: 'Получить GRI', kind: 'navigate', href: '/gri' },
        { label: 'Позже', kind: 'later' },
      ],
    }),
  },
  {
    id: 'results_ready',
    type: 'insight',
    state: 'insight',
    priority: 3,
    screens: [...HOME, ...RESULTS],
    mutable: false,
    build: (p) => {
      const gri = p.gri != null ? String(p.gri) : null
      const limit = str(p.topLimit)
      const head = gri ? `Ваш GRI — ${gri}/10.` : 'Диагностика готова.'
      const mid = limit ? ` Главное ограничение — «${limit}».` : ''
      return {
        text: `${head}${mid} Рассказать, что это значит?`,
        actions: [
          { label: 'Разобрать результаты', kind: 'open_chat' },
          { label: 'Позже', kind: 'later' },
        ],
      }
    },
  },
  {
    id: 'complex_section',
    type: 'education',
    state: 'hint',
    priority: 4,
    screens: SURVEY,
    mutable: true,
    build: () => ({
      text: 'Этот раздел — про цифры. Если точных нет, начните с приблизительных: я подскажу формат.',
      actions: [
        { label: 'Как заполнить?', kind: 'open_chat' },
        { label: 'Понятно', kind: 'later' },
      ],
    }),
  },
  {
    id: 'idle_help',
    type: 'idle',
    state: 'hint',
    priority: 4,
    screens: [...SURVEY, ...RESULTS],
    mutable: true,
    build: () => ({
      text: 'Нужна подсказка? Могу объяснить, что делать дальше.',
      actions: [
        { label: 'Объяснить', kind: 'open_chat' },
        { label: 'Не сейчас', kind: 'later' },
      ],
    }),
  },
  {
    id: 'celebrate_progress',
    type: 'motivation',
    state: 'insight',
    priority: 5,
    screens: [],
    mutable: true,
    build: (p) => {
      const label = str(p.nextLabel)
      return {
        text: label
          ? `Раздел готов! Следующий — «${label}». Отличный темп 🐾`
          : 'Раздел готов! Отличный темп 🐾',
        actions: [
          { label: 'Дальше', kind: 'navigate', href: '/client/onboarding' },
          { label: 'Спасибо', kind: 'later' },
        ],
      }
    },
  },
  {
    // AI-инсайт (OpenRouter): текст приходит готовым в params.text — единственный
    // LLM-питаемый пузырь. Управляется тумблером behavior.aiInsights, не mute.
    id: 'ai_insight',
    type: 'insight',
    state: 'insight',
    priority: 3,
    screens: [],
    mutable: false,
    build: (p) => ({
      text: str(p.text) ?? 'Инсайт готов — откройте чат, разберём подробнее.',
      actions: [
        { label: 'Разобрать в чате', kind: 'open_chat' },
        { label: 'Спасибо', kind: 'later' },
      ],
    }),
  },
]

// ─── Контекст панели ассистента: что показывать на каком экране ──────────────

/** Экран → секции готовых вопросов (литералы из lib/assistant/chat-scripts.ts). */
export const SCREEN_PANEL_SECTIONS: Record<string, string[]> = {
  '/dashboard': ['2 Dashboard', '1 Главная ценность'],
  '/client/dashboard': ['2 Dashboard', '1 Главная ценность'],
  '/client/welcome': ['1 Главная ценность', '3 Анкета'],
  '/client/onboarding': ['3 Анкета', '4 Загрузка файлов'],
  '/client/my-data': ['4 Загрузка файлов', '3 Анкета'],
  '/gri': ['7 GRI', '5 Point A'],
  '/pulse': ['7 GRI', '8 Метрики'],
  '/client/point-a': ['5 Point A'],
  '/point-a': ['5 Point A'],
  '/client/point-b': ['6 Point B'],
  '/point-b': ['6 Point B'],
  '/metrics': ['8 Метрики'],
  '/action-plan': ['9 Карта роста / Action Plan'],
  '/insights': ['10 AI-инсайты'],
}

/** Короткий совет Гри в шапке панели — по текущему экрану. */
export const SCREEN_TIPS: Record<string, string> = {
  '/dashboard': 'Начните с виджета прогресса: он показывает, какой шаг сильнее всего продвинет диагностику.',
  '/client/dashboard': 'Начните с виджета прогресса: он показывает, какой шаг сильнее всего продвинет диагностику.',
  '/client/onboarding': 'Не гонитесь за точностью до тенге — приблизительные цифры лучше пустых полей, уточните позже.',
  '/gri': 'Смотрите не на сам индекс, а на топ-ограничения — работа с ними быстрее всего поднимает GRI.',
  '/pulse': 'Pulse полезен в динамике: заходите после каждого изменения данных и сравнивайте с прошлым замером.',
  '/client/point-a': 'Красные блоки — не приговор, а порядок действий: начинайте с самого слабого.',
  '/point-a': 'Красные блоки — не приговор, а порядок действий: начинайте с самого слабого.',
  '/client/point-b': 'Реализм цели важнее её амбициозности: проверьте требуемый темп роста в месяц.',
  '/point-b': 'Реализм цели важнее её амбициозности: проверьте требуемый темп роста в месяц.',
  '/metrics': 'Пустая метрика искажает расчёты сильнее, чем неточная — заполните хотя бы порядок величин.',
}

export const HINT_CATALOG: ReadonlyMap<string, HintDef> = new Map(DEFS.map((d) => [d.id, d]))

/** Resolve a candidate (server or local) against the catalog. Unknown id → null. */
export function resolveHint(candidate: HintCandidate): ResolvedHint | null {
  const def = HINT_CATALOG.get(candidate.id)
  if (!def) return null
  const { text, actions } = def.build(candidate.params ?? {})
  return {
    id: def.id,
    type: def.type,
    state: def.state,
    // Server may sharpen priority; the catalog value is the default.
    priority: candidate.priority ?? def.priority,
    screens: def.screens,
    mutable: def.mutable,
    text,
    actions,
  }
}

/** Build a client-local candidate (greeting / idle / education / celebrate). */
export function localCandidate(id: string, params?: HintParams): HintCandidate | null {
  const def = HINT_CATALOG.get(id)
  if (!def) return null
  return { id, priority: def.priority, params: params as HintCandidate['params'] }
}
