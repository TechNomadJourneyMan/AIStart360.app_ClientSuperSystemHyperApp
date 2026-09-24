/**
 * lib/events/registry.ts — the vocabulary of product events (user_events).
 *
 * Adding an event = one line here. `client: true` events may be sent by the
 * browser (POST /api/v1/events); the rest are written only by the server where
 * the fact actually happens, so they cannot be forged.
 */

export const EVENT_TYPES = ['auth', 'navigation', 'interaction', 'questionnaire', 'gri', 'content', 'document', 'diagnostics', 'system', 'admin'] as const
export type EventType = (typeof EVENT_TYPES)[number]

interface EventDef { type: EventType; client: boolean; label: string }

export const EVENTS = {
  USER_REGISTERED: { type: 'auth', client: false, label: 'Регистрация' },
  LOGIN: { type: 'auth', client: true, label: 'Вход' },
  LOGOUT: { type: 'auth', client: true, label: 'Выход' },
  PAGE_VIEWED: { type: 'navigation', client: true, label: 'Просмотр страницы' },
  SECTION_OPENED: { type: 'navigation', client: true, label: 'Открыт раздел' },
  BUTTON_CLICKED: { type: 'interaction', client: true, label: 'Клик' },
  QUESTIONNAIRE_STARTED: { type: 'questionnaire', client: false, label: 'Анкета начата' },
  QUESTIONNAIRE_STEP_COMPLETED: { type: 'questionnaire', client: false, label: 'Шаг анкеты сохранён' },
  QUESTIONNAIRE_COMPLETED: { type: 'questionnaire', client: false, label: 'Анкета отправлена' },
  GRI_STARTED: { type: 'gri', client: false, label: 'GRI начат' },
  GRI_QUESTION_ANSWERED: { type: 'gri', client: true, label: 'Ответ в GRI' },
  GRI_SECTION_COMPLETED: { type: 'gri', client: false, label: 'Блок GRI пройден' },
  GRI_COMPLETED: { type: 'gri', client: false, label: 'GRI завершён' },
  GRI_RESULT_VIEWED: { type: 'gri', client: true, label: 'Результат GRI открыт' },
  POINT_A_CALCULATED: { type: 'diagnostics', client: false, label: 'Точка А рассчитана' },
  DOCUMENT_UPLOADED: { type: 'document', client: false, label: 'Документ загружен' },
  CONTENT_VIEWED: { type: 'content', client: true, label: 'Материал открыт' },
  CONTENT_COMPLETED: { type: 'content', client: true, label: 'Материал изучен' },
  // ── Единый поток (F-064): то, что раньше писалось только в nba_log,
  //    ai_messages, gri_pulse_responses, business_simulations и т.д.
  AI_CHAT_ASKED: { type: 'interaction', client: false, label: 'Вопрос AI-ассистенту' },
  AI_CHAT_ANSWERED: { type: 'interaction', client: false, label: 'Ответ AI-ассистента' },
  NBA_SHOWN: { type: 'interaction', client: false, label: 'Показан следующий шаг' },
  NBA_DONE: { type: 'interaction', client: false, label: 'Следующий шаг выполнен' },
  NBA_DISMISSED: { type: 'interaction', client: false, label: 'Следующий шаг отклонён' },
  PULSE_SUBMITTED: { type: 'gri', client: false, label: 'Пульс GRI отправлен' },
  SIMULATION_RUN: { type: 'diagnostics', client: false, label: 'Запущена симуляция' },
  POINT_B_VIEWED: { type: 'diagnostics', client: false, label: 'Точка Б открыта' },
  DOCUMENT_PARSED: { type: 'document', client: false, label: 'Документ разобран' },
  TIER_CHANGED: { type: 'system', client: false, label: 'Тариф изменён' },
  IMPERSONATION_STARTED: { type: 'admin', client: false, label: 'Админ открыл кабинет' },
  IMPERSONATION_ENDED: { type: 'admin', client: false, label: 'Админ вышел из кабинета' },
} as const satisfies Record<string, EventDef>

export type EventName = keyof typeof EVENTS

export function isEventName(v: unknown): v is EventName {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EVENTS, v)
}

export function isClientEvent(v: unknown): v is EventName {
  return isEventName(v) && EVENTS[v].client
}

export function eventLabel(name: string): string {
  return isEventName(name) ? EVENTS[name].label : name
}

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/
const MAX_KEYS = 20
const MAX_STR = 200

/** Keep metadata small and flat: primitives only, bounded keys and strings. */
export function sanitizeMetadata(input: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break
    if (!KEY_RE.test(k)) continue
    if (v === null || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_STR)
  }
  return out
}

/** Path only: no query string (may carry tokens), no fragment, bounded length. */
export function sanitizePage(input: unknown): string | null {
  if (typeof input !== 'string' || !input.startsWith('/')) return null
  const path = input.split(/[?#]/)[0]
  // Collapse ids so pages aggregate (/users/<uuid> → /users/:id).
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .slice(0, 300)
}
