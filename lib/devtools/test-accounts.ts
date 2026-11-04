/**
 * lib/devtools/test-accounts.ts — тестовые аккаунты Dev-tools (общая часть,
 * без сервера: используется и API, и страницей).
 *
 * Тестовый аккаунт — обычная учётная запись в БД платформы, помеченная
 * `profiles.is_test = true` (миграция 120) и с адресом в домене
 * TEST_EMAIL_DOMAIN. Удаляется одной кнопкой («Удалить все тестовые»).
 */
import type { StaffRole } from '@/lib/admin/rbac'

export const TEST_EMAIL_DOMAIN = 'test.aistart360.app'

export type TestProfileStatus = 'approved' | 'pending_approval' | 'blocked'

export interface TestAccountKind {
  key: string
  label: string
  hint: string
  /** profiles.role */
  profileRole: 'client' | 'expert' | 'admin'
  status: TestProfileStatus
  /** staff_roles.role (null — не сотрудник). */
  staffRole: StaffRole | null
  /** Клиентский аккаунт: можно создать пустую компанию и войти «от имени». */
  client: boolean
}

export const TEST_ACCOUNT_KINDS: readonly TestAccountKind[] = [
  { key: 'client', label: 'Клиент (одобрен)', hint: 'Обычный клиент с доступом к кабинету', profileRole: 'client', status: 'approved', staffRole: null, client: true },
  { key: 'client-pending', label: 'Клиент (ждёт одобрения)', hint: 'Заявка на доступ ещё не рассмотрена — зал ожидания', profileRole: 'client', status: 'pending_approval', staffRole: null, client: true },
  { key: 'client-blocked', label: 'Клиент (заблокирован)', hint: 'Заблокированный аккаунт: вход запрещён', profileRole: 'client', status: 'blocked', staffRole: null, client: true },
  { key: 'expert', label: 'Эксперт', hint: 'Роль профиля expert — кабинет эксперта', profileRole: 'expert', status: 'approved', staffRole: null, client: false },
  { key: 'super-expert', label: 'SuperExpert', hint: 'Кабинет /super-expert', profileRole: 'client', status: 'approved', staffRole: 'super_expert', client: false },
  { key: 'admin', label: 'Администратор', hint: 'Панель GIGA-CRM без ролей, настроек и Dev-tools', profileRole: 'admin', status: 'approved', staffRole: 'admin', client: false },
  { key: 'crm-manager', label: 'CRM-менеджер', hint: 'Работа с клиентами и лидами', profileRole: 'client', status: 'approved', staffRole: 'crm_manager', client: false },
  { key: 'content-manager', label: 'Контент-менеджер', hint: 'Контент, разделы, модерация', profileRole: 'client', status: 'approved', staffRole: 'content_manager', client: false },
  { key: 'analyst', label: 'Аналитик', hint: 'Агрегаты без персональных данных', profileRole: 'client', status: 'approved', staffRole: 'analyst', client: false },
  { key: 'support', label: 'Поддержка', hint: 'Просмотр пользователей, вход «от имени» на просмотр', profileRole: 'client', status: 'approved', staffRole: 'support', client: false },
]

export const TEST_ACCOUNT_KIND_KEYS = TEST_ACCOUNT_KINDS.map((k) => k.key) as [string, ...string[]]

export function testAccountKind(key: unknown): TestAccountKind | null {
  return TEST_ACCOUNT_KINDS.find((k) => k.key === key) ?? null
}

export const TEST_STATUSES: ReadonlyArray<{ value: TestProfileStatus; label: string }> = [
  { value: 'approved', label: 'Одобрен' },
  { value: 'pending_approval', label: 'Ждёт одобрения' },
  { value: 'blocked', label: 'Заблокирован' },
]

export function isTestStatus(v: unknown): v is TestProfileStatus {
  return v === 'approved' || v === 'pending_approval' || v === 'blocked'
}

const ALNUM = 'abcdefghijkmnpqrstuvwxyz23456789'

function randomInts(n: number): Uint32Array {
  const out = new Uint32Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

function randomFrom(alphabet: string, n: number): string {
  return Array.from(randomInts(n), (v) => alphabet[v % alphabet.length]).join('')
}

/** `<kind>.<8 случайных символов>@test.aistart360.app` */
export function testAccountEmail(kindKey: string, suffix = randomFrom(ALNUM, 8)): string {
  const slug = kindKey.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'user'
  return `${slug}.${suffix}@${TEST_EMAIL_DOMAIN}`
}

export function isTestEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`)
}

/**
 * Случайный сильный пароль: 20 символов, гарантированно есть строчная,
 * заглавная буква, цифра и спецсимвол. Показывается один раз и нигде не хранится.
 */
export function generateTestPassword(length = 20): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const special = '!@#$%^&*-_=+'
  const all = lower + upper + digits + special
  const n = Math.max(12, length)
  const chars = [randomFrom(lower, 1), randomFrom(upper, 1), randomFrom(digits, 1), randomFrom(special, 1), randomFrom(all, n - 4)].join('').split('')
  // Fisher–Yates: the guaranteed classes must not always sit at the start.
  const r = randomInts(chars.length)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** «Тест · SuperExpert» */
export function testAccountName(kind: TestAccountKind): string {
  return `Тест · ${kind.label}`
}

/**
 * PostgREST error for a column that does not exist yet (migration 120 not
 * applied): 42703 from Postgres, PGRST204 from the schema cache on writes.
 */
export function isMissingColumnError(err: { code?: string; message?: string } | null | undefined, column = 'is_test'): boolean {
  if (!err) return false
  if (err.code === '42703' || err.code === 'PGRST204') return true
  const m = err.message ?? ''
  return m.includes(column) && /does not exist|could not find|schema cache/i.test(m)
}

export const MIGRATION_120_MESSAGE = 'Колонка profiles.is_test ещё не создана — примените миграцию 120 (node scripts/apply-migration.js supabase/migrations/120_content_filter_devtools.sql)'
