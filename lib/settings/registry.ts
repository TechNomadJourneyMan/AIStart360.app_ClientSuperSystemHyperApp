/**
 * lib/settings/registry.ts — every platform setting managed in GIGA-CRM.
 *
 * One definition per setting: storage key (system_settings), schema, default
 * (= behaviour when the row is missing), group and help text. Readers are
 * fail-safe: a missing or malformed value resolves to the default.
 */
import { z } from 'zod'

export const NOTIFICATION_TYPES = {
  user_registered: 'Новая регистрация',
  user_login: 'Вход пользователя',
  survey_completed: 'Анкета заполнена',
  file_uploaded: 'Загружен документ',
  diagnostic_recalculated: 'Пересчитана диагностика',
  expert_case_created: 'Новый кейс для эксперта',
  expert_case_updated: 'Кейс эксперта обновлён',
  expert_comment_edited: 'Комментарий эксперта изменён',
  expert_comment_deleted: 'Комментарий эксперта удалён',
} as const
export type AdminNotificationType = keyof typeof NOTIFICATION_TYPES

const notificationShape = Object.fromEntries(
  (Object.keys(NOTIFICATION_TYPES) as AdminNotificationType[]).map((k) => [k, z.boolean()]),
) as Record<AdminNotificationType, z.ZodBoolean>

const safeHref = z.string().max(300).refine((v) => v === '' || (v.startsWith('/') && !v.startsWith('//')) || v.startsWith('https://'), 'Ссылка: https:// или путь /…')

export const SETTINGS = {
  registration_mode: {
    group: 'registration', label: 'Режим регистрации',
    help: 'Открытая — вход сразу; по подтверждению — после одобрения (или авто-одобрения); по приглашению — регистрация закрыта.',
    schema: z.enum(['open', 'approval', 'invite']), default: 'approval' as const, critical: true,
  },
  auto_approve_clients: {
    group: 'registration', label: 'Авто-одобрение клиентов',
    help: 'В режиме «по подтверждению» клиенты с низким риском получают доступ без ручной проверки.',
    schema: z.boolean(), default: true, critical: false,
  },
  access_gates: {
    group: 'registration', label: 'Тарифные ограничения (Free / Pro)',
    help: 'Включает ограничения бесплатного тарифа: полный GRI, AI-чат, PDF, бенчмарки.',
    schema: z.boolean(), default: false, critical: true,
  },
  gri_free_runs: {
    group: 'registration', label: 'Прохождений GRI на тарифе Free',
    help: 'Сколько полных GRI доступно бесплатно, когда тарифные ограничения включены.',
    schema: z.number().int().min(0).max(20), default: 1, critical: false,
  },
  insight_moderation: {
    group: 'content', label: 'Модерация ИИ-инсайтов',
    help: 'ИИ-инсайты попадают клиенту только после проверки в «Модерации ИИ». Выключение = автопубликация.',
    schema: z.boolean(), default: true, critical: true,
  },
  announcement: {
    group: 'cabinet', label: 'Объявление в кабинете',
    help: 'Полоса над кабинетом клиента: новости, акции, плановые работы.',
    schema: z.object({
      enabled: z.boolean(),
      text: z.string().trim().max(300),
      tone: z.enum(['info', 'success', 'warning']),
      link_label: z.string().trim().max(40),
      link_href: safeHref,
    }).refine((a) => !a.enabled || a.text.length > 0, 'Введите текст объявления'),
    default: { enabled: false, text: '', tone: 'info' as const, link_label: '', link_href: '' },
    critical: false,
  },
  maintenance: {
    group: 'cabinet', label: 'Режим технических работ',
    help: 'Кабинет клиента закрывается страницей «Ведутся работы» (вступает в силу в течение нескольких секунд). Панель управления и кабинет «от имени» продолжают работать.',
    schema: z.object({
      enabled: z.boolean(),
      message: z.string().trim().max(500),
      until: z.string().trim().max(40),
    }),
    default: { enabled: false, message: 'Проводим технические работы. Кабинет скоро снова будет доступен.', until: '' },
    critical: true,
  },
  impersonation_edit_enabled: {
    group: 'security', label: 'Правка в кабинете от имени пользователя',
    help: 'Разрешить режим «просмотр и правка». При выключении доступен только просмотр.',
    schema: z.boolean(), default: true, critical: false,
  },
  impersonation_ttl_minutes: {
    group: 'security', label: 'Длительность сессии «от имени», минут',
    help: 'После истечения браузер автоматически выходит из кабинета пользователя.',
    schema: z.number().int().min(5).max(120), default: 30, critical: false,
  },
  staff_require_mfa: {
    group: 'security', label: 'Обязательная 2FA для персонала',
    help: 'Сотрудник без настроенной двухфакторной защиты не попадёт в панель, пока не включит её в настройках профиля.',
    schema: z.boolean(), default: false, critical: true,
  },
  super_expert_impersonation: {
    group: 'security', label: 'SuperExpert может открывать кабинет клиента',
    help: 'Выключите, если роль SuperExpert должна только смотреть данные. Каждый вход от имени и так ограничен по времени и пишется в журнал.',
    schema: z.boolean(), default: true, critical: true,
  },
  analytics_enabled: {
    group: 'analytics', label: 'Сбор поведенческой аналитики',
    help: 'Просмотры страниц, клики и время в разделах. Ключевые события (регистрация, анкета, GRI) пишутся всегда — на них строятся CJM и воронка.',
    schema: z.boolean(), default: true, critical: false,
  },
  events_retention_days: {
    group: 'analytics', label: 'Хранить события, дней',
    help: 'Кнопка «Очистить старые события» удаляет всё, что старше этого срока.',
    schema: z.number().int().min(30).max(1825), default: 365, critical: false,
  },
  escalation_sla_hours: {
    group: 'notifications', label: 'SLA эскалаций, часов',
    help: 'Сколько часов есть у ответственного, чтобы взять обращение клиента в работу, — по приоритету. После срока кейс в очереди «Эскалации» помечается как просроченный.',
    schema: z.object({
      critical: z.number().int().min(1).max(720),
      high: z.number().int().min(1).max(720),
      medium: z.number().int().min(1).max(720),
      low: z.number().int().min(1).max(720),
    }),
    default: { critical: 2, high: 4, medium: 24, low: 72 },
    critical: false,
  },
  admin_notifications: {
    group: 'notifications', label: 'Уведомления администраторам',
    help: 'Какие события отправляются в Telegram и на почту администраторов.',
    schema: z.object(notificationShape),
    default: Object.fromEntries((Object.keys(NOTIFICATION_TYPES) as AdminNotificationType[]).map((k) => [k, true])) as Record<AdminNotificationType, boolean>,
    critical: false,
  },
} as const

export type SettingKey = keyof typeof SETTINGS
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

export const SETTING_GROUPS = {
  registration: { label: 'Регистрация и доступ', icon: 'user-plus' },
  content: { label: 'Контент и ИИ', icon: 'sparkles' },
  cabinet: { label: 'Кабинет клиента', icon: 'layout' },
  security: { label: 'Безопасность', icon: 'shield' },
  analytics: { label: 'Аналитика', icon: 'activity' },
  notifications: { label: 'Уведомления', icon: 'bell' },
} as const

export function isAdminNotificationType(v: string): v is AdminNotificationType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, v)
}

export function isSettingKey(v: unknown): v is SettingKey {
  return typeof v === 'string' && (SETTING_KEYS as string[]).includes(v)
}

/** Parse a stored value; anything invalid → default. Objects are merged over defaults. */
export function coerceSetting<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  const def = SETTINGS[key]
  let candidate: unknown = raw
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && def.default && typeof def.default === 'object') {
    candidate = { ...(def.default as object), ...(raw as object) }
  } else if (raw && typeof raw === 'object' && 'enabled' in (raw as object) && typeof def.default === 'boolean') {
    candidate = (raw as { enabled: unknown }).enabled
  } else if (raw && typeof raw === 'object' && 'mode' in (raw as object)) {
    candidate = (raw as { mode: unknown }).mode
  }
  const r = def.schema.safeParse(candidate)
  return (r.success ? r.data : def.default) as SettingValue<K>
}

export function validateSetting<K extends SettingKey>(key: K, value: unknown): { ok: true; value: SettingValue<K> } | { ok: false; error: string } {
  const r = SETTINGS[key].schema.safeParse(value)
  if (r.success) return { ok: true, value: r.data as SettingValue<K> }
  return { ok: false, error: `${SETTINGS[key].label}: ${r.error.issues[0]?.message ?? 'неверное значение'}` }
}
