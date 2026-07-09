import { createServiceClient } from '@/lib/supabase-service'

/**
 * Global portal settings backed by the `system_settings` table (migration 040).
 * Service-role only.
 */

// 'auto' = self-serve activation (D3): risk-scored auto-approval, manual review
// only for flagged candidates. See lib/registration/risk.ts.
export type RegistrationMode = 'open' | 'approval' | 'invite' | 'auto'

const VALID_MODES: RegistrationMode[] = ['open', 'approval', 'invite', 'auto']
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
