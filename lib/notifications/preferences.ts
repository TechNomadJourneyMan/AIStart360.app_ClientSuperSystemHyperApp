/**
 * lib/notifications/preferences.ts — категории клиентских уведомлений и выбор
 * каналов по `profiles.preferences.notifications`.
 *
 * Чистый модуль (без БД и сети): его импортируют и сервер (`notify.ts`,
 * CRM-дайджест), и клиентский экран настроек (`SettingsClient.tsx`), поэтому
 * значения по умолчанию на экране и в рассылке берутся из ОДНОГО места.
 *
 * Хранение: preferences.notifications[<категория>] = { in_app?, email?, telegram? }.
 * Отсутствующее значение = значение по умолчанию из NOTIFY_DEFAULTS.
 * Что именно включает каждая категория — см. таблицу в начале notify.ts.
 */

export type NotifyCategory =
  | 'gri'
  | 'reports'
  | 'digest'
  | 'security'
  | 'team'
  | 'crm'
  | 'expert'
  | 'reminders'

export type NotifyChannel = 'in_app' | 'email' | 'telegram'
export type ChannelPrefs = Partial<Record<NotifyChannel, boolean>>

export interface ResolvedChannels {
  inApp: boolean
  email: boolean
  telegram: boolean
}

/**
 * Значения по умолчанию. Telegram по умолчанию выключен везде, кроме
 * CRM-дайджеста (так он работал с Фазы 4A); включается только если чат
 * привязан И пользователь включил канал для категории.
 */
export const NOTIFY_DEFAULTS: Record<NotifyCategory, Required<ChannelPrefs>> = {
  gri: { in_app: true, email: true, telegram: false },
  expert: { in_app: true, email: true, telegram: false },
  reports: { in_app: true, email: false, telegram: false },
  reminders: { in_app: true, email: true, telegram: false },
  digest: { in_app: true, email: true, telegram: false },
  crm: { in_app: true, email: true, telegram: true },
  team: { in_app: true, email: true, telegram: false },
  security: { in_app: true, email: true, telegram: false },
}

/** Категории, которые пользователь не может выключить (доступ, безопасность). */
export const LOCKED_CATEGORIES: ReadonlySet<NotifyCategory> = new Set<NotifyCategory>(['security'])

/** Порядок и подписи для экрана настроек. `desc` — честно: что реально приходит. */
export const NOTIFY_CATEGORY_UI: ReadonlyArray<{ key: NotifyCategory; label: string; desc: string }> = [
  { key: 'gri', label: 'Диагностика и GRI', desc: 'Анкета принята, GRI пройден, пора пересчитать GRI (раз в 90 дней)' },
  { key: 'expert', label: 'Эксперт', desc: 'Новый комментарий эксперта, изменения по вашему обращению' },
  { key: 'reports', label: 'Отчёты и документы', desc: '«Точка А» пересчитана, документ разобран' },
  { key: 'reminders', label: 'Напоминания', desc: 'Незаконченная анкета или GRI, пульс недели, первые шаги после регистрации. Не чаще 2 раз в неделю' },
  { key: 'digest', label: 'Еженедельный дайджест', desc: 'По понедельникам: динамика GRI, задачи плана на неделю, новые материалы, главный следующий шаг' },
  { key: 'crm', label: 'CRM-дайджест', desc: 'Утром: кому звонить + слабый блок GRI' },
  { key: 'team', label: 'Задачи команды', desc: 'Для сотрудников: утренний список просроченных задач' },
  { key: 'security', label: 'Аккаунт и безопасность', desc: 'Доступ открыт, вход, смена пароля. Отключить нельзя' },
]

export function isNotifyCategory(v: unknown): v is NotifyCategory {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(NOTIFY_DEFAULTS, v)
}

/** Настройки категории с учётом значений по умолчанию (для UI и сервера). */
export function categoryPrefs(prefs: unknown, category: NotifyCategory): Required<ChannelPrefs> {
  const defaults = NOTIFY_DEFAULTS[category]
  if (LOCKED_CATEGORIES.has(category)) return { ...defaults }
  const raw = (prefs as { notifications?: Record<string, unknown> } | null | undefined)?.notifications?.[category]
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ChannelPrefs) : {}
  const pick = (ch: NotifyChannel): boolean => (typeof stored[ch] === 'boolean' ? (stored[ch] as boolean) : defaults[ch])
  return { in_app: pick('in_app'), email: pick('email'), telegram: pick('telegram') }
}

/**
 * Каналы доставки для категории: предпочтение пользователя И наличие адреса.
 * `override` (из вызова notifyClient) побеждает предпочтение: false — канал
 * выключен принудительно, true — включён даже если пользователь его выключил
 * (используется только для обязательных писем). Адрес/чат нужен всегда.
 */
export function resolveChannels(
  prefs: unknown,
  category: NotifyCategory,
  opts: { hasEmail: boolean; hasTelegram: boolean; override?: Partial<ResolvedChannels> },
): ResolvedChannels {
  const p = categoryPrefs(prefs, category)
  const o = opts.override ?? {}
  const pick = (forced: boolean | undefined, pref: boolean) => (typeof forced === 'boolean' ? forced : pref)
  return {
    inApp: pick(o.inApp, p.in_app),
    email: pick(o.email, p.email) && opts.hasEmail,
    telegram: pick(o.telegram, p.telegram) && opts.hasTelegram,
  }
}
