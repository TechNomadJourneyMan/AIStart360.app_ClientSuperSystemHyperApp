import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  getDevelopmentAdminConversation,
  listDevelopmentAdminInbox,
  persistDevelopmentManualReplySuccess,
  shouldUseDevelopmentAdminPostgres,
  updateDevelopmentAdminConversation,
  updateDevelopmentAdminSetting,
} from '@/lib/omnichannel/development-admin-postgres'

function queryable(
  handler: (sql: string, params: unknown[] | undefined) => Promise<{ rows: Record<string, unknown>[] }>,
) {
  return { query: vi.fn(handler) }
}

describe('development Giga Inbox PostgreSQL repository', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DATABASE_URL', 'postgres://local/example')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is enabled only for development with no service-role key and a database URL', () => {
    expect(shouldUseDevelopmentAdminPostgres({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://local/example',
      SUPABASE_SERVICE_ROLE_KEY: '   ',
    })).toBe(true)
    expect(shouldUseDevelopmentAdminPostgres({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://production/example',
    })).toBe(false)
    expect(shouldUseDevelopmentAdminPostgres({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://local/example',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-present',
    })).toBe(false)
    expect(shouldUseDevelopmentAdminPostgres({ NODE_ENV: 'development' })).toBe(false)
  })

  it('lists inbox rows and settings through parameterized SQL', async () => {
    const db = queryable(async (sql) => {
      if (sql.includes('list_omnichannel_inbox')) {
        return {
          rows: [{
            conversation: { id: 'conversation-1', channel: 'whatsapp' },
            contact: { id: 'contact-1', display_name: 'Марина' },
            last_message: { id: 'message-1', text: 'private text' },
          }],
        }
      }
      return {
        rows: [{
          channel: 'whatsapp',
          enabled: true,
          mode: 'auto',
          updated_at: new Date('2026-07-14T18:00:00.000Z'),
        }],
      }
    })

    const result = await listDevelopmentAdminInbox('whatsapp', 999, db as never)

    expect(result.conversations[0]).toMatchObject({
      id: 'conversation-1',
      contact: { id: 'contact-1' },
      last_message: { id: 'message-1' },
    })
    expect(result.settings[0].updated_at).toBe('2026-07-14T18:00:00.000Z')
    const inboxCall = db.query.mock.calls.find(([sql]) =>
      String(sql).includes('list_omnichannel_inbox'))
    expect(inboxCall?.[1]).toEqual(['whatsapp', 200])
    expect(inboxCall?.[0]).not.toContain('whatsapp')
    expect(inboxCall?.[0]).not.toContain('private text')
  })

  it('loads conversation detail in chronological order', async () => {
    const db = queryable(async (sql) => {
      if (sql.includes('FROM public.omnichannel_conversations')) {
        return {
          rows: [{
            id: '00000000-0000-0000-0000-000000000001',
            channel: 'whatsapp',
            contact_id: '00000000-0000-0000-0000-000000000002',
            external_id: 'chat-1',
          }],
        }
      }
      if (sql.includes('FROM public.omnichannel_contacts')) {
        return { rows: [{ id: 'contact-1', display_name: 'Марина' }] }
      }
      return {
        rows: [
          { id: 'newer', occurred_at: new Date('2026-07-14T18:01:00.000Z') },
          { id: 'older', occurred_at: new Date('2026-07-14T18:00:00.000Z') },
        ],
      }
    })

    const detail = await getDevelopmentAdminConversation(
      '00000000-0000-0000-0000-000000000001',
      db as never,
    )

    expect(detail?.conversation.contact).toMatchObject({ display_name: 'Марина' })
    expect(detail?.messages.map((message) => message.id)).toEqual(['older', 'newer'])
    expect(detail?.messages[0].occurred_at).toBe('2026-07-14T18:00:00.000Z')
  })

  it('updates only whitelisted conversation fields using bound parameters', async () => {
    const db = queryable(async () => ({
      rows: [{
        id: '00000000-0000-0000-0000-000000000001',
        status: 'needs_human',
        send_suppressed: true,
      }],
    }))

    await updateDevelopmentAdminConversation(
      '00000000-0000-0000-0000-000000000001',
      { status: 'needs_human', send_suppressed: true },
      db as never,
    )

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain("WHEN $7::boolean THEN 'admin_suppressed'")
    expect(sql).not.toContain('needs_human')
    expect(params).toEqual([
      '00000000-0000-0000-0000-000000000001',
      true,
      'needs_human',
      false,
      null,
      true,
      true,
    ])
  })

  it('preserves an explicit null business context through parameterized settings update', async () => {
    const db = queryable(async () => ({ rows: [{ channel: 'whatsapp' }] }))

    await updateDevelopmentAdminSetting(
      'whatsapp',
      { business_context: null, reply_delay_seconds: 5 },
      db as never,
    )

    expect(db.query.mock.calls[0][1]).toEqual([
      'whatsapp',
      false,
      null,
      false,
      null,
      true,
      null,
      false,
      null,
      true,
      5,
    ])
  })

  it('persists a provider-accepted manual reply in one transaction', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO public.omnichannel_messages')) {
        return { rows: [{ id: 'outbound-1' }] }
      }
      return { rows: [] }
    })
    const release = vi.fn()
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as Pick<Pool, 'connect'>

    await expect(persistDevelopmentManualReplySuccess({
      conversationId: '00000000-0000-0000-0000-000000000001',
      channel: 'whatsapp',
      externalMessageId: 'provider-out-1',
      text: 'Добрый день!',
      latestInboundId: '00000000-0000-0000-0000-000000000003',
      replyToExternalId: 'provider-in-1',
      metadata: { transport: 'whatsapp_web' },
    }, pool)).resolves.toBe('outbound-1')

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining("SET status = 'replied'"),
      expect.stringContaining('INSERT INTO public.omnichannel_messages'),
      'COMMIT',
    ])
    expect(release).toHaveBeenCalledOnce()
  })

  it('refuses every direct query outside the strict development gate', async () => {
    const db = queryable(async () => ({ rows: [] }))
    vi.stubEnv('NODE_ENV', 'production')

    await expect(listDevelopmentAdminInbox(null, 200, db as never))
      .rejects.toThrow('disabled')
    expect(db.query).not.toHaveBeenCalled()
  })
})
