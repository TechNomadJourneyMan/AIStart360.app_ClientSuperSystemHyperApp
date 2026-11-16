import { createServiceClient } from '@/lib/supabase-service'

/**
 * Global portal settings backed by the `system_settings` table (migration 040).
 * Service-role only.
 */

// Self-serve активация (D3/6B) живёт НЕ отдельным режимом, а тумблером
// auto_approve_clients внутри 'approval' + risk-скорингом (lib/registration/risk.ts).
export type RegistrationMode = 'open' | 'approval' | 'invite'

const VALID_MODES: RegistrationMode[] = ['open', 'approval', 'invite']
/** The default when the admin never set the mode (no row) — the pre-toggle behaviour (admin approval). */
const DEFAULT_MODE: RegistrationMode = 'approval'

export function isRegistrationMode(v: unknown): v is RegistrationMode {
  return typeof v === 'string' && (VALID_MODES as string[]).includes(v)
}

export interface RegistrationModeRead {
  mode: RegistrationMode
  /** false — the database could not be read (an error, not «no row»). */
  ok: boolean
  /** When the row was last written (ISO) — «invite mode on since» for the invite-only gate. */
  updatedAt: string | null
}

/** Last successfully read mode (per server instance) — used for a short while when a read fails. */
let lastKnownMode: { mode: RegistrationMode; at: number } | null = null
const LAST_KNOWN_MS = 5 * 60_000

/**
 * Strict read of the registration mode. «No row» / a malformed value is the
 * default 'approval' (ok: true — the admin never switched it); a database
 * ERROR is ok: false, so the caller can choose the closed answer.
 */
export async function readRegistrationMode(): Promise<RegistrationModeRead> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb
      .from('system_settings')
      .select('value, updated_at')
      .eq('key', 'registration_mode')
      .maybeSingle()

    if (error) return { mode: DEFAULT_MODE, ok: false, updatedAt: null }
    if (!data) return { mode: DEFAULT_MODE, ok: true, updatedAt: null }

    const raw = (data as { value?: unknown }).value
    const mode = typeof raw === 'string' ? raw : (raw as { mode?: unknown })?.mode
    const updatedAt = typeof (data as { updated_at?: unknown }).updated_at === 'string' ? (data as { updated_at: string }).updated_at : null
    const value = isRegistrationMode(mode) ? mode : DEFAULT_MODE
    lastKnownMode = { mode: value, at: Date.now() }
    return { mode: value, ok: true, updatedAt }
  } catch {
    return { mode: DEFAULT_MODE, ok: false, updatedAt: null }
  }
}

/**
 * Current registration mode. «No row» → 'approval' (the default the admin
 * never changed). R4 B3 (review W3A-3): a database ERROR is not «approval» any
 * more — every caller of this function creates accounts or shows sign-up / the
 * demo, so a failed read gives the last mode read in the last 5 minutes, or
 * the closed one: 'invite'. (Before, a too_many_connections moment on prod
 * opened registration, the demo and the Google gate at once.)
 */
export async function getRegistrationMode(): Promise<RegistrationMode> {
  const r = await readRegistrationMode()
  if (r.ok) return r.mode
  if (lastKnownMode && Date.now() - lastKnownMode.at < LAST_KNOWN_MS) return lastKnownMode.mode
  return 'invite'
}

/** Tests only. */
export function __resetRegistrationModeCacheForTests(): void {
  lastKnownMode = null
}

export async function setRegistrationMode(mode: RegistrationMode, updatedBy?: string | null): Promise<void> {
  if (!isRegistrationMode(mode)) throw new Error(`Invalid registration mode: ${mode}`)

  const sb = createServiceClient()
  const { error } = await sb.from('system_settings').upsert(
    {
      key: 'registration_mode',
      value: mode as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    },
    { onConflict: 'key' },
  )
  if (error) throw new Error(`Failed to set registration mode: ${error.message}`)
}

// ─── Boolean system switches (Фаза 6, Пакет VIII) ───────────────────────────
// Общий fail-safe reader: любая проблема (нет таблицы/строки/ключа) → default.

async function getBoolSetting(key: string, def: boolean): Promise<boolean> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb
      .from('system_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    if (error || !data) return def
    const raw = data.value as unknown
    const v = typeof raw === 'boolean' ? raw : (raw as { enabled?: unknown })?.enabled
    return typeof v === 'boolean' ? v : def
  } catch {
    return def
  }
}

async function setBoolSetting(key: string, enabled: boolean, updatedBy?: string | null): Promise<void> {
  const sb = createServiceClient()
  const { error } = await sb.from('system_settings').upsert(
    {
      key,
      value: enabled as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    },
    { onConflict: 'key' },
  )
  if (error) throw new Error(`Failed to set ${key}: ${error.message}`)
}

/**
 * №15/6B: авто-одобрение self-serve регистраций (client) в режиме
 * 'approval'. Default TRUE — решение ПО 2026-07-09 (главное трение активации);
 * ручная модерация возвращается выключением этого тумблера в giga-admin.
 */
export const getAutoApproveClients = () => getBoolSetting('auto_approve_clients', true)
export const setAutoApproveClients = (v: boolean, by?: string | null) =>
  setBoolSetting('auto_approve_clients', v, by)

/**
 * 6A: тарифные гейты (Точка А / Б, Рынок, полный GRI, AI-чат / PDF / бенчмарки).
 * Default FALSE: пока админ явно не включит, существующие пользователи ничего не теряют.
 *
 * R2-A (ревью M-2): «строки нет» → false (как раньше), но ОШИБКА чтения больше
 * не открывает платные разделы. Раньше при сбое БД (too_many_connections) Free в
 * эти секунды получал 200 вместо 402. Теперь: последнее успешно прочитанное
 * значение (не старше 5 минут), иначе — гейты считаются включёнными (fail closed;
 * персонал проходит гейт по своему праву, lib/access/decision.ts). Ошибка — в лог.
 */
const ACCESS_GATES_LAST_KNOWN_MS = 5 * 60_000
let accessGatesLastKnown: { value: boolean; at: number } | null = null

export async function getAccessGatesEnabled(): Promise<boolean> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb
      .from('system_settings')
      .select('value')
      .eq('key', 'access_gates')
      .maybeSingle()
    if (error) throw new Error(error.message)
    const raw = (data as { value?: unknown } | null)?.value
    const v = typeof raw === 'boolean' ? raw : (raw as { enabled?: unknown } | null | undefined)?.enabled
    const value = typeof v === 'boolean' ? v : false
    accessGatesLastKnown = { value, at: Date.now() }
    return value
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (accessGatesLastKnown && Date.now() - accessGatesLastKnown.at < ACCESS_GATES_LAST_KNOWN_MS) {
      console.warn('[access_gates] read failed, using the last known value:', accessGatesLastKnown.value, msg)
      return accessGatesLastKnown.value
    }
    console.error('[access_gates] read failed — paid sections stay CLOSED for clients until it can be read (fail closed):', msg)
    return true
  }
}

/** Test hook: forget the last known value of access_gates. */
export function resetAccessGatesCacheForTests(): void {
  accessGatesLastKnown = null
}
export const setAccessGatesEnabled = (v: boolean, by?: string | null) =>
  setBoolSetting('access_gates', v, by)

/**
 * R2 (ТЗ §4.7): обязательная модерация клиентских AI-инсайтов. Default TRUE —
 * ИИ по умолчанию помощник, а не автор: сгенерированные инсайты попадают в
 * очередь проверки ГИГА-Панели (visible_to_user = false, миграция 060) и
 * появляются у клиента только после публикации экспертом. Выключение тумблера
 * = режим автопубликации (осознанное решение админа, действие аудируется).
 */
export const getInsightModerationEnabled = () => getBoolSetting('insight_moderation', true)
export const setInsightModerationEnabled = (v: boolean, by?: string | null) =>
  setBoolSetting('insight_moderation', v, by)
