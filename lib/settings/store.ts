import { createServiceClient } from '@/lib/supabase-service'
import { SETTING_KEYS, coerceSetting, type SettingKey, type SettingValue } from './registry'

/**
 * Cached reader for platform settings (Node runtime). One query loads all
 * rows; the snapshot lives 5 s per server instance, and writes through
 * `saveSettings` refresh it immediately on the instance that wrote.
 */

interface Row { key: string; value: unknown; updated_at: string; updated_by: string | null }
let snapshot: { at: number; rows: Map<string, Row> } | null = null
const TTL_MS = 5_000

async function load(fresh = false): Promise<Map<string, Row>> {
  if (!fresh && snapshot && Date.now() - snapshot.at < TTL_MS) return snapshot.rows
  try {
    const { data, error } = await createServiceClient().from('system_settings').select('key, value, updated_at, updated_by')
    if (error) throw error
    snapshot = { at: Date.now(), rows: new Map((data ?? []).map((r) => [r.key as string, r as Row])) }
  } catch (err) {
    // A fresh read must not silently fall back to stale data.
    if (fresh) throw err
    snapshot = { at: Date.now(), rows: snapshot?.rows ?? new Map() }
  }
  return snapshot.rows
}

export function invalidateSettings(): void {
  snapshot = null
}

/**
 * Cached read (5 s) for hot paths. Pass `{ fresh: true }` wherever a stale
 * value would mislead: the admin UI, writes, the maintenance page. Every route
 * bundle keeps its own module copy, so a write elsewhere does not clear it.
 */
export async function getSetting<K extends SettingKey>(key: K, opts: { fresh?: boolean } = {}): Promise<SettingValue<K>> {
  const rows = await load(opts.fresh)
  return coerceSetting(key, rows.get(key)?.value)
}

export async function getAllSettings(opts: { fresh?: boolean } = {}): Promise<{
  values: { [K in SettingKey]: SettingValue<K> }
  meta: Record<string, { updated_at: string; updated_by: string | null }>
}> {
  const rows = await load(opts.fresh)
  const values = Object.fromEntries(SETTING_KEYS.map((k) => [k, coerceSetting(k, rows.get(k)?.value)])) as { [K in SettingKey]: SettingValue<K> }
  const meta = Object.fromEntries(Array.from(rows.values()).map((r) => [r.key, { updated_at: r.updated_at, updated_by: r.updated_by }]))
  return { values, meta }
}

export async function saveSettings(values: Partial<Record<SettingKey, unknown>>, updatedBy: string): Promise<void> {
  const now = new Date().toISOString()
  const rows = Object.entries(values).map(([key, value]) => ({ key, value, updated_at: now, updated_by: updatedBy }))
  if (!rows.length) return
  const { error } = await createServiceClient().from('system_settings').upsert(rows, { onConflict: 'key' })
  invalidateSettings()
  if (error) throw new Error(error.message)
}
