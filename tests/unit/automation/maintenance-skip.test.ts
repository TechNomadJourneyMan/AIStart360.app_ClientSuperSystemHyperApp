/**
 * R-026 — reminders and the weekly digest went out to clients while the cabinet was closed for
 * maintenance (system_settings.maintenance.enabled): «зайдите в кабинет» to a page that says
 * «Ведутся работы». Both now skip the whole run and say why in the log. An unreadable setting
 * counts as «maybe in maintenance»: the run is skipped (the next one is a day / a week later).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  settingsError: null as Error | null,
  fetchClientStates: vi.fn(async () => [] as unknown[]),
}))

vi.mock('@/lib/settings/store', () => ({
  getSetting: async (key: string) => {
    if (h.settingsError) throw h.settingsError
    return h.settings[key]
  },
}))
vi.mock('@/lib/automation/data', () => ({
  fetchClientStates: h.fetchClientStates,
  fetchGriDrafts: async () => new Map(),
  fetchPulseWeeks: async () => new Map(),
  fetchSurveyRows: async () => new Map(),
  fetchGriHistory: async () => new Map(),
  fetchLastDigests: async () => new Map(),
  fetchNbaDone: async () => new Map(),
  fetchOpenPlanTasks: async () => new Map(),
  fetchPublishedContent: async () => [],
}))
vi.mock('@/lib/automation/survey-modes', () => ({ fetchSurveyModes: async () => new Map() }))
vi.mock('@/lib/notifications/notify', () => ({ notifyClient: vi.fn() }))
vi.mock('@/lib/notifications/store', () => ({ getRecipient: async () => null }))

const { runReminders } = await import('@/lib/automation/reminders')
const { runClientDigest } = await import('@/lib/automation/client-digest')
const { maintenanceBlocksClientMessages } = await import('@/lib/automation/maintenance-gate')

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  h.settings = { client_digest_enabled: true }
  h.settingsError = null
  h.fetchClientStates.mockClear()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('R-026 maintenance gate', () => {
  it('blocks while maintenance is on, lets through when off', async () => {
    h.settings.maintenance = { enabled: true, message: '', until: '' }
    expect(await maintenanceBlocksClientMessages('reminders')).toBe(true)
    h.settings.maintenance = { enabled: false, message: '', until: '' }
    expect(await maintenanceBlocksClientMessages('reminders')).toBe(false)
  })

  it('blocks when the setting cannot be read (fail-closed) and logs the reason', async () => {
    h.settingsError = new Error('db down')
    expect(await maintenanceBlocksClientMessages('client-digest')).toBe(true)
    expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(/automation_skipped.*client-digest.*maintenance_unknown/)
  })

  it('runReminders sends nothing during maintenance and reports it', async () => {
    h.settings.maintenance = { enabled: true, message: '', until: '' }
    const stats = await runReminders(new Date('2026-11-13T06:00:00Z'))
    expect(h.fetchClientStates).not.toHaveBeenCalled()
    expect(stats).toMatchObject({ sent: 0, skippedReason: 'maintenance' })
    expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(/automation_skipped.*reminders.*maintenance/)
  })

  it('runClientDigest sends nothing during maintenance and reports it', async () => {
    h.settings.maintenance = { enabled: true, message: '', until: '' }
    const stats = await runClientDigest(new Date('2026-11-13T06:00:00Z'))
    expect(h.fetchClientStates).not.toHaveBeenCalled()
    expect(stats).toMatchObject({ sent: 0, skippedReason: 'maintenance' })
  })

  it('outside maintenance both run as before', async () => {
    h.settings.maintenance = { enabled: false, message: '', until: '' }
    await runReminders(new Date('2026-11-13T06:00:00Z'))
    await runClientDigest(new Date('2026-11-13T06:00:00Z'))
    expect(h.fetchClientStates).toHaveBeenCalledTimes(2)
  })
})
