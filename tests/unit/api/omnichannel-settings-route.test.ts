import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const actor = vi.hoisted(() => ({ get: vi.fn() }))
const audit = vi.hoisted(() => ({ log: vi.fn() }))
const configuration = vi.hoisted(() => ({
  instagram: false,
  whatsapp: false,
  whatsappWeb: false,
}))
const database = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  updatePatch: null as Record<string, unknown> | null,
  updated: {} as Record<string, unknown>,
}))

vi.mock('@/lib/admin/giga-actor', () => ({
  getGigaActor: actor.get,
  isGigaSuperAdmin: vi.fn(),
}))
vi.mock('@/lib/audit', () => ({ logAudit: audit.log }))
vi.mock('@/lib/omnichannel/development-admin-postgres', () => ({
  shouldUseDevelopmentAdminPostgres: () => false,
  listDevelopmentAdminSettings: vi.fn(),
  setDevelopmentEquipmentFlowEnabled: vi.fn(),
  updateDevelopmentAdminSetting: vi.fn(),
}))
vi.mock('@/lib/omnichannel/meta-client', () => ({
  getMetaConfigurationHealth: () => ({
    instagram: { configured: configuration.instagram },
    whatsapp: { configured: configuration.whatsapp },
  }),
}))
vi.mock('@/lib/omnichannel/whatsapp-web-client', () => ({
  getWhatsAppWebBridgeConfigurationHealth: () => ({
    configured: configuration.whatsappWeb,
  }),
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {}
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.maybeSingle = vi.fn(async () => ({ data: database.current, error: null }))
    chain.update = vi.fn((patch: Record<string, unknown>) => {
      database.updatePatch = patch
      return chain
    })
    chain.single = vi.fn(async () => ({ data: database.updated, error: null }))
    return { from: vi.fn(() => chain) }
  },
}))

import { PATCH } from '@/app/api/giga-admin/omnichannel/settings/route'

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/giga-admin/omnichannel/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function setting(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'instagram',
    enabled: false,
    mode: 'draft',
    business_context: 'Honor Group facts',
    automation_config: {},
    confidence_threshold: 0.75,
    reply_delay_seconds: 20,
    updated_at: '2026-07-16T10:00:00.000Z',
    ...overrides,
  }
}

describe('omnichannel settings auto readiness', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    actor.get.mockResolvedValue({ id: 'admin-1', kind: 'session' })
    audit.log.mockResolvedValue(undefined)
    configuration.instagram = false
    configuration.whatsapp = false
    configuration.whatsappWeb = false
    database.current = setting()
    database.updated = setting({ enabled: true, mode: 'auto' })
    database.updatePatch = null
  })

  it('blocks activating Instagram auto when provider configuration is absent', async () => {
    database.current = setting({ enabled: false, mode: 'auto' })

    const response = await PATCH(request({ channel: 'instagram', enabled: true }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'omnichannel_auto_not_ready',
      missing: ['provider_configuration'],
    })
    expect(database.updatePatch).toBeNull()
  })

  it('blocks clearing the verified context while active auto is enabled', async () => {
    configuration.instagram = true
    database.current = setting({ enabled: true, mode: 'auto' })

    const response = await PATCH(request({
      channel: 'instagram',
      business_context: '',
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      missing: ['business_context'],
    })
    expect(database.updatePatch).toBeNull()
  })

  it('allows auto after both provider and business context are ready', async () => {
    configuration.instagram = true
    database.current = setting({ enabled: true, mode: 'draft' })

    const response = await PATCH(request({ channel: 'instagram', mode: 'auto' }))

    expect(response.status).toBe(200)
    expect(database.updatePatch).toEqual({ mode: 'auto' })
    expect(audit.log).toHaveBeenCalledOnce()
  })
})
