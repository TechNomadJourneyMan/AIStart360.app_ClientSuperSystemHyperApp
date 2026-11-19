/**
 * CRM revival (2026-11-18), what the owner reads about the CRM sync:
 *   M7  one status vocabulary — the sync writes success / partial / error, the Pulse tab and
 *       Settings read it through lib/crm/sync-status.ts; the legacy 'ok' reads as success (it showed «—»);
 *   M8  no promise the portal does not keep: no OAuth, no «API v4 с автообновлением»; the exact way to
 *       get a Bitrix24 incoming webhook (right «CRM») and an amoCRM long-lived token; the real
 *       auto-sync schedule.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CRM_AUTO_SYNC_DESCRIPTION, CRM_AVG_CHECK_DESCRIPTION, CRM_SYNC_STATUS_LABEL, normaliseSyncStatus } from '@/lib/crm/sync-status'
import { CRM_AUTO_SYNC_INTERVAL_MS } from '@/lib/crm/sync-cron'
import { CRON_JOBS } from '@/lib/cron/schedule'

/** The source of one top-level function of a file (up to the next top-level declaration or section). */
function functionSource(file: string, name: string): string {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf(`function ${name}(`)
  expect(start, `${name} in ${file}`).toBeGreaterThan(-1)
  const rest = src.slice(start + 1)
  const next = rest.search(/\n(?:export )?(?:default )?(?:async )?function |\n\/\/ ── |\n\/\/ ─── /)
  return src.slice(start, next === -1 ? undefined : start + 1 + next)
}

const pulseTab = functionSource('app/(dashboard)/pulse/page.tsx', 'CrmIntegrationTab')
const settings = functionSource('components/settings/IntegrationsPanel.tsx', 'CrmIntegrations')

describe('M7: one status vocabulary', () => {
  it("reads the legacy 'ok' as success, and knows partial and error", () => {
    expect(normaliseSyncStatus('ok')).toBe('success')
    expect(normaliseSyncStatus('success')).toBe('success')
    expect(normaliseSyncStatus('partial')).toBe('partial')
    expect(normaliseSyncStatus('error')).toBe('error')
    expect(normaliseSyncStatus(null)).toBeNull()
    expect(CRM_SYNC_STATUS_LABEL).toEqual({ success: 'Успешно', partial: 'Частично', error: 'Ошибка' })
  })

  it('the Pulse tab and Settings read the stored status through it', () => {
    expect(pulseTab).toMatch(/normaliseSyncStatus\(r\.last_sync_status\)/)
    expect(settings).toMatch(/normaliseSyncStatus\(conn\.last_sync_status\)/)
  })
})

describe('M8: the copy says what the portal really does', () => {
  it('no OAuth and no «API v4 с автообновлением» in the Pulse tab or in Settings › CRM', () => {
    for (const text of [pulseTab, settings]) {
      expect(text).not.toMatch(/OAuth/i)
      expect(text).not.toMatch(/автообновлен/i)
    }
  })

  it('Bitrix24: the incoming webhook, the right «CRM (crm)», the webhook address to paste', () => {
    for (const text of [pulseTab, settings]) {
      expect(text).toMatch(/«Входящий вебхук»/)
      expect(text).toMatch(/«CRM \(crm\)»/)
      expect(text).toMatch(/Вебхук для вызова rest api/)
    }
  })

  it('amoCRM: an external integration and its long-lived token', () => {
    for (const text of [pulseTab, settings]) {
      expect(text).toMatch(/«Внешняя интеграция»/)
      expect(text).toMatch(/«Ключи и доступы»/)
      expect(text).toMatch(/долгосрочный токен/i)
    }
  })

  it('the auto-sync schedule shown is the real one: every 6 h, checks at :17/:47 outside 21:00–23:00 UTC (02:00–04:00 Astana)', () => {
    expect(pulseTab).toMatch(/CRM_AUTO_SYNC_DESCRIPTION/)
    expect(settings).toMatch(/CRM_AUTO_SYNC_DESCRIPTION/)
    expect(CRM_AUTO_SYNC_DESCRIPTION).toMatch(/раз в 6 часов/)
    expect(CRM_AUTO_SYNC_DESCRIPTION).toMatch(/02:00–04:00 по времени Астаны/)
    // Wave 2: «новое — в течение получаса» was false at night; the first sync is started by the screen.
    expect(CRM_AUTO_SYNC_DESCRIPTION).not.toMatch(/в течение получаса/)
    expect(CRM_AUTO_SYNC_DESCRIPTION).toMatch(/сразу после подключения/)
    expect(CRM_AUTO_SYNC_INTERVAL_MS).toBe(6 * 3600_000)
    expect(CRON_JOBS.find((j) => j.path === '/api/cron/crm-sync')?.schedule).toBe('17,47 0-20,23 * * *')
  })
})

describe('wave 2: what the copy promises is done', () => {
  it('«сразу после подключения»: both screens start a sync with the id the connect answer returns', () => {
    expect(pulseTab).toMatch(/if \(typeof data\?\.data\?\.id === 'string'\) void handleSync\(data\.data\.id\)/)
    expect(settings).toMatch(/if \(typeof id === 'string'\) void syncNow\(id\)/)
  })

  it('avg_check: open and won deals in tenge, not lost ones; a figure the owner typed is never changed — shown on both screens', () => {
    expect(CRM_AVG_CHECK_DESCRIPTION).toMatch(/открытых и выигранных сделок в тенге/)
    expect(CRM_AVG_CHECK_DESCRIPTION).toMatch(/проигранные/)
    expect(CRM_AVG_CHECK_DESCRIPTION).toMatch(/ввели сами, синхронизация не меняет/)
    expect(pulseTab).toMatch(/CRM_AVG_CHECK_DESCRIPTION/)
    expect(settings).toMatch(/CRM_AVG_CHECK_DESCRIPTION/)
  })
})
