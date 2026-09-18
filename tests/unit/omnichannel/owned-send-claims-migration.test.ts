import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/070_omnichannel_owned_send_claims.sql'),
  'utf8',
)

describe('070 owned Meta send claims migration', () => {
  it('fences standard and equipment sends by one execution owner', () => {
    expect(migration).toContain('claim_omnichannel_auto_send_owned(')
    expect(migration).toContain('claim_omnichannel_equipment_flow_send_owned(')
    expect(migration).toContain("metadata ->> 'sendClaimOwner'")
    expect(migration).toContain("'send_claim_owned_by_other_worker'")
    expect(migration).toContain("'send_claim_already_acquired'")
    expect(migration).toContain("'{sendClaimOwner}'")
  })

  it('keeps the original policy claims as the authorization source', () => {
    expect(migration).toContain('FROM public.claim_omnichannel_auto_send(p_message_id)')
    expect(migration).toContain(
      'FROM public.claim_omnichannel_equipment_flow_send(',
    )
  })

  it('revokes legacy unfenced claims during rolling deployments', () => {
    expect(migration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.claim_omnichannel_auto_send(UUID)',
    )
    expect(migration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.claim_omnichannel_equipment_flow_send(',
    )
    expect(migration).toContain(
      'FROM service_role, aistart360_omnichannel_runtime',
    )
  })

  it('selects one latest pending WhatsApp history row per conversation', () => {
    expect(migration).toContain(
      'list_omnichannel_whatsapp_history_for_draft',
    )
    expect(migration).toContain('DISTINCT ON (m.conversation_id)')
    expect(migration).toContain("m.status = 'imported'")
    expect(migration).toContain("m.ai_draft IS NULL")
  })
})
