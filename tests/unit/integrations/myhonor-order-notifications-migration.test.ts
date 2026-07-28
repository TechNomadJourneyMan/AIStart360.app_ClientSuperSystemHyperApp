import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/073_myhonor_order_notifications.sql'),
  'utf8',
)

describe('073 myhonor order notification migration', () => {
  it('enforces a unique idempotency key and canonical request hash', () => {
    expect(migration).toContain('idempotency_key TEXT NOT NULL UNIQUE')
    expect(migration).toContain('request_hash TEXT NOT NULL')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('v_existing.request_hash <> p_request_hash')
    expect(migration).toContain('event_id = idempotency_key')
  })

  it('keeps the table RPC-only and grants only the exact transitions', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.myhonor_order_notifications\s+FROM PUBLIC, anon, authenticated, service_role;/,
    )
    expect(migration).not.toMatch(
      /CREATE POLICY[^;]+ON public\.myhonor_order_notifications/,
    )
    for (const transition of [
      'enqueue_myhonor_order_notification',
      'claim_myhonor_order_notification',
      'authorize_myhonor_order_notification',
      'finish_myhonor_order_notification',
      'apply_myhonor_order_notification_delivery_status',
    ]) {
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${transition}`)
    }
  })

  it('never requeues an interrupted authorized provider call', () => {
    expect(migration).toMatch(
      /v_row\.state = 'authorized'[\s\S]*?state = 'delivery_unknown'/,
    )
    expect(migration).toContain("last_error_code = 'authorized_workflow_replayed'")
    expect(migration).toContain("last_error_code = 'authorized_lease_expired'")
  })

  it('allows bounded retries only for an explicit failed provider response', () => {
    expect(migration).toMatch(
      /p_outcome = 'failed'[\s\S]*?p_retryable[\s\S]*?v_row\.state = 'authorized'[\s\S]*?v_next_state := 'queued'/,
    )
    expect(migration).toMatch(
      /p_outcome IN \('accepted', 'delivery_unknown'\)[\s\S]*?v_row\.state <> 'authorized'/,
    )
  })

  it('records Meta delivery statuses without exposing the table', () => {
    expect(migration).toContain(
      'apply_myhonor_order_notification_delivery_status',
    )
    expect(migration).toContain("p_status NOT IN ('sent', 'delivered', 'read', 'failed')")
    expect(migration).toContain('provider_message_id = btrim(p_provider_message_id)')
  })
})
