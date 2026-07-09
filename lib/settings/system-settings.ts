import { createServiceClient } from '@/lib/supabase-service'

/**
 * Global portal settings backed by the `system_settings` table (migration 040).
 * Service-role only.
 */

// Self-serve активация (D3/6B) живёт НЕ отдельным режимом, а тумблером
// auto_approve_clients внутри 'approval' + risk-скорингом (lib/registration/risk.ts).
export type RegistrationMode = 'open' | 'approval' | 'invite'

const VALID_MODES: RegistrationMode[] = ['open', 'approval', 'invite']
/** The safe default — identical to the pre-toggle behaviour (admin approval). */
const DEFAULT_MODE: RegistrationMode = 'approval'

export function isRegistrationMode(v: unknown): v is RegistrationMode {
  return typeof v === 'string' && (VALID_MODES as string[]).includes(v)
}

/**
 * Current registration mode — FAIL-SAFE. Any problem (table not yet migrated, no
 * row, malformed value, missing service key) resolves to 'approval', so the
 * feature is completely inert until the migration is applied AND an admin opts
 * in. Registration therefore never breaks because of this setting.
 */
export async function getRegistrationMode(): Promise<RegistrationMode> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb
      .from('system_settings')
      .select('value')
      .eq('key', 'registration_mode')
      .maybeSingle()

    if (error || !data) return DEFAULT_MODE

    const raw = data.value as unknown
    const mode = typeof raw === 'string' ? raw : (raw as { mode?: unknown })?.mode
    return isRegistrationMode(mode) ? mode : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
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
 * №15/6B: авто-одобрение self-serve регистраций (client/owner) в режиме
 * 'approval'. Default TRUE — решение ПО 2026-07-09 (главное трение активации);
 * ручная модерация возвращается выключением этого тумблера в giga-admin.
 */
export const getAutoApproveClients = () => getBoolSetting('auto_approve_clients', true)
export const setAutoApproveClients = (v: boolean, by?: string | null) =>
  setBoolSetting('auto_approve_clients', v, by)

/**
 * 6A: тарифные гейты (полный GRI / AI-чат / PDF / бенчмарки). Default FALSE —
 * fail-safe: пока админ явно не включит (и не применит миграцию 048),
 * существующие пользователи ничего не теряют.
 */
export const getAccessGatesEnabled = () => getBoolSetting('access_gates', false)
export const setAccessGatesEnabled = (v: boolean, by?: string | null) =>
  setBoolSetting('access_gates', v, by)
