import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({
  isGigaSuperAdmin: vi.fn(),
  getGigaActor: vi.fn(),
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn() }))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
const development = vi.hoisted(() => ({
  shouldUse: vi.fn(),
  listInbox: vi.fn(),
  getConversation: vi.fn(),
  updateConversation: vi.fn(),
  listSettings: vi.fn(),
  updateSetting: vi.fn(),
  setEquipment: vi.fn(),
  getManualContext: vi.fn(),
  reserveManual: vi.fn(),
  recordUnknown: vi.fn(),
  persistManual: vi.fn(),
}))
const transport = vi.hoisted(() => ({
  dispatch: vi.fn(),
  configured: vi.fn(),
  metadata: vi.fn(),
}))
const guardrails = vi.hoisted(() => ({ getSendWindow: vi.fn() }))
const repository = vi.hoisted(() => ({
  reserveManual: vi.fn(),
  logOutbound: vi.fn(),
}))

vi.mock('@/lib/admin/giga-actor', () => auth)
vi.mock('@/lib/audit', () => audit)
vi.mock('@/lib/supabase-service', () => service)
vi.mock('@/lib/omnichannel/development-admin-postgres', () => ({
  shouldUseDevelopmentAdminPostgres: development.shouldUse,
  listDevelopmentAdminInbox: development.listInbox,
  getDevelopmentAdminConversation: development.getConversation,
  updateDevelopmentAdminConversation: development.updateConversation,
  listDevelopmentAdminSettings: development.listSettings,
  updateDevelopmentAdminSetting: development.updateSetting,
  setDevelopmentEquipmentFlowEnabled: development.setEquipment,
  getDevelopmentManualReplyContext: development.getManualContext,
  reserveDevelopmentManualReply: development.reserveManual,
  recordDevelopmentManualReplyUnknown: development.recordUnknown,
  persistDevelopmentManualReplySuccess: development.persistManual,
}))
vi.mock('@/lib/omnichannel/meta-client', () => ({
  getMetaConfigurationHealth: () => ({ configured: true }),
}))
vi.mock('@/lib/omnichannel/guardrails', () => ({
  getSendWindow: guardrails.getSendWindow,
}))
vi.mock('@/lib/omnichannel/repository', () => ({
  reserveConversationForManualReply: repository.reserveManual,
  logOutboundMessage: repository.logOutbound,
}))
vi.mock('@/lib/omnichannel/transport-dispatch', () => ({
  dispatchOmnichannelReply: transport.dispatch,
  isConfiguredOmnichannelSender: transport.configured,
  outboundTransportMetadata: transport.metadata,
}))

import { GET as listConversations } from '@/app/api/giga-admin/omnichannel/conversations/route'
import {
  GET as getConversation,
  PATCH as patchConversation,
} from '@/app/api/giga-admin/omnichannel/conversations/[id]/route'
import {
  GET as getSettings,
  PATCH as patchSettings,
} from '@/app/api/giga-admin/omnichannel/settings/route'
import { POST as sendReply } from '@/app/api/giga-admin/omnichannel/conversations/[id]/reply/route'

const conversationId = '00000000-0000-0000-0000-000000000001'

function request(path: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('Giga Inbox development PostgreSQL route fallback', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    auth.isGigaSuperAdmin.mockResolvedValue(true)
    auth.getGigaActor.mockResolvedValue({ id: 'admin-1', kind: 'session' })
    audit.logAudit.mockResolvedValue(undefined)
    development.shouldUse.mockReturnValue(true)
    service.createServiceClient.mockImplementation(() => {
      throw new Error('service-role client must not be created in development fallback')
    })
  })

  it('lists imported conversations and settings without creating a Supabase client', async () => {
    development.listInbox.mockResolvedValue({
      conversations: [{ id: conversationId, channel: 'whatsapp' }],
      settings: [{ channel: 'whatsapp', mode: 'auto' }],
    })

    const response = await listConversations(request(
      '/api/giga-admin/omnichannel/conversations?channel=whatsapp',
    ))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      conversations: [{ id: conversationId }],
      settings: [{ channel: 'whatsapp' }],
    })
    expect(development.listInbox).toHaveBeenCalledWith('whatsapp', 200)
    expect(service.createServiceClient).not.toHaveBeenCalled()
  })

  it('loads conversation history and preserves the admin authorization guard', async () => {
    development.getConversation.mockResolvedValue({
      conversation: { id: conversationId, contact: { display_name: 'Марина' } },
      messages: [{ id: 'history-1', status: 'imported' }],
    })

    const response = await getConversation(
      request(`/api/giga-admin/omnichannel/conversations/${conversationId}`),
      { params: { id: conversationId } },
    )
    expect(response.status).toBe(200)
    expect((await response.json()).messages).toEqual([{ id: 'history-1', status: 'imported' }])

    auth.isGigaSuperAdmin.mockResolvedValueOnce(false)
    const forbidden = await getConversation(
      request(`/api/giga-admin/omnichannel/conversations/${conversationId}`),
      { params: { id: conversationId } },
    )
    expect(forbidden.status).toBe(403)
    expect(development.getConversation).toHaveBeenCalledOnce()
  })

  it('updates conversations and settings through the isolated repository', async () => {
    development.updateConversation.mockResolvedValue({
      id: conversationId,
      status: 'needs_human',
    })
    const conversationResponse = await patchConversation(
      request(
        `/api/giga-admin/omnichannel/conversations/${conversationId}`,
        'PATCH',
        { status: 'needs_human' },
      ),
      { params: { id: conversationId } },
    )
    expect(conversationResponse.status).toBe(200)
    expect(development.updateConversation).toHaveBeenCalledWith(
      conversationId,
      { status: 'needs_human' },
    )

    development.updateSetting.mockResolvedValue({ channel: 'whatsapp', reply_delay_seconds: 5 })
    const settingsResponse = await patchSettings(request(
      '/api/giga-admin/omnichannel/settings',
      'PATCH',
      { channel: 'whatsapp', reply_delay_seconds: 5 },
    ))
    expect(settingsResponse.status).toBe(200)
    expect(development.updateSetting).toHaveBeenCalledWith('whatsapp', {
      reply_delay_seconds: 5,
    })
    expect(development.listSettings).not.toHaveBeenCalled()
    expect(service.createServiceClient).not.toHaveBeenCalled()
  })

  it('loads settings through PostgreSQL while returning the same configuration shape', async () => {
    development.listSettings.mockResolvedValue([{ channel: 'whatsapp', enabled: true }])

    const response = await getSettings(request('/api/giga-admin/omnichannel/settings'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      settings: [{ channel: 'whatsapp', enabled: true }],
      configuration: { configured: true },
    })
  })

  it('sends and persists a manual reply without entering the Supabase path', async () => {
    development.getManualContext.mockResolvedValue({
      conversation: {
        id: conversationId,
        channel: 'whatsapp',
        account_external_id: 'waweb:primary',
        external_id: '77011234567@s.whatsapp.net',
        contact_id: '00000000-0000-0000-0000-000000000002',
        send_suppressed: false,
        suppression_reason: null,
      },
      contact: { external_id: '77011234567' },
      latestInbound: {
        id: '00000000-0000-0000-0000-000000000003',
        external_message_id: 'provider-in-1',
        occurred_at: '2026-07-14T18:00:00.000Z',
        metadata: {
          transport: 'whatsapp_web',
          providerTimestampTrusted: true,
        },
      },
    })
    development.reserveManual.mockResolvedValue({ reserved: true, reason: 'reserved' })
    development.persistManual.mockResolvedValue('outbound-1')
    guardrails.getSendWindow.mockReturnValue({
      allowed: true,
      mode: 'session',
      reason: 'inside_window',
    })
    transport.configured.mockReturnValue(true)
    transport.metadata.mockReturnValue({ transport: 'whatsapp_web' })
    transport.dispatch.mockResolvedValue({
      ok: true,
      externalMessageId: 'provider-out-1',
    })

    const response = await sendReply(
      request(
        `/api/giga-admin/omnichannel/conversations/${conversationId}/reply`,
        'POST',
        { text: 'Добрый день!' },
      ),
      { params: { id: conversationId } },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sent: true, persisted: true })
    expect(development.persistManual).toHaveBeenCalledWith(expect.objectContaining({
      externalMessageId: 'provider-out-1',
      latestInboundId: '00000000-0000-0000-0000-000000000003',
    }))
    expect(repository.reserveManual).not.toHaveBeenCalled()
    expect(service.createServiceClient).not.toHaveBeenCalled()
  })

  it('keeps production fail-closed instead of silently using direct SQL', async () => {
    development.shouldUse.mockReturnValue(false)

    await expect(listConversations(request('/api/giga-admin/omnichannel/conversations')))
      .rejects.toThrow('service-role client must not be created')
    expect(development.listInbox).not.toHaveBeenCalled()
  })
})
