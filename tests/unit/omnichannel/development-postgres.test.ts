import { describe, expect, it, vi } from 'vitest'
import {
  claimEquipmentFlowForAutoSendViaPostgres,
  claimMessageForAutoSendViaPostgres,
  getMessageContextViaPostgres,
  listImportedWhatsAppHistoryForDraftViaPostgres,
  logOutboundMessageViaPostgres,
  markMessageOutcomeViaPostgres,
  shouldUseDevelopmentPostgres,
} from '@/lib/omnichannel/development-postgres'

function databaseReturning(rows: Record<string, unknown>[]) {
  return {
    query: vi.fn(async (_sql: string, _params?: unknown[]) => ({
      rows,
      rowCount: rows.length,
    })),
  }
}

describe('development omnichannel Postgres fallback', () => {
  it('is enabled only in development when the service key is absent and DATABASE_URL exists', () => {
    expect(shouldUseDevelopmentPostgres({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://local/example',
      SUPABASE_SERVICE_ROLE_KEY: '',
    })).toBe(true)
    expect(shouldUseDevelopmentPostgres({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://production/example',
    })).toBe(false)
    expect(shouldUseDevelopmentPostgres({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://local/example',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-present',
    })).toBe(false)
    expect(shouldUseDevelopmentPostgres({
      NODE_ENV: 'development',
    })).toBe(false)
  })

  it('invokes both auto-send guards through SQL SELECT and maps their result', async () => {
    const standard = databaseReturning([{ claimed: true, reason: 'claimed' }])
    await expect(claimMessageForAutoSendViaPostgres(
      '00000000-0000-0000-0000-000000000001',
      'database-job:1:lease-1',
      standard as never,
    )).resolves.toEqual({ claimed: true, reason: 'claimed' })
    expect(standard.query.mock.calls[0][0]).toContain(
      'FROM public.claim_omnichannel_auto_send_owned($1::uuid, $2::text)',
    )

    const equipment = databaseReturning([{
      claimed: false,
      reason: 'equipment_flow_settings_changed',
    }])
    await expect(claimEquipmentFlowForAutoSendViaPostgres(
      '00000000-0000-0000-0000-000000000001',
      '2026-07-14T20:00:00.000Z',
      'database-job:1:lease-1',
      equipment as never,
    )).resolves.toEqual({
      claimed: false,
      reason: 'equipment_flow_settings_changed',
    })
    expect(equipment.query.mock.calls[0][0]).toContain(
      'FROM public.claim_omnichannel_equipment_flow_send_owned',
    )
  })

  it('preserves the exact settings timestamp used by the equipment-flow claim', async () => {
    const message = {
      id: '00000000-0000-0000-0000-000000000001',
      conversation_id: '00000000-0000-0000-0000-000000000002',
      channel: 'whatsapp',
      external_message_id: 'wa-in-1',
      direction: 'in',
      message_type: 'text',
      text: 'Хочу в клуб',
      status: 'received',
      metadata: {},
      occurred_at: new Date('2026-07-14T20:00:00.000Z'),
      created_at: new Date('2026-07-14T20:00:00.000Z'),
    }
    const conversation = {
      id: message.conversation_id,
      channel: 'whatsapp',
      account_external_id: 'waweb:primary',
      external_id: '77000000000@s.whatsapp.net',
      contact_id: '00000000-0000-0000-0000-000000000003',
      status: 'open',
      metadata: {},
    }
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [message], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [conversation], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        id: conversation.contact_id,
        channel: 'whatsapp',
        external_id: '77000000000',
        metadata: {},
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        channel: 'whatsapp',
        mode: 'auto',
        enabled: true,
        automation_config: {},
        confidence_threshold: '0.750',
        reply_delay_seconds: 5,
        updated_at: new Date('2026-07-14T20:00:00.123Z'),
        updated_at_precise: '2026-07-14 20:00:00.123456+00',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [message], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: message.id }], rowCount: 1 })

    const context = await getMessageContextViaPostgres(message.id, { query } as never)

    expect(context?.settings.updatedAt).toBe('2026-07-14 20:00:00.123456+00')
    expect(query.mock.calls[3][0]).toContain('s.updated_at::text AS updated_at_precise')
  })

  it('persists outcomes without clearing draft fields that were not supplied', async () => {
    const db = databaseReturning([])
    await markMessageOutcomeViaPostgres(
      '00000000-0000-0000-0000-000000000001',
      'replied',
      { reason: 'safe_auto_reply' },
      db as never,
    )

    expect(db.query).toHaveBeenCalledOnce()
    expect(db.query.mock.calls[0][1]).toEqual([
      '00000000-0000-0000-0000-000000000001',
      'replied',
      'safe_auto_reply',
      false,
      null,
      false,
      null,
    ])
  })

  it('lists only a bounded batch of imported QR history using bound filters', async () => {
    const db = databaseReturning([{
      id: '00000000-0000-0000-0000-000000000001',
      conversation_id: '00000000-0000-0000-0000-000000000002',
    }])

    await expect(listImportedWhatsAppHistoryForDraftViaPostgres(
      500,
      db as never,
    )).resolves.toEqual([{
      messageId: '00000000-0000-0000-0000-000000000001',
      conversationId: '00000000-0000-0000-0000-000000000002',
    }])

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain("channel = 'whatsapp'")
    expect(sql).toContain("direction = 'in'")
    expect(sql).toContain("status = 'imported'")
    expect(sql).toContain('ai_draft IS NULL')
    expect(sql).toContain('metadata @> $1::jsonb')
    expect(sql).toContain('DISTINCT ON (conversation_id)')
    expect(params).toEqual([
      JSON.stringify({ transport: 'whatsapp_web', catchUp: true }),
      100,
    ])
  })

  it('logs provider output idempotently and preserves terminal delivery states', async () => {
    const db = databaseReturning([{ id: '00000000-0000-0000-0000-000000000099' }])
    const id = await logOutboundMessageViaPostgres({
      conversationId: '00000000-0000-0000-0000-000000000002',
      channel: 'whatsapp',
      externalMessageId: 'provider-out-1',
      text: 'Добрый день!',
      aiGenerated: true,
      status: 'sent',
      metadata: { transport: 'whatsapp_web' },
      occurredAt: '2026-07-14T20:00:00.000Z',
    }, db as never)

    expect(id).toBe('00000000-0000-0000-0000-000000000099')
    expect(db.query.mock.calls[0][0]).toContain(
      'ON CONFLICT (channel, external_message_id) DO UPDATE',
    )
    expect(db.query.mock.calls[0][0]).toContain(
      "omnichannel_messages.status IN ('delivered', 'read', 'failed')",
    )
  })
})
