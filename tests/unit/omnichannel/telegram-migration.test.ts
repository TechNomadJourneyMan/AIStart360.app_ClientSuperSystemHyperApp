import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')
const migration = read('124_omnichannel_telegram.sql')
const original = read('061_omnichannel_inbox.sql')

function claimBody(sql: string): string {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.claim_omnichannel_auto_send(p_message_id UUID)')
  const end = sql.indexOf('$$;', start)
  return sql.slice(start, end).replace(/\s+/g, ' ')
}

describe('124 omnichannel Telegram migration', () => {
  it('extends every channel CHECK with telegram', () => {
    for (const table of [
      'omnichannel_settings',
      'omnichannel_contacts',
      'omnichannel_conversations',
      'omnichannel_messages',
      'omnichannel_webhook_events',
    ]) {
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toContain("CHECK (channel IN (''instagram'', ''whatsapp'', ''telegram''))")
  })

  it('creates a service-only bot table with an encrypted token and a hashed secret', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.omnichannel_telegram_bots')
    expect(migration).toContain("token_ciphertext TEXT NOT NULL CHECK (token_ciphertext LIKE 'v1:%')")
    expect(migration).toContain("webhook_secret_hash TEXT NOT NULL CHECK (webhook_secret_hash ~ '^[a-f0-9]{64}$')")
    expect(migration).toContain('ALTER TABLE public.omnichannel_telegram_bots ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.omnichannel_telegram_bots FROM PUBLIC, anon, authenticated')
    expect(migration).not.toMatch(/GRANT[^;]*omnichannel_telegram_bots[^;]*(anon|authenticated)/)
  })

  it('seeds a disabled draft telegram settings row with the scenario off', () => {
    expect(migration).toMatch(/'telegram',\s*'draft',\s*FALSE/)
    expect(migration).toContain("'{equipment_sales_flow,enabled}', 'false'::jsonb")
    expect(migration).toContain('ON CONFLICT (channel) DO NOTHING')
  })

  it('changes the auto-send claim only by exempting telegram from the 24-hour bound', () => {
    const before = claimBody(original)
    const after = claimBody(migration)
    expect(after).toContain("v_message.channel <> 'telegram' AND v_message.occurred_at < now() - INTERVAL '24 hours'")
    const normalize = (body: string) => body
      .replace("OR ( v_message.channel <> 'telegram' AND v_message.occurred_at < now() - INTERVAL '24 hours' )", "OR v_message.occurred_at < now() - INTERVAL '24 hours'")
    expect(normalize(after)).toBe(before)
  })

  it('lets the equipment flow toggle accept telegram', () => {
    expect(migration).toContain("p_channel NOT IN ('instagram', 'whatsapp', 'telegram')")
  })
})
