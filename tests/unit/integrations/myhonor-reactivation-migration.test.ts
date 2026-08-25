import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/090_myhonor_reactivation_campaigns.sql'),
  'utf8',
)

function rpc(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = migration.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${escaped}\\([\\s\\S]*?\\n\\$\\$;`,
  ))
  if (!match) throw new Error(`RPC ${name} is missing from migration 090`)
  return match[0]
}

function view(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = migration.match(new RegExp(
    `CREATE OR REPLACE VIEW public\\.${escaped} AS[\\s\\S]*?;`,
  ))
  if (!match) throw new Error(`View ${name} is missing from migration 090`)
  return match[0]
}

describe('090 myhonor reactivation campaign migration', () => {
  it('keeps every reactivation table behind RLS and RPC-only privileges', () => {
    for (const table of [
      'contacts',
      'profiles',
      'contact_ingest_events',
      'consent_events',
      'suppression_events',
      'campaigns',
      'recipients',
      'provider_attempts',
      'audit_events',
      'attributions',
    ]) {
      const name = `myhonor_reactivation_${table}`
      expect(migration).toContain(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;`)
      expect(migration).toMatch(new RegExp(
        `REVOKE ALL ON TABLE public\\.${name}\\s+FROM PUBLIC, anon, authenticated, service_role;`,
      ))
      expect(migration).not.toMatch(new RegExp(`CREATE POLICY[^;]+ON public\\.${name}`))
    }
  })

  it('stores encrypted contact identity and never defines plaintext phone/name/city fields', () => {
    expect(migration).toContain('phone_hash TEXT NOT NULL')
    expect(migration).toContain('phone_ciphertext TEXT NOT NULL')
    expect(migration).toContain('first_name_ciphertext TEXT')
    expect(migration).toContain('city_ciphertext TEXT')
    expect(migration).not.toMatch(/\n\s+(phone|phone_e164|first_name|city)\s+TEXT\b/)
    expect(rpc('record_myhonor_reactivation_attribution')).toContain(
      'myhonor_reactivation_jsonb_contains_pii(p_details)',
    )
  })

  it('makes consent, suppression, ingest, audit and attribution ledgers append-only', () => {
    for (const trigger of [
      'contact_ingest_immutable',
      'consent_immutable',
      'suppression_immutable',
      'audit_immutable',
      'attribution_immutable',
    ]) {
      expect(migration).toMatch(new RegExp(
        `CREATE TRIGGER myhonor_reactivation_${trigger}[\\s\\S]*?BEFORE UPDATE OR DELETE`,
      ))
    }
    expect(migration).toContain('CREATE OR REPLACE VIEW public.myhonor_reactivation_effective_consent')
    expect(migration).toContain('CREATE OR REPLACE VIEW public.myhonor_reactivation_effective_suppressions')
  })

  it('uses a monotonic Store source version for profile and consent ordering', () => {
    const ingest = rpc('ingest_myhonor_reactivation_contact_event')
    const consent = view('myhonor_reactivation_effective_consent')
    const suppressions = view('myhonor_reactivation_effective_suppressions')

    expect(ingest).toMatch(
      /p_event_hash TEXT,\s+p_source_version BIGINT,\s+p_occurred_at TIMESTAMPTZ/,
    )
    expect(ingest).toContain('p_source_version IS NULL OR p_source_version <= 0')
    for (const table of [
      'contacts',
      'profiles',
      'contact_ingest_events',
      'consent_events',
    ]) {
      expect(migration).toMatch(new RegExp(
        `CREATE TABLE IF NOT EXISTS public\\.myhonor_reactivation_${table} \\([\\s\\S]*?source_version BIGINT NOT NULL CHECK \\(source_version > 0\\)`,
      ))
    }
    expect(migration).toContain(
      'UNIQUE (user_id, company_id, source, contact_id, source_version)',
    )
    expect(ingest).toContain('v_existing_event.source_version = p_source_version')
    expect(ingest).toContain('ingest.source_version = p_source_version')
    expect(ingest).toContain('v_existing_version.event_hash = p_event_hash')
    expect(ingest).toContain('p_source_version > v_contact.source_version')
    expect(ingest).toMatch(
      /WHERE public\.myhonor_reactivation_profiles\.source_version\s+< EXCLUDED\.source_version/,
    )
    expect(ingest).toContain("v_result := 'stale_profile'")
    expect(ingest).toContain('evidence_hash, source_version, occurred_at')
    expect(ingest).toMatch(
      /IF v_source_applied THEN[\s\S]*?FROM public\.myhonor_reactivation_campaigns AS campaign[\s\S]*?NOT EXISTS \([\s\S]*?myhonor_reactivation_effective_consent[\s\S]*?consent\.purpose = campaign\.purpose[\s\S]*?consent\.eligible/,
    )
    expect(consent).toContain('ORDER BY event.source_version DESC')
    expect(suppressions).toContain('ORDER BY event.source_version DESC NULLS LAST')
    expect(suppressions).toContain('event.occurred_at DESC')
    expect(migration).toMatch(
      /reason = 'consent_revoked' AND source_version IS NOT NULL/,
    )
    expect(migration).toMatch(
      /reason <> 'consent_revoked' AND source_version IS NULL/,
    )
    expect(migration).toContain(
      'UUID, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, JSONB, JSONB, JSONB',
    )
  })

  it('treats each newest Store consent event as a complete purpose snapshot', () => {
    const consent = view('myhonor_reactivation_effective_consent')
    const ingest = rpc('ingest_myhonor_reactivation_contact_event')
    expect(consent).toMatch(
      /PARTITION BY event\.user_id, event\.company_id, event\.contact_id\s+ORDER BY event\.source_version DESC/,
    )
    expect(consent).toContain('CROSS JOIN purpose_catalog')
    expect(consent).toMatch(
      /event\.status = 'granted'[\s\S]*?purpose_catalog\.purpose = ANY\(event\.purposes\)[\s\S]*?THEN 'granted'[\s\S]*?ELSE 'revoked'/,
    )
    expect(consent).toContain('ELSE COALESCE(event.revoked_at, event.occurred_at)')
    expect(consent).not.toContain("WHERE event.status = 'revoked'")
    expect(ingest).toContain("last_error_code = CASE WHEN v_consent_status = 'revoked'")
    expect(ingest).toContain("THEN 'consent_revoked' ELSE 'consent_purpose_withdrawn' END")
    expect(ingest).toContain("state IN ('preview', 'queued', 'leased')")
    expect(ingest).toContain("ELSE 'source_snapshot_changed'")
  })

  it('merges identity only through immutable external identity, never phone alone', () => {
    const ingest = rpc('ingest_myhonor_reactivation_contact_event')
    expect(ingest).toContain('v_external_contact_id UUID')
    expect(ingest).toContain('v_phone_contact_id UUID')
    expect(ingest).toContain(
      "candidate.external_customer_hash =\n       p_encrypted_contact->>'external_customer_hash'",
    )
    expect(ingest).toContain("candidate.phone_hash = p_encrypted_contact->>'phone_hash'")
    expect(ingest).toContain(
      'v_external_contact_id IS NULL AND v_phone_contact_id IS NOT NULL',
    )
    expect(ingest).toContain('v_external_contact_id <> v_phone_contact_id')
    expect(ingest).toMatch(
      /UPDATE public\.myhonor_reactivation_contacts[\s\S]*?SET phone_hash =[\s\S]*?WHERE id = v_contact\.id/,
    )
    expect(ingest).not.toMatch(
      /UPDATE public\.myhonor_reactivation_contacts[\s\S]*?SET external_customer_hash =/,
    )
  })

  it('accepts only PII-safe machine event identifiers', () => {
    const safeEventId = /^(myhonor|whatsapp|meta-wa)(:[a-z][a-z0-9-]{0,39})?:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$/
    const sqlPattern = safeEventId.source.replaceAll('\\', '')
    expect(migration).toContain(`event_id ~ '${sqlPattern}'`)
    expect(migration).toContain(`source_event_id ~ '${sqlPattern}'`)
    for (const [name, parameter] of [
      ['ingest_myhonor_reactivation_contact_event', 'p_event_id'],
      ['record_myhonor_reactivation_suppression', 'p_source_event_id'],
      ['record_myhonor_reactivation_attribution', 'p_event_id'],
      ['apply_myhonor_reactivation_inbound_signal', 'p_event_id'],
    ] as const) {
      expect(rpc(name)).toContain(`${parameter} !~ '${sqlPattern}'`)
    }
    expect(safeEventId.test('myhonor:preview:00000000-0000-4000-8000-000000000001')).toBe(true)
    expect(safeEventId.test(`meta-wa:${'a'.repeat(64)}`)).toBe(true)
    expect(safeEventId.test('+10000000000')).toBe(false)
    expect(safeEventId.test('person@example.test')).toBe(false)
    expect(safeEventId.test('myhonor:Person:00000000-0000-4000-8000-000000000001')).toBe(false)
    expect(migration).toContain("v_source_event_id := 'whatsapp:inbound:'")
    expect(migration).toContain("v_reply_event_id := 'whatsapp:reply:'")
    expect(migration).toContain("v_unsubscribe_event_id := 'whatsapp:unsubscribe:'")
  })

  it('declares every claim result column once', () => {
    const claim = rpc('claim_myhonor_reactivation_recipient')
    const returns = claim.match(/RETURNS TABLE \(([\s\S]*?)\)\nLANGUAGE/)
    expect(returns).not.toBeNull()
    const names = [...(returns?.[1] ?? '').matchAll(/^\s*([a-z_][a-z0-9_]*)\s+[A-Z]/gmi)]
      .map((match) => match[1])
    expect(names).toContain('locale')
    expect(names).toEqual([...new Set(names)])
    expect(claim).toMatch(
      /template_parameters_ciphertext TEXT,\s+template_parameters_hash TEXT,\s+recommendation_snapshot JSONB/,
    )
    expect(claim).toMatch(
      /v_recipient\.template_parameters_ciphertext,\s+v_recipient\.template_parameters_hash,\s+v_recipient\.recommendation_snapshot/,
    )
  })

  it('gates approval and launch on the DB-owned immutable preview hash', () => {
    const create = rpc('create_myhonor_reactivation_campaign')
    const materialize = rpc('materialize_myhonor_reactivation_campaign')
    const transition = rpc('transition_myhonor_reactivation_campaign')
    const protectCampaign = rpc('myhonor_reactivation_protect_campaign_definition')
    expect(migration).toContain('template_contract_hash TEXT CHECK')
    expect(migration).toContain(
      'CONSTRAINT myhonor_reactivation_campaign_template_contract_shape CHECK',
    )
    expect(create).not.toContain("p_definition->>'template_contract_hash'")
    expect(materialize).toMatch(
      /p_actor_hash TEXT,\s+p_template_contract_hash TEXT DEFAULT NULL/,
    )
    expect(materialize).toContain("p_template_contract_hash !~ '^[a-f0-9]{64}$'")
    expect(materialize).toContain('SET template_contract_hash = p_template_contract_hash')
    expect(materialize).toContain('template contract is immutable after preview')
    expect(materialize).toContain("'recipients', COALESCE((")
    expect(materialize).toContain(
      "'template_contract_hash', v_campaign.template_contract_hash",
    )
    expect(materialize).toContain('ORDER BY recipient.contact_id')
    expect(materialize).toContain('SET preview_snapshot_hash = v_preview_snapshot_hash')
    expect(materialize).toContain('candidate snapshot hash mismatch')
    for (const boundField of [
      'phone_hash_snapshot',
      'locale_snapshot',
      'contact_source_version_snapshot',
      'profile_source_version_snapshot',
      'consent_source_version_snapshot',
      'template_parameters_hash',
    ]) expect(materialize).toContain(`'${boundField}', recipient.${boundField}`)
    expect(materialize).toContain("v_candidate->>'template_parameters_hash' !~ '^[a-f0-9]{64}$'")
    expect(protectCampaign).toMatch(
      /OLD\.preview_snapshot_hash IS NOT NULL[\s\S]*?NEW\.template_contract_hash IS DISTINCT FROM OLD\.template_contract_hash/,
    )
    expect(materialize).toMatch(
      /SELECT \* INTO v_campaign[\s\S]*?FOR UPDATE;[\s\S]*?DELETE FROM public\.myhonor_reactivation_recipients[\s\S]*?WHERE campaign_id = v_campaign\.id;/,
    )
    expect(transition).toContain("'preview_hash_mismatch'")
    expect(transition).toContain("'approval_hash_mismatch'")
    expect(transition).toMatch(
      /p_approval_snapshot_hash TEXT DEFAULT NULL,\s+p_template_contract_hash TEXT DEFAULT NULL/,
    )
    expect(transition).toContain("'template_contract_hash_mismatch'")
    expect(transition).toContain(
      'p_template_contract_hash <> v_campaign.template_contract_hash',
    )
    expect(transition).toMatch(
      /p_approval_snapshot_hash <> v_campaign\.approval_snapshot_hash[\s\S]*?p_approval_snapshot_hash <> v_campaign\.preview_snapshot_hash/,
    )
    expect(transition).toContain("'another_campaign_running'")
    expect(transition).toContain("':myhonor-reactivation-running'")
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_myhonor_reactivation_one_running_campaign[\s\S]*?WHERE state = 'running';/,
    )
    expect(migration).toContain(
      'UUID, JSONB, TEXT, TEXT\n) TO service_role;',
    )
    expect(migration).toContain(
      'UUID, TEXT, TEXT, TEXT, TEXT\n) TO service_role;',
    )
  })

  it('proves candidate completeness instead of silently approving a limited subset', () => {
    const candidates = rpc('list_myhonor_reactivation_candidate_context')
    expect(candidates).toContain('total_count BIGINT')
    expect(candidates).toContain('count(*) OVER ()')
    expect(candidates).toContain('p_limit NOT BETWEEN 1 AND 5000')
  })

  it('persists and rechecks explicit lifecycle holds and 24-hour source freshness', () => {
    const ingest = rpc('ingest_myhonor_reactivation_contact_event')
    const candidates = rpc('list_myhonor_reactivation_candidate_context')
    const materialize = rpc('materialize_myhonor_reactivation_campaign')
    const authorize = rpc('authorize_myhonor_reactivation_recipient')

    expect(migration).toContain('marketing_hold BOOLEAN NOT NULL DEFAULT FALSE')
    expect(migration).toContain('myhonor_reactivation_profile_marketing_hold_shape')
    for (const reason of [
      'open_order',
      'recent_cancel_or_return',
      'payment_unknown',
      'source_incomplete',
      'identity_conflict',
      'manual_review',
    ]) expect(migration).toContain(`'${reason}'`)

    expect(ingest).toMatch(
      /'unresolved_complaint',\s+'marketing_hold', 'marketing_hold_reason'/,
    )
    expect(ingest).toContain("jsonb_typeof(p_lifecycle->'marketing_hold') <> 'boolean'")
    expect(ingest).toContain('marketing_hold = EXCLUDED.marketing_hold')
    expect(ingest).toContain('marketing_hold_reason = EXCLUDED.marketing_hold_reason')
    expect(ingest).toContain("'marketing_hold_reason', p_lifecycle->'marketing_hold_reason'")

    expect(candidates).toMatch(
      /unresolved_complaint BOOLEAN,\s+source_updated_at TIMESTAMPTZ,\s+marketing_hold BOOLEAN,\s+marketing_hold_reason TEXT,/,
    )
    expect(candidates).toMatch(
      /profile\.unresolved_complaint,\s+LEAST\(contact\.source_updated_at, profile\.source_updated_at\),\s+profile\.marketing_hold,\s+profile\.marketing_hold_reason,/,
    )
    expect(candidates).not.toContain(
      'GREATEST(contact.source_updated_at, profile.source_updated_at)',
    )
    expect(candidates).toMatch(
      /profile\.marketing_hold\s+OR COALESCE\([\s\S]*?suppression\.active_reasons[\s\S]*?ARRAY\['manual', 'legal', 'unresolved_complaint'\]/,
    )

    for (const body of [materialize, authorize]) {
      expect(body).toContain("interval '24 hours'")
      expect(body).toContain("'source_snapshot_stale'")
      expect(body).toContain("'manual_hold'")
      expect(body).toContain('v_profile.marketing_hold')
      expect(body).toContain('v_profile.source_updated_at')
      expect(body).toContain('v_contact.source_updated_at')
    }
    expect(materialize).toContain("v_exclusion := 'source_snapshot_stale'")
    expect(authorize).toContain("v_terminal_reason := 'source_snapshot_stale'")
    expect(authorize).toContain("v_terminal_reason := 'manual_hold'")
  })

  it('exposes a scoped masked recipient preview and accepted-only inbound context', () => {
    const previews = rpc('list_myhonor_reactivation_recipient_previews')
    expect(previews).toContain('phone_masked TEXT')
    expect(previews).not.toContain('phone_ciphertext')
    expect(previews).toContain('template_parameters_ciphertext TEXT')
    expect(previews).toMatch(
      /template_parameters_ciphertext TEXT,\s+template_parameters_hash TEXT,\s+run_at TIMESTAMPTZ/,
    )
    expect(previews).toMatch(
      /recipient\.template_parameters_ciphertext,\s+recipient\.template_parameters_hash,\s+recipient\.run_at/,
    )
    expect(previews).toContain('recipient.user_id = p_user_id')
    expect(previews).toContain('recipient.company_id = btrim(p_company_id)')
    expect(previews).toContain('recipient.campaign_id = p_campaign_id')
    expect(previews).toContain('LIMIT p_limit OFFSET p_offset')

    const context = rpc('get_myhonor_reactivation_outbound_context')
    expect(context).toContain(
      "recipient.state IN ('accepted', 'sent', 'delivered', 'read')",
    )
    expect(context).toContain('recipient.provider_message_id IS NOT NULL')
    expect(context).not.toContain('phone_ciphertext')
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.list_myhonor_reactivation_recipient_previews',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_myhonor_reactivation_outbound_context',
    )
  })

  it('lists work only for the requested running campaign and exposes retry time', () => {
    const listReady = rpc('list_ready_myhonor_reactivation_recipients')
    expect(listReady).toContain('p_campaign_id UUID')
    expect(listReady).toContain('RETURNS TABLE (recipient_id UUID, run_at TIMESTAMPTZ)')
    expect(listReady).toContain('recipient.campaign_id = p_campaign_id')
    expect(listReady).toContain("campaign.state = 'running'")
    expect(listReady).toContain("recipient.state IN ('leased', 'authorized')")
    expect(listReady).toContain('recipient.lease_until <= clock_timestamp()')
  })

  it('returns stored preview and approval hashes so approved campaigns survive refresh', () => {
    const campaigns = rpc('list_myhonor_reactivation_campaigns')
    expect(campaigns).toMatch(
      /holdout_count INTEGER,\s+preview_snapshot_hash TEXT,\s+approval_snapshot_hash TEXT,\s+template_contract_hash TEXT/,
    )
    expect(campaigns).toContain('campaign.preview_snapshot_hash')
    expect(campaigns).toContain('campaign.approval_snapshot_hash')
    expect(campaigns).toContain('campaign.template_contract_hash')
    expect(rpc('get_myhonor_reactivation_campaign_definition')).toContain(
      "'template_contract_hash', v_campaign.template_contract_hash",
    )
  })

  it('rechecks consent, suppression, frequency, quiet hours and daily limits at authorization', () => {
    const authorize = rpc('authorize_myhonor_reactivation_recipient')
    for (const invariant of [
      'myhonor_reactivation_effective_consent',
      'myhonor_reactivation_effective_suppressions',
      "v_terminal_reason := 'frequency_cap'",
      "v_terminal_reason := 'monthly_frequency_cap'",
      "v_requeue_reason := 'quiet_hours'",
      "v_requeue_reason := 'daily_limit'",
      'myhonor_reactivation_next_allowed_send_at',
      ':myhonor-reactivation-contact',
      'attempts = GREATEST(attempts - 1, 0)',
      'v_recipient.contact_source_version_snapshot',
      'v_recipient.profile_source_version_snapshot',
      'v_recipient.consent_source_version_snapshot',
      "v_terminal_reason := 'source_snapshot_changed'",
    ]) expect(authorize).toContain(invariant)
    expect(authorize).toContain('next_run_at TIMESTAMPTZ')
  })

  it('fails closed on current product, variant, exact price and latest published net stock', () => {
    const live = rpc('myhonor_reactivation_recommendation_is_live')
    expect(live).toContain('product.catalog_active')
    expect(live).toContain("product.availability = 'in_stock'")
    expect(live).toContain("product.currency = 'KZT'")
    expect(live).toContain("product.catalog_synced_at >= now() - interval '168 hours'")
    expect(live).toContain('variant.is_active')
    expect(live).toContain("run.status = 'published'")
    expect(live).toContain("run.import_kind = 'prices'")
    expect(live).toContain("run.import_kind = 'inventory'")
    expect(live.match(/run\.published_at IS NOT NULL/g)).toHaveLength(2)
    expect(live).toContain("v_latest_price_published_at < now() - interval '48 hours'")
    expect(live).toContain("v_latest_price_published_at > now() + interval '5 minutes'")
    expect(live).toContain("v_latest_inventory_published_at < now() - interval '48 hours'")
    expect(live).toContain("v_latest_inventory_published_at > now() + interval '5 minutes'")
    expect(live).toContain('price.import_run_id = v_latest_price_run_id')
    expect(live).toContain('inventory.import_run_id = v_latest_inventory_run_id')
    expect(live).toMatch(
      /SELECT run\.id, run\.published_at[\s\S]*?INTO v_latest_price_run_id, v_latest_price_published_at[\s\S]*?run\.import_kind = 'prices'[\s\S]*?ORDER BY run\.published_at DESC NULLS LAST, run\.created_at DESC, run\.id DESC[\s\S]*?LIMIT 1/,
    )
    expect(live).toContain('inventory.quantity_available - inventory.quantity_reserved')
    expect(live).toMatch(
      /SELECT run\.id, run\.published_at[\s\S]*?run\.import_kind = 'inventory'[\s\S]*?ORDER BY run\.published_at DESC NULLS LAST, run\.created_at DESC, run\.id DESC[\s\S]*?LIMIT 1/,
    )
    expect(live).not.toContain('ORDER BY inventory_run.published_at')
    expect(live).toContain("product.url = v_item->>'canonicalUrl'")
    expect(live).toMatch(/COALESCE\(\([\s\S]*?price\.retail_price[\s\S]*?\), product\.price\)\s*=\s*\(v_item->>'priceKzt'\)::NUMERIC/)
  })

  it('allows abandoned-cart campaigns only for products still present in an active cart', () => {
    expect(migration).toContain("'back_in_stock', 'abandoned_cart'")
    for (const name of [
      'materialize_myhonor_reactivation_campaign',
      'authorize_myhonor_reactivation_recipient',
    ]) {
      const body = rpc(name)
      expect(body).toContain("v_campaign.segment = 'abandoned_cart'")
      expect(body).toContain("v_profile.abandoned_cart->>'active'")
      expect(body).toContain("v_profile.abandoned_cart->'product_ids' ? product_id")
    }
  })

  it('never retries across an uncertain provider boundary', () => {
    const claim = rpc('claim_myhonor_reactivation_recipient')
    const finish = rpc('finish_myhonor_reactivation_recipient')
    expect(claim).toContain("state = 'delivery_unknown'")
    expect(claim).toContain("last_error_code = 'authorized_workflow_replayed'")
    expect(claim).toContain("last_error_code = 'authorized_lease_expired'")
    expect(finish).toMatch(
      /p_outcome = 'delivery_unknown'[\s\S]*?SET state = 'delivery_unknown'/,
    )
    expect(finish).toContain("COALESCE(p_error_code, '') ~ '(^|[.:])131049$'")
  })

  it('returns the approved template contract hash with every recipient claim', () => {
    const claim = rpc('claim_myhonor_reactivation_recipient')
    expect(claim).toContain('template_contract_hash TEXT')
    expect(claim).toContain('v_campaign.template_contract_hash')
  })

  it('atomically applies inbound replies and STOP by scoped phone hash', () => {
    const inbound = rpc('apply_myhonor_reactivation_inbound_signal')
    expect(inbound).toContain("p_phone_hash !~ '^[a-f0-9]{64}$'")
    expect(inbound).toContain("'whatsapp_opt_out'")
    expect(inbound).toContain("'reply'")
    expect(inbound).toContain("'unsubscribe'")
    expect(inbound).toContain("recipient.state IN ('accepted', 'sent', 'delivered', 'read')")
    expect(inbound).toContain("p_occurred_at - interval '30 days'")
    expect(inbound).toContain('RETURN QUERY SELECT FALSE, NULL::UUID, FALSE')
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.apply_myhonor_reactivation_inbound_signal',
    )
  })

  it('reports exclusion reason aggregates without contact identifiers', () => {
    const overview = rpc('get_myhonor_reactivation_campaign_overview')
    expect(overview.match(/'exclusion_reasons'/g)).toHaveLength(2)
    expect(overview).toContain('recipient.exclusion_reason IS NOT NULL')
    expect(overview).toContain('jsonb_object_agg(grouped.reason, grouped.total)')
  })
})
