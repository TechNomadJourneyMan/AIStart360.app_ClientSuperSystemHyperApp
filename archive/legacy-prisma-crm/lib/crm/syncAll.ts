// Archived 2026-11-18: the legacy-only syncAll() helpers of lib/crm/bitrix24.ts and lib/crm/amocrm.ts.
// Only the archived /api/crm/sync route called them; they counted records and wrote nothing.
// Snapshot — the imports below point at the live modules and are not compiled (archive/ is excluded).
import type { CrmSyncResult } from '@/lib/crm/types'
import { fetchContacts as bitrixContacts, fetchDeals as bitrixDeals, type Bitrix24Config } from '@/lib/crm/bitrix24'
import { fetchContacts as amoContacts, fetchDeals as amoDeals, type AmoCrmConfig } from '@/lib/crm/amocrm'

// from lib/crm/bitrix24.ts
/**
 * @deprecated Only the legacy /api/crm/sync route (being archived) calls this; it counts records
 * and writes nothing. The portal's sync is lib/crm/sync.ts.
 */
export async function syncAllBitrix24(config: Bitrix24Config): Promise<CrmSyncResult> {
  const errors: string[] = []
  let deals = 0
  let contacts = 0

  try {
    const fetchedDeals = await bitrixDeals(config, 200)
    deals = fetchedDeals.length
  } catch (e) {
    errors.push(`Сделки: ${(e as Error).message}`)
  }

  try {
    const fetchedContacts = await bitrixContacts(config, 200)
    contacts = fetchedContacts.length
  } catch (e) {
    errors.push(`Контакты: ${(e as Error).message}`)
  }

  return {
    success: errors.length === 0,
    deals,
    contacts,
    errors,
    syncedAt: new Date().toISOString(),
  }
}

// from lib/crm/amocrm.ts
/**
 * @deprecated Only the legacy /api/crm/sync route (being archived) calls this; it counts records
 * and writes nothing. The portal's sync is lib/crm/sync.ts.
 */
export async function syncAllAmoCrm(config: AmoCrmConfig): Promise<CrmSyncResult> {
  const errors: string[] = []
  let deals = 0
  let contacts = 0

  try {
    const fetchedDeals = await amoDeals(config, 200)
    deals = fetchedDeals.length
  } catch (e) {
    errors.push(`Сделки: ${(e as Error).message}`)
  }

  try {
    const fetchedContacts = await amoContacts(config, 200)
    contacts = fetchedContacts.length
  } catch (e) {
    errors.push(`Контакты: ${(e as Error).message}`)
  }

  return {
    success: errors.length === 0,
    deals,
    contacts,
    errors,
    syncedAt: new Date().toISOString(),
  }
}
