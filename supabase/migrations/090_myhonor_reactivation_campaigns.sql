-- Safe, consent-first WhatsApp reactivation campaigns for myhonor.shop.
--
-- Design invariants:
--   * no plaintext phone, name, city or message parameters are persisted;
--   * consent, suppression, ingest, audit and attribution records are append-only;
--   * every recipient keeps immutable eligibility, recommendation and consent
--     snapshots for later review;
--   * dry-run is the campaign default, and dry-run recipients can never be
--     leased or authorized for delivery;
--   * a provider call is fenced by lease -> authorize -> finish. A replay or
--     crash after authorization becomes delivery_unknown and is not retried;
--   * all writes and reads are exposed only through service-role RPCs.

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source TEXT NOT NULL DEFAULT 'myhonor.shop' CHECK (source = 'myhonor.shop'),
  external_customer_hash TEXT NOT NULL CHECK (
    external_customer_hash ~ '^[a-f0-9]{64}$'
  ),
  phone_hash TEXT NOT NULL CHECK (phone_hash ~ '^[a-f0-9]{64}$'),
  phone_ciphertext TEXT NOT NULL CHECK (
    length(phone_ciphertext) BETWEEN 20 AND 2048
    AND phone_ciphertext ~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
  ),
  phone_masked TEXT NOT NULL CHECK (
    length(phone_masked) BETWEEN 9 AND 24
    AND phone_masked ~ '^\+[0-9]{1,3}•{4,10}[0-9]{4}$'
  ),
  first_name_ciphertext TEXT CHECK (
    first_name_ciphertext IS NULL
    OR (
      length(first_name_ciphertext) BETWEEN 20 AND 2048
      AND first_name_ciphertext ~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
    )
  ),
  city_ciphertext TEXT CHECK (
    city_ciphertext IS NULL
    OR (
      length(city_ciphertext) BETWEEN 20 AND 2048
      AND city_ciphertext ~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
    )
  ),
  encryption_key_version SMALLINT NOT NULL DEFAULT 1 CHECK (
    encryption_key_version BETWEEN 1 AND 32767
  ),
  locale TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'kk')),
  source_version BIGINT NOT NULL CHECK (source_version > 0),
  source_updated_at TIMESTAMPTZ NOT NULL CHECK (isfinite(source_updated_at)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(updated_at)),
  UNIQUE (user_id, company_id, source, external_customer_hash),
  UNIQUE (user_id, company_id, source, phone_hash),
  UNIQUE (id, user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_profiles (
  contact_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  interests TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[] CHECK (
    interests <@ ARRAY[
      'hunting', 'fishing', 'outdoor', 'mountains', 'tactical', 'footwear',
      'base_layer', 'accessories'
    ]::TEXT[]
    AND cardinality(interests) <= 8
  ),
  size_ciphertext TEXT CHECK (
    size_ciphertext IS NULL
    OR (
      length(size_ciphertext) BETWEEN 20 AND 2048
      AND size_ciphertext ~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
    )
  ),
  budget_kzt BIGINT CHECK (budget_kzt IS NULL OR budget_kzt BETWEEN 0 AND 100000000),
  club_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    club_status IN ('member', 'not_member', 'unknown')
  ),
  customer_kind TEXT NOT NULL DEFAULT 'unknown' CHECK (
    customer_kind IN ('retail', 'wholesale', 'unknown')
  ),
  registered_at TIMESTAMPTZ CHECK (registered_at IS NULL OR isfinite(registered_at)),
  last_activity_at TIMESTAMPTZ CHECK (
    last_activity_at IS NULL OR isfinite(last_activity_at)
  ),
  last_order_at TIMESTAMPTZ CHECK (last_order_at IS NULL OR isfinite(last_order_at)),
  order_count INTEGER NOT NULL DEFAULT 0 CHECK (order_count BETWEEN 0 AND 1000000),
  lifetime_value_kzt NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (
    lifetime_value_kzt BETWEEN 0 AND 1000000000000
  ),
  last_order_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(last_order_product_ids) = 'array'
    AND jsonb_array_length(last_order_product_ids) <= 50
    AND pg_column_size(last_order_product_ids) <= 8192
  ),
  abandoned_cart JSONB CHECK (
    abandoned_cart IS NULL
    OR (
      jsonb_typeof(abandoned_cart) = 'object'
      AND pg_column_size(abandoned_cart) <= 8192
    )
  ),
  club_interest BOOLEAN NOT NULL DEFAULT FALSE,
  back_in_stock_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(back_in_stock_product_ids) = 'array'
    AND jsonb_array_length(back_in_stock_product_ids) <= 50
    AND pg_column_size(back_in_stock_product_ids) <= 8192
  ),
  provider_cooldown_until TIMESTAMPTZ CHECK (
    provider_cooldown_until IS NULL OR isfinite(provider_cooldown_until)
  ),
  unresolved_complaint BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_hold BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_hold_reason TEXT,
  source_version BIGINT NOT NULL CHECK (source_version > 0),
  source_updated_at TIMESTAMPTZ NOT NULL CHECK (isfinite(source_updated_at)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(updated_at)),
  FOREIGN KEY (contact_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_contacts(id, user_id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT myhonor_reactivation_profile_marketing_hold_shape CHECK (
    (NOT marketing_hold AND marketing_hold_reason IS NULL)
    OR (
      marketing_hold
      AND marketing_hold_reason IN (
        'open_order', 'recent_cancel_or_return', 'payment_unknown',
        'source_incomplete', 'identity_conflict', 'manual_review'
      )
    )
  )
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_contact_ingest_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source TEXT NOT NULL DEFAULT 'myhonor.shop' CHECK (source = 'myhonor.shop'),
  event_id TEXT NOT NULL CHECK (
    length(event_id) BETWEEN 8 AND 200
    AND event_id ~ '^(myhonor|whatsapp|meta-wa)(:[a-z][a-z0-9-]{0,39})?:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$'
  ),
  event_hash TEXT NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  source_version BIGINT NOT NULL CHECK (source_version > 0),
  contact_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL CHECK (isfinite(occurred_at)),
  result TEXT NOT NULL CHECK (
    result IN ('created', 'updated', 'stale_profile', 'revoked')
  ),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(received_at)),
  FOREIGN KEY (contact_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_contacts(id, user_id, company_id)
    ON DELETE RESTRICT,
  UNIQUE (user_id, company_id, source, event_id),
  UNIQUE (user_id, company_id, source, contact_id, source_version)
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  contact_id UUID NOT NULL,
  ingest_event_id UUID NOT NULL,
  source_version BIGINT NOT NULL CHECK (source_version > 0),
  status TEXT NOT NULL CHECK (status IN ('granted', 'revoked')),
  purposes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[] CHECK (
    purposes <@ ARRAY[
      'marketing_offers', 'product_recommendations', 'club_updates'
    ]::TEXT[]
    AND cardinality(purposes) <= 3
  ),
  consent_source TEXT NOT NULL CHECK (
    consent_source IN (
      'checkout_checkbox', 'account_settings', 'whatsapp_reply', 'in_store',
      'import_verified'
    )
  ),
  notice_version TEXT NOT NULL CHECK (
    length(btrim(notice_version)) BETWEEN 1 AND 100
  ),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  obtained_at TIMESTAMPTZ CHECK (obtained_at IS NULL OR isfinite(obtained_at)),
  revoked_at TIMESTAMPTZ CHECK (revoked_at IS NULL OR isfinite(revoked_at)),
  cross_border_disclosed BOOLEAN NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL CHECK (isfinite(occurred_at)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  FOREIGN KEY (contact_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_contacts(id, user_id, company_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (ingest_event_id)
    REFERENCES public.myhonor_reactivation_contact_ingest_events(id)
    ON DELETE RESTRICT,
  UNIQUE (ingest_event_id),
  CONSTRAINT myhonor_reactivation_consent_event_shape CHECK (
    (
      status = 'granted'
      AND cardinality(purposes) BETWEEN 1 AND 3
      AND obtained_at IS NOT NULL
      AND revoked_at IS NULL
      AND cross_border_disclosed
    )
    OR (
      status = 'revoked'
      AND cardinality(purposes) = 0
      AND obtained_at IS NULL
      AND revoked_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_suppression_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  contact_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('suppress', 'unsuppress')),
  reason TEXT NOT NULL CHECK (
    reason IN (
      'consent_revoked', 'whatsapp_opt_out', 'manual', 'legal',
      'unresolved_complaint', 'provider_quality'
    )
  ),
  source_event_id TEXT NOT NULL CHECK (
    length(source_event_id) BETWEEN 8 AND 200
    AND source_event_id ~ '^(myhonor|whatsapp|meta-wa)(:[a-z][a-z0-9-]{0,39})?:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$'
  ),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  source_version BIGINT CHECK (source_version IS NULL OR source_version > 0),
  occurred_at TIMESTAMPTZ NOT NULL CHECK (isfinite(occurred_at)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  FOREIGN KEY (contact_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_contacts(id, user_id, company_id)
    ON DELETE RESTRICT,
  UNIQUE (user_id, company_id, contact_id, reason, source_event_id),
  CONSTRAINT myhonor_reactivation_suppression_source_version CHECK (
    (reason = 'consent_revoked' AND source_version IS NOT NULL)
    OR (reason <> 'consent_revoked' AND source_version IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 160),
  segment TEXT NOT NULL CHECK (
    segment IN (
      'old_lead', 'registered_no_order', 'dormant_customer', 'post_purchase',
      'seasonal', 'club_interest', 'back_in_stock', 'abandoned_cart'
    )
  ),
  season TEXT CHECK (
    season IS NULL
    OR season IN ('spring', 'summer', 'autumn', 'winter', 'all_season')
  ),
  purpose TEXT NOT NULL CHECK (
    purpose IN ('product_recommendations', 'club_updates')
  ),
  interest TEXT CHECK (
    interest IS NULL
    OR interest IN (
      'hunting', 'fishing', 'outdoor', 'mountains', 'tactical', 'footwear',
      'base_layer', 'accessories'
    )
  ),
  inactivity_days INTEGER NOT NULL DEFAULT 90 CHECK (
    inactivity_days BETWEEN 3 AND 730
  ),
  frequency_cap_days INTEGER NOT NULL DEFAULT 14 CHECK (
    frequency_cap_days BETWEEN 7 AND 365
  ),
  monthly_cap SMALLINT NOT NULL DEFAULT 3 CHECK (monthly_cap BETWEEN 1 AND 3),
  daily_limit INTEGER NOT NULL DEFAULT 10 CHECK (daily_limit BETWEEN 1 AND 100),
  holdout_percent SMALLINT NOT NULL DEFAULT 10 CHECK (
    holdout_percent BETWEEN 0 AND 50
  ),
  product_limit SMALLINT NOT NULL DEFAULT 2 CHECK (product_limit BETWEEN 1 AND 3),
  template_name TEXT CHECK (
    template_name IS NULL OR template_name ~ '^[a-z0-9_]{1,512}$'
  ),
  template_language TEXT CHECK (
    template_language IS NULL
    OR template_language ~ '^[a-z]{2,3}(?:_[A-Z]{2})?$'
  ),
  template_contract_hash TEXT CHECK (
    template_contract_hash IS NULL
    OR template_contract_hash ~ '^[a-f0-9]{64}$'
  ),
  utm_campaign TEXT NOT NULL CHECK (
    length(utm_campaign) BETWEEN 3 AND 100
    AND utm_campaign ~ '^[a-z0-9][a-z0-9_-]*$'
  ),
  eligibility_rules JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(eligibility_rules) = 'object'
    AND pg_column_size(eligibility_rules) <= 16384
  ),
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (
    state IN ('draft', 'approved', 'running', 'paused', 'completed')
  ),
  created_by_hash TEXT NOT NULL CHECK (created_by_hash ~ '^[a-f0-9]{64}$'),
  preview_snapshot_hash TEXT CHECK (
    preview_snapshot_hash IS NULL OR preview_snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  approval_snapshot_hash TEXT CHECK (
    approval_snapshot_hash IS NULL OR approval_snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  approved_by_hash TEXT CHECK (
    approved_by_hash IS NULL OR approved_by_hash ~ '^[a-f0-9]{64}$'
  ),
  approved_at TIMESTAMPTZ CHECK (approved_at IS NULL OR isfinite(approved_at)),
  started_at TIMESTAMPTZ CHECK (started_at IS NULL OR isfinite(started_at)),
  paused_at TIMESTAMPTZ CHECK (paused_at IS NULL OR isfinite(paused_at)),
  completed_at TIMESTAMPTZ CHECK (completed_at IS NULL OR isfinite(completed_at)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(updated_at)),
  UNIQUE (id, user_id, company_id),
  CONSTRAINT myhonor_reactivation_campaign_purpose CHECK (
    (segment = 'club_interest' AND purpose = 'club_updates')
    OR (segment <> 'club_interest' AND purpose = 'product_recommendations')
  ),
  CONSTRAINT myhonor_reactivation_campaign_season CHECK (
    segment <> 'seasonal' OR season IS NOT NULL
  ),
  CONSTRAINT myhonor_reactivation_campaign_template_shape CHECK (
    dry_run OR (template_name IS NOT NULL AND template_language IS NOT NULL)
  ),
  CONSTRAINT myhonor_reactivation_campaign_template_contract_shape CHECK (
    (
      template_name IS NULL
      AND template_language IS NULL
      AND template_contract_hash IS NULL
    )
    OR (
      template_name IS NOT NULL
      AND template_language IS NOT NULL
      AND (preview_snapshot_hash IS NULL OR template_contract_hash IS NOT NULL)
    )
  ),
  CONSTRAINT myhonor_reactivation_campaign_approval_hash CHECK (
    approval_snapshot_hash IS NULL
    OR approval_snapshot_hash = preview_snapshot_hash
  ),
  CONSTRAINT myhonor_reactivation_campaign_preview_required CHECK (
    state = 'draft' OR preview_snapshot_hash IS NOT NULL
  ),
  CONSTRAINT myhonor_reactivation_campaign_state_shape CHECK (
    (
      state = 'draft'
      AND approval_snapshot_hash IS NULL
      AND approved_by_hash IS NULL
      AND approved_at IS NULL
      AND started_at IS NULL
      AND paused_at IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'approved'
      AND approval_snapshot_hash IS NOT NULL
      AND approved_by_hash IS NOT NULL
      AND approved_at IS NOT NULL
      AND started_at IS NULL
      AND paused_at IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'running'
      AND approval_snapshot_hash IS NOT NULL
      AND approved_by_hash IS NOT NULL
      AND approved_at IS NOT NULL
      AND started_at IS NOT NULL
      AND paused_at IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'paused'
      AND approval_snapshot_hash IS NOT NULL
      AND approved_by_hash IS NOT NULL
      AND approved_at IS NOT NULL
      AND started_at IS NOT NULL
      AND paused_at IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'completed'
      AND approval_snapshot_hash IS NOT NULL
      AND approved_by_hash IS NOT NULL
      AND approved_at IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  send_idempotency_key TEXT NOT NULL CHECK (
    send_idempotency_key ~ '^[a-f0-9]{64}$'
  ),
  phone_hash_snapshot TEXT NOT NULL CHECK (
    phone_hash_snapshot ~ '^[a-f0-9]{64}$'
  ),
  phone_ciphertext_snapshot TEXT NOT NULL CHECK (
    length(phone_ciphertext_snapshot) BETWEEN 20 AND 2048
    AND phone_ciphertext_snapshot ~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
  ),
  locale_snapshot TEXT NOT NULL CHECK (locale_snapshot IN ('ru', 'kk')),
  contact_source_version_snapshot BIGINT NOT NULL CHECK (
    contact_source_version_snapshot > 0
  ),
  profile_source_version_snapshot BIGINT CHECK (
    profile_source_version_snapshot IS NULL OR profile_source_version_snapshot > 0
  ),
  eligibility_snapshot JSONB NOT NULL CHECK (
    jsonb_typeof(eligibility_snapshot) = 'object'
    AND pg_column_size(eligibility_snapshot) <= 32768
  ),
  eligibility_hash TEXT NOT NULL CHECK (eligibility_hash ~ '^[a-f0-9]{64}$'),
  recommendation_snapshot JSONB NOT NULL CHECK (
    jsonb_typeof(recommendation_snapshot) = 'object'
    AND pg_column_size(recommendation_snapshot) <= 32768
  ),
  recommendation_hash TEXT NOT NULL CHECK (
    recommendation_hash ~ '^[a-f0-9]{64}$'
  ),
  consent_snapshot JSONB NOT NULL CHECK (
    jsonb_typeof(consent_snapshot) = 'object'
    AND pg_column_size(consent_snapshot) <= 16384
  ),
  consent_source_version_snapshot BIGINT CHECK (
    consent_source_version_snapshot IS NULL OR consent_source_version_snapshot > 0
  ),
  consent_hash TEXT NOT NULL CHECK (consent_hash ~ '^[a-f0-9]{64}$'),
  template_parameters_ciphertext TEXT NOT NULL CHECK (
    length(template_parameters_ciphertext) BETWEEN 20 AND 8192
    AND template_parameters_ciphertext ~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
  ),
  template_parameters_hash TEXT NOT NULL CHECK (
    template_parameters_hash ~ '^[a-f0-9]{64}$'
  ),
  holdout_bucket SMALLINT NOT NULL CHECK (holdout_bucket BETWEEN 0 AND 99),
  is_holdout BOOLEAN NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'preview', 'holdout', 'excluded', 'queued', 'leased', 'authorized',
      'accepted', 'sent', 'delivered', 'read', 'failed', 'delivery_unknown',
      'cancelled'
    )
  ),
  exclusion_reason TEXT CHECK (
    exclusion_reason IS NULL
    OR exclusion_reason IN (
      'missing_consent', 'global_suppression', 'unresolved_complaint',
      'frequency_cap', 'monthly_frequency_cap', 'inactive_product',
      'invalid_recommendation', 'application_ineligible', 'identity_changed',
      'provider_cooldown', 'campaign_completed', 'source_snapshot_changed',
      'source_snapshot_stale', 'manual_hold'
    )
  ),
  run_at TIMESTAMPTZ NOT NULL CHECK (isfinite(run_at)),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  lease_owner TEXT CHECK (
    lease_owner IS NULL OR length(btrim(lease_owner)) BETWEEN 1 AND 200
  ),
  lease_token UUID,
  lease_until TIMESTAMPTZ CHECK (lease_until IS NULL OR isfinite(lease_until)),
  authorized_at TIMESTAMPTZ CHECK (authorized_at IS NULL OR isfinite(authorized_at)),
  provider_message_id TEXT CHECK (
    provider_message_id IS NULL OR length(btrim(provider_message_id)) BETWEEN 1 AND 500
  ),
  provider_accepted_at TIMESTAMPTZ CHECK (
    provider_accepted_at IS NULL OR isfinite(provider_accepted_at)
  ),
  last_error_code TEXT CHECK (
    last_error_code IS NULL
    OR last_error_code ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
  ),
  last_error_at TIMESTAMPTZ CHECK (last_error_at IS NULL OR isfinite(last_error_at)),
  completed_at TIMESTAMPTZ CHECK (completed_at IS NULL OR isfinite(completed_at)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(updated_at)),
  FOREIGN KEY (campaign_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_campaigns(id, user_id, company_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (contact_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_contacts(id, user_id, company_id)
    ON DELETE RESTRICT,
  UNIQUE (campaign_id, contact_id),
  UNIQUE (user_id, company_id, send_idempotency_key),
  UNIQUE (id, user_id, company_id),
  CONSTRAINT myhonor_reactivation_recipient_attempts CHECK (
    attempts <= max_attempts
  ),
  CONSTRAINT myhonor_reactivation_recipient_holdout CHECK (
    (is_holdout AND state IN ('preview', 'holdout', 'excluded', 'cancelled'))
    OR NOT is_holdout
  ),
  CONSTRAINT myhonor_reactivation_recipient_exclusion CHECK (
    (state = 'excluded' AND exclusion_reason IS NOT NULL)
    OR (state <> 'excluded' AND exclusion_reason IS NULL)
  ),
  CONSTRAINT myhonor_reactivation_recipient_lease CHECK (
    (
      state IN ('leased', 'authorized')
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_until IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      state NOT IN ('leased', 'authorized')
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_until IS NULL
    )
  ),
  CONSTRAINT myhonor_reactivation_recipient_completion CHECK (
    (
      state IN ('preview', 'queued', 'leased', 'authorized')
      AND completed_at IS NULL
    )
    OR (
      state IN (
        'holdout', 'excluded', 'accepted', 'sent', 'delivered', 'read',
        'failed', 'delivery_unknown', 'cancelled'
      )
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT myhonor_reactivation_recipient_provider CHECK (
    state NOT IN ('accepted', 'sent', 'delivered', 'read')
    OR (provider_message_id IS NOT NULL AND provider_accepted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_provider_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  attempt_number SMALLINT NOT NULL CHECK (attempt_number BETWEEN 1 AND 20),
  lease_token UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'authorized' CHECK (
    state IN ('authorized', 'accepted', 'failed', 'delivery_unknown')
  ),
  authorized_at TIMESTAMPTZ NOT NULL CHECK (isfinite(authorized_at)),
  completed_at TIMESTAMPTZ CHECK (completed_at IS NULL OR isfinite(completed_at)),
  provider_message_id TEXT CHECK (
    provider_message_id IS NULL OR length(btrim(provider_message_id)) BETWEEN 1 AND 500
  ),
  error_code TEXT CHECK (
    error_code IS NULL OR error_code ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
  ),
  FOREIGN KEY (recipient_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_recipients(id, user_id, company_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (campaign_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_campaigns(id, user_id, company_id)
    ON DELETE RESTRICT,
  UNIQUE (recipient_id, attempt_number),
  UNIQUE (lease_token),
  CONSTRAINT myhonor_reactivation_provider_attempt_shape CHECK (
    (state = 'authorized' AND completed_at IS NULL AND provider_message_id IS NULL)
    OR (
      state = 'accepted'
      AND completed_at IS NOT NULL
      AND provider_message_id IS NOT NULL
      AND error_code IS NULL
    )
    OR (
      state IN ('failed', 'delivery_unknown')
      AND completed_at IS NOT NULL
      AND provider_message_id IS NULL
      AND error_code IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  actor_kind TEXT NOT NULL CHECK (
    actor_kind IN ('api', 'admin', 'system', 'workflow', 'provider')
  ),
  actor_hash TEXT CHECK (actor_hash IS NULL OR actor_hash ~ '^[a-f0-9]{64}$'),
  action TEXT NOT NULL CHECK (
    length(action) BETWEEN 3 AND 120
    AND action ~ '^[a-z0-9][a-z0-9._:-]*$'
  ),
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'contact', 'consent', 'suppression', 'campaign', 'recipient',
      'provider_attempt', 'attribution'
    )
  ),
  entity_id UUID NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 16384
  ),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(occurred_at))
);

CREATE TABLE IF NOT EXISTS public.myhonor_reactivation_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  event_id TEXT NOT NULL CHECK (
    length(event_id) BETWEEN 8 AND 200
    AND event_id ~ '^(myhonor|whatsapp|meta-wa)(:[a-z][a-z0-9-]{0,39})?:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$'
  ),
  event_hash TEXT NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  recipient_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  attribution_kind TEXT NOT NULL CHECK (
    attribution_kind IN (
      'reply', 'click', 'club_join', 'order', 'revenue', 'unsubscribe'
    )
  ),
  occurred_at TIMESTAMPTZ NOT NULL CHECK (isfinite(occurred_at)),
  value_kzt NUMERIC(18,2) CHECK (value_kzt IS NULL OR value_kzt >= 0),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 16384
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  FOREIGN KEY (recipient_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_recipients(id, user_id, company_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (campaign_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_campaigns(id, user_id, company_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (contact_id, user_id, company_id)
    REFERENCES public.myhonor_reactivation_contacts(id, user_id, company_id)
    ON DELETE RESTRICT,
  UNIQUE (user_id, company_id, event_id),
  CONSTRAINT myhonor_reactivation_attribution_value CHECK (
    (attribution_kind IN ('order', 'revenue') AND value_kzt IS NOT NULL)
    OR (attribution_kind NOT IN ('order', 'revenue') AND value_kzt IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_contacts_owner
  ON public.myhonor_reactivation_contacts (user_id, company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_profiles_activity
  ON public.myhonor_reactivation_profiles (
    user_id, company_id, last_activity_at DESC NULLS LAST
  );
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_consent_contact_time
  ON public.myhonor_reactivation_consent_events (
    user_id, company_id, contact_id, source_version DESC, created_at DESC
  );
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_suppression_contact_time
  ON public.myhonor_reactivation_suppression_events (
    user_id, company_id, contact_id, reason,
    source_version DESC NULLS LAST, occurred_at DESC, created_at DESC
  );
CREATE UNIQUE INDEX IF NOT EXISTS idx_myhonor_reactivation_consent_suppression_version
  ON public.myhonor_reactivation_suppression_events (
    user_id, company_id, contact_id, source_version
  )
  WHERE reason = 'consent_revoked';
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_campaigns_owner
  ON public.myhonor_reactivation_campaigns (
    user_id, company_id, created_at DESC
  );
CREATE UNIQUE INDEX IF NOT EXISTS idx_myhonor_reactivation_one_running_campaign
  ON public.myhonor_reactivation_campaigns (user_id, company_id)
  WHERE state = 'running';
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_recipients_ready
  ON public.myhonor_reactivation_recipients (
    campaign_id, run_at, created_at, id
  )
  WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_recipients_lease
  ON public.myhonor_reactivation_recipients (campaign_id, lease_until, id)
  WHERE state IN ('leased', 'authorized');
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_recipients_frequency
  ON public.myhonor_reactivation_recipients (
    contact_id, provider_accepted_at DESC
  )
  WHERE provider_accepted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_myhonor_reactivation_recipient_provider_id
  ON public.myhonor_reactivation_recipients (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_myhonor_reactivation_attempt_provider_id
  ON public.myhonor_reactivation_provider_attempts (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_audit_entity
  ON public.myhonor_reactivation_audit_events (
    user_id, company_id, entity_type, entity_id, occurred_at DESC
  );
CREATE INDEX IF NOT EXISTS idx_myhonor_reactivation_attribution_campaign
  ON public.myhonor_reactivation_attributions (
    user_id, company_id, campaign_id, occurred_at DESC
  );

COMMENT ON TABLE public.myhonor_reactivation_contacts IS
  'Encrypted MyHonor contact identities. Plaintext phone, name and city are prohibited.';
COMMENT ON TABLE public.myhonor_reactivation_consent_events IS
  'Append-only complete marketing-purpose snapshots; omitted purposes are withdrawn and consent is never inferred from a phone number.';
COMMENT ON TABLE public.myhonor_reactivation_suppression_events IS
  'Append-only global suppression ledger. Re-opt-in clears only consent_revoked, never legal/manual suppressions.';
COMMENT ON COLUMN public.myhonor_reactivation_contacts.source_version IS
  'Strictly increasing per-contact Store version; delivery timestamps never override it.';
COMMENT ON COLUMN public.myhonor_reactivation_suppression_events.source_version IS
  'Store version for consent_revoked only; non-Store suppression reasons use occurrence-time ordering.';
COMMENT ON TABLE public.myhonor_reactivation_recipients IS
  'Per-campaign immutable eligibility/recommendation/consent and encrypted identity snapshots.';
COMMENT ON COLUMN public.myhonor_reactivation_campaigns.template_contract_hash IS
  'Service-verified digest of the exact Meta template contract bound to the first preview.';
COMMENT ON COLUMN public.myhonor_reactivation_recipients.template_parameters_hash IS
  'SHA-256 of canonical plaintext template parameters; preview consumers must recompute after in-memory decryption.';
COMMENT ON COLUMN public.myhonor_reactivation_recipients.authorized_at IS
  'Provider boundary fence. An interrupted authorized send becomes delivery_unknown.';

DROP TRIGGER IF EXISTS myhonor_reactivation_contacts_updated_at
  ON public.myhonor_reactivation_contacts;
CREATE TRIGGER myhonor_reactivation_contacts_updated_at
  BEFORE UPDATE ON public.myhonor_reactivation_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS myhonor_reactivation_profiles_updated_at
  ON public.myhonor_reactivation_profiles;
CREATE TRIGGER myhonor_reactivation_profiles_updated_at
  BEFORE UPDATE ON public.myhonor_reactivation_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS myhonor_reactivation_campaigns_updated_at
  ON public.myhonor_reactivation_campaigns;
CREATE TRIGGER myhonor_reactivation_campaigns_updated_at
  BEFORE UPDATE ON public.myhonor_reactivation_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS myhonor_reactivation_recipients_updated_at
  ON public.myhonor_reactivation_recipients;
CREATE TRIGGER myhonor_reactivation_recipients_updated_at
  BEFORE UPDATE ON public.myhonor_reactivation_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.myhonor_reactivation_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.myhonor_reactivation_protect_campaign_definition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF (
    OLD.preview_snapshot_hash IS NOT NULL
    AND NEW.template_contract_hash IS DISTINCT FROM OLD.template_contract_hash
  ) OR (OLD.state <> 'draft' AND (
    NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.segment IS DISTINCT FROM OLD.segment
    OR NEW.season IS DISTINCT FROM OLD.season
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.interest IS DISTINCT FROM OLD.interest
    OR NEW.inactivity_days IS DISTINCT FROM OLD.inactivity_days
    OR NEW.frequency_cap_days IS DISTINCT FROM OLD.frequency_cap_days
    OR NEW.monthly_cap IS DISTINCT FROM OLD.monthly_cap
    OR NEW.daily_limit IS DISTINCT FROM OLD.daily_limit
    OR NEW.holdout_percent IS DISTINCT FROM OLD.holdout_percent
    OR NEW.product_limit IS DISTINCT FROM OLD.product_limit
    OR NEW.template_name IS DISTINCT FROM OLD.template_name
    OR NEW.template_language IS DISTINCT FROM OLD.template_language
    OR NEW.template_contract_hash IS DISTINCT FROM OLD.template_contract_hash
    OR NEW.utm_campaign IS DISTINCT FROM OLD.utm_campaign
    OR NEW.eligibility_rules IS DISTINCT FROM OLD.eligibility_rules
    OR NEW.dry_run IS DISTINCT FROM OLD.dry_run
    OR NEW.created_by_hash IS DISTINCT FROM OLD.created_by_hash
    OR NEW.preview_snapshot_hash IS DISTINCT FROM OLD.preview_snapshot_hash
  )) THEN
    RAISE EXCEPTION 'approved campaign definition is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.myhonor_reactivation_protect_recipient_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.send_idempotency_key IS DISTINCT FROM OLD.send_idempotency_key
     OR NEW.phone_hash_snapshot IS DISTINCT FROM OLD.phone_hash_snapshot
     OR NEW.phone_ciphertext_snapshot IS DISTINCT FROM OLD.phone_ciphertext_snapshot
     OR NEW.locale_snapshot IS DISTINCT FROM OLD.locale_snapshot
     OR NEW.contact_source_version_snapshot
          IS DISTINCT FROM OLD.contact_source_version_snapshot
     OR NEW.profile_source_version_snapshot
          IS DISTINCT FROM OLD.profile_source_version_snapshot
     OR NEW.eligibility_snapshot IS DISTINCT FROM OLD.eligibility_snapshot
     OR NEW.eligibility_hash IS DISTINCT FROM OLD.eligibility_hash
     OR NEW.recommendation_snapshot IS DISTINCT FROM OLD.recommendation_snapshot
     OR NEW.recommendation_hash IS DISTINCT FROM OLD.recommendation_hash
     OR NEW.consent_snapshot IS DISTINCT FROM OLD.consent_snapshot
     OR NEW.consent_source_version_snapshot
          IS DISTINCT FROM OLD.consent_source_version_snapshot
     OR NEW.consent_hash IS DISTINCT FROM OLD.consent_hash
     OR NEW.template_parameters_ciphertext IS DISTINCT FROM OLD.template_parameters_ciphertext
     OR NEW.template_parameters_hash IS DISTINCT FROM OLD.template_parameters_hash
     OR NEW.holdout_bucket IS DISTINCT FROM OLD.holdout_bucket
     OR NEW.is_holdout IS DISTINCT FROM OLD.is_holdout THEN
    RAISE EXCEPTION 'recipient compliance snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Canonical JSON used to verify that caller-supplied snapshot hashes describe
-- the exact immutable payload being materialized. Object keys use C/ASCII
-- ordering, matching the application stable-json encoder for this contract.
CREATE OR REPLACE FUNCTION public.myhonor_reactivation_canonical_jsonb(
  p_value JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_result TEXT;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(string_agg(
        to_jsonb(item.key)::TEXT || ':'
          || public.myhonor_reactivation_canonical_jsonb(item.value),
        ',' ORDER BY item.key COLLATE "C"
      ), '') || '}'
        INTO v_result
        FROM jsonb_each(p_value) AS item;
    WHEN 'array' THEN
      SELECT '[' || COALESCE(string_agg(
        public.myhonor_reactivation_canonical_jsonb(item.value),
        ',' ORDER BY item.ordinality
      ), '') || ']'
        INTO v_result
        FROM jsonb_array_elements(p_value) WITH ORDINALITY AS item(value, ordinality);
    ELSE
      v_result := p_value::TEXT;
  END CASE;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.myhonor_reactivation_next_allowed_send_at(
  p_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_local TIMESTAMP := p_at AT TIME ZONE 'Asia/Almaty';
  v_date DATE;
  v_open_local TIMESTAMP;
  v_close_local TIMESTAMP;
  v_offset INTEGER;
  v_open_hour INTEGER;
  v_close_hour INTEGER;
BEGIN
  FOR v_offset IN 0..7 LOOP
    v_date := v_local::DATE + v_offset;
    IF extract(isodow FROM v_date) BETWEEN 1 AND 5 THEN
      v_open_hour := 10;
      v_close_hour := 20;
    ELSE
      v_open_hour := 11;
      v_close_hour := 18;
    END IF;
    v_open_local := v_date::TIMESTAMP + make_interval(hours => v_open_hour);
    v_close_local := v_date::TIMESTAMP + make_interval(hours => v_close_hour);
    IF v_offset = 0 AND v_local >= v_open_local AND v_local < v_close_local THEN
      RETURN p_at;
    END IF;
    IF v_open_local > v_local THEN
      RETURN v_open_local AT TIME ZONE 'Asia/Almaty';
    END IF;
  END LOOP;
  RAISE EXCEPTION 'unable to calculate next marketing window' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.myhonor_reactivation_jsonb_contains_pii(
  p_value JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_key TEXT;
  v_child JSONB;
  v_text TEXT;
BEGIN
  IF jsonb_typeof(p_value) = 'object' THEN
    FOR v_key, v_child IN SELECT item.key, item.value FROM jsonb_each(p_value) AS item
    LOOP
      IF lower(v_key) IN (
        'phone', 'phone_e164', 'mobile', 'whatsapp', 'email', 'name',
        'first_name', 'last_name', 'full_name', 'address', 'message',
        'message_text', 'body', 'content'
      ) OR public.myhonor_reactivation_jsonb_contains_pii(v_child) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    FOR v_child IN SELECT item.value FROM jsonb_array_elements(p_value) AS item
    LOOP
      IF public.myhonor_reactivation_jsonb_contains_pii(v_child) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value) = 'string' THEN
    v_text := p_value #>> '{}';
    IF v_text ~ '^\+[1-9][0-9]{7,14}$'
       OR v_text ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
      RETURN TRUE;
    END IF;
  END IF;
  RETURN FALSE;
END;
$$;

DROP TRIGGER IF EXISTS myhonor_reactivation_contact_ingest_immutable
  ON public.myhonor_reactivation_contact_ingest_events;
CREATE TRIGGER myhonor_reactivation_contact_ingest_immutable
  BEFORE UPDATE OR DELETE ON public.myhonor_reactivation_contact_ingest_events
  FOR EACH ROW EXECUTE FUNCTION public.myhonor_reactivation_reject_mutation();
DROP TRIGGER IF EXISTS myhonor_reactivation_consent_immutable
  ON public.myhonor_reactivation_consent_events;
CREATE TRIGGER myhonor_reactivation_consent_immutable
  BEFORE UPDATE OR DELETE ON public.myhonor_reactivation_consent_events
  FOR EACH ROW EXECUTE FUNCTION public.myhonor_reactivation_reject_mutation();
DROP TRIGGER IF EXISTS myhonor_reactivation_suppression_immutable
  ON public.myhonor_reactivation_suppression_events;
CREATE TRIGGER myhonor_reactivation_suppression_immutable
  BEFORE UPDATE OR DELETE ON public.myhonor_reactivation_suppression_events
  FOR EACH ROW EXECUTE FUNCTION public.myhonor_reactivation_reject_mutation();
DROP TRIGGER IF EXISTS myhonor_reactivation_audit_immutable
  ON public.myhonor_reactivation_audit_events;
CREATE TRIGGER myhonor_reactivation_audit_immutable
  BEFORE UPDATE OR DELETE ON public.myhonor_reactivation_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.myhonor_reactivation_reject_mutation();
DROP TRIGGER IF EXISTS myhonor_reactivation_attribution_immutable
  ON public.myhonor_reactivation_attributions;
CREATE TRIGGER myhonor_reactivation_attribution_immutable
  BEFORE UPDATE OR DELETE ON public.myhonor_reactivation_attributions
  FOR EACH ROW EXECUTE FUNCTION public.myhonor_reactivation_reject_mutation();
DROP TRIGGER IF EXISTS myhonor_reactivation_provider_attempt_no_delete
  ON public.myhonor_reactivation_provider_attempts;
CREATE TRIGGER myhonor_reactivation_provider_attempt_no_delete
  BEFORE DELETE ON public.myhonor_reactivation_provider_attempts
  FOR EACH ROW EXECUTE FUNCTION public.myhonor_reactivation_reject_mutation();
DROP TRIGGER IF EXISTS myhonor_reactivation_campaign_definition_immutable
  ON public.myhonor_reactivation_campaigns;
CREATE TRIGGER myhonor_reactivation_campaign_definition_immutable
  BEFORE UPDATE ON public.myhonor_reactivation_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.myhonor_reactivation_protect_campaign_definition();
DROP TRIGGER IF EXISTS myhonor_reactivation_recipient_snapshot_immutable
  ON public.myhonor_reactivation_recipients;
CREATE TRIGGER myhonor_reactivation_recipient_snapshot_immutable
  BEFORE UPDATE ON public.myhonor_reactivation_recipients
  FOR EACH ROW EXECUTE FUNCTION public.myhonor_reactivation_protect_recipient_snapshot();

CREATE OR REPLACE VIEW public.myhonor_reactivation_effective_suppressions AS
WITH ranked AS (
  SELECT
    event.user_id,
    event.company_id,
    event.contact_id,
    event.reason,
    event.action,
    event.id AS event_id,
    event.source_version,
    event.occurred_at,
    row_number() OVER (
      PARTITION BY event.user_id, event.company_id, event.contact_id, event.reason
      -- Store consent events are ordered by their monotonic source version.
      -- Non-store suppressions intentionally have no source version and fall
      -- back to provider/admin occurrence time within their own reason.
      ORDER BY event.source_version DESC NULLS LAST,
               event.occurred_at DESC, event.created_at DESC, event.id DESC
    ) AS rank
  FROM public.myhonor_reactivation_suppression_events AS event
)
SELECT
  user_id,
  company_id,
  contact_id,
  array_agg(reason ORDER BY reason) AS active_reasons,
  max(occurred_at) AS effective_at
FROM ranked
WHERE rank = 1 AND action = 'suppress'
GROUP BY user_id, company_id, contact_id;

CREATE OR REPLACE VIEW public.myhonor_reactivation_effective_consent AS
WITH purpose_catalog(purpose) AS (
  VALUES
    ('marketing_offers'::TEXT),
    ('product_recommendations'::TEXT),
    ('club_updates'::TEXT)
), latest_event AS (
  SELECT
    event.*,
    row_number() OVER (
      PARTITION BY event.user_id, event.company_id, event.contact_id
      ORDER BY event.source_version DESC,
               event.occurred_at DESC, event.created_at DESC, event.id DESC
    ) AS rank
  FROM public.myhonor_reactivation_consent_events AS event
), expanded AS (
  -- Every Store consent event is a complete snapshot of all purposes. A
  -- purpose omitted by the newest granted snapshot is an effective withdrawal,
  -- never permission to retain a grant from an older source version.
  SELECT
    event.user_id,
    event.company_id,
    event.contact_id,
    purpose_catalog.purpose,
    event.id AS consent_event_id,
    CASE
      WHEN event.status = 'granted'
       AND purpose_catalog.purpose = ANY(event.purposes) THEN 'granted'
      ELSE 'revoked'
    END AS status,
    event.consent_source,
    event.notice_version,
    event.evidence_hash,
    CASE
      WHEN event.status = 'granted'
       AND purpose_catalog.purpose = ANY(event.purposes) THEN event.obtained_at
      ELSE NULL
    END AS obtained_at,
    CASE
      WHEN event.status = 'granted'
       AND purpose_catalog.purpose = ANY(event.purposes) THEN NULL
      ELSE COALESCE(event.revoked_at, event.occurred_at)
    END AS revoked_at,
    CASE
      WHEN event.status = 'granted'
       AND purpose_catalog.purpose = ANY(event.purposes)
        THEN event.cross_border_disclosed
      ELSE FALSE
    END AS cross_border_disclosed,
    event.source_version,
    event.occurred_at
  FROM latest_event AS event
  CROSS JOIN purpose_catalog
  WHERE event.rank = 1
)
SELECT
  expanded.user_id,
  expanded.company_id,
  expanded.contact_id,
  expanded.purpose,
  expanded.consent_event_id,
  expanded.status,
  expanded.consent_source,
  expanded.notice_version,
  expanded.evidence_hash,
  expanded.obtained_at,
  expanded.revoked_at,
  expanded.cross_border_disclosed,
  expanded.source_version,
  expanded.occurred_at,
  (expanded.status = 'granted'
    AND expanded.cross_border_disclosed
    AND suppression.contact_id IS NULL) AS eligible
FROM expanded
LEFT JOIN public.myhonor_reactivation_effective_suppressions AS suppression
  ON suppression.user_id = expanded.user_id
 AND suppression.company_id = expanded.company_id
 AND suppression.contact_id = expanded.contact_id;

CREATE OR REPLACE FUNCTION public.ingest_myhonor_reactivation_contact_event(
  p_user_id UUID,
  p_company_id TEXT,
  p_event_id TEXT,
  p_event_hash TEXT,
  p_source_version BIGINT,
  p_occurred_at TIMESTAMPTZ,
  p_encrypted_contact JSONB,
  p_lifecycle JSONB,
  p_consent JSONB
)
RETURNS TABLE (
  contact_id UUID,
  ingest_result TEXT,
  duplicate BOOLEAN,
  conflict BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_event public.myhonor_reactivation_contact_ingest_events%ROWTYPE;
  v_existing_version public.myhonor_reactivation_contact_ingest_events%ROWTYPE;
  v_contact public.myhonor_reactivation_contacts%ROWTYPE;
  v_external_contact_id UUID;
  v_phone_contact_id UUID;
  v_ingest_id UUID;
  v_result TEXT := 'updated';
  v_interests TEXT[];
  v_last_products JSONB;
  v_back_in_stock_products JSONB;
  v_cart JSONB;
  v_consent_purposes TEXT[];
  v_consent_status TEXT;
  v_consent_source TEXT;
  v_consent_time TIMESTAMPTZ;
  v_source_applied BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_event_id IS NULL
     OR length(p_event_id) NOT BETWEEN 8 AND 200
     OR p_event_id !~ '^(myhonor|whatsapp|meta-wa)(:[a-z][a-z0-9-]{0,39})?:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$'
     OR p_event_hash IS NULL OR p_event_hash !~ '^[a-f0-9]{64}$'
     OR p_source_version IS NULL OR p_source_version <= 0
     OR p_occurred_at IS NULL OR NOT isfinite(p_occurred_at)
     OR p_occurred_at > v_now + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid reactivation event envelope' USING ERRCODE = '22023';
  END IF;

  IF p_encrypted_contact IS NULL
     OR jsonb_typeof(p_encrypted_contact) <> 'object'
     OR pg_column_size(p_encrypted_contact) > 16384
     OR NOT p_encrypted_contact ?& ARRAY[
       'external_customer_hash', 'phone_hash', 'phone_ciphertext',
       'phone_masked', 'first_name_ciphertext', 'locale', 'city_ciphertext',
       'interests', 'size_ciphertext', 'budget_kzt', 'club_status',
       'customer_kind'
     ]
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(p_encrypted_contact) AS key_name
       WHERE key_name <> ALL(ARRAY[
         'external_customer_hash', 'phone_hash', 'phone_ciphertext',
         'phone_masked', 'first_name_ciphertext', 'locale', 'city_ciphertext',
         'interests', 'size_ciphertext', 'budget_kzt', 'club_status',
         'customer_kind', 'encryption_key_version'
       ]::TEXT[])
     ) THEN
    RAISE EXCEPTION 'invalid encrypted contact payload' USING ERRCODE = '22023';
  END IF;

  IF p_encrypted_contact->>'external_customer_hash' !~ '^[a-f0-9]{64}$'
     OR p_encrypted_contact->>'phone_hash' !~ '^[a-f0-9]{64}$'
     OR p_encrypted_contact->>'phone_ciphertext' !~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
     OR length(p_encrypted_contact->>'phone_ciphertext') NOT BETWEEN 20 AND 2048
     OR p_encrypted_contact->>'phone_masked' !~ '^\+[0-9]{1,3}•{4,10}[0-9]{4}$'
     OR length(p_encrypted_contact->>'phone_masked') NOT BETWEEN 9 AND 24
     OR p_encrypted_contact->>'locale' NOT IN ('ru', 'kk')
     OR p_encrypted_contact->>'club_status' NOT IN ('member', 'not_member', 'unknown')
     OR p_encrypted_contact->>'customer_kind' NOT IN ('retail', 'wholesale', 'unknown')
     OR jsonb_typeof(p_encrypted_contact->'interests') <> 'array'
     OR jsonb_array_length(p_encrypted_contact->'interests') > 8
     OR (
       p_encrypted_contact->'first_name_ciphertext' <> 'null'::jsonb
       AND (
         jsonb_typeof(p_encrypted_contact->'first_name_ciphertext') <> 'string'
         OR p_encrypted_contact->>'first_name_ciphertext'
              !~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
         OR length(p_encrypted_contact->>'first_name_ciphertext') NOT BETWEEN 20 AND 2048
       )
     )
     OR (
       p_encrypted_contact->'city_ciphertext' <> 'null'::jsonb
       AND (
         jsonb_typeof(p_encrypted_contact->'city_ciphertext') <> 'string'
         OR p_encrypted_contact->>'city_ciphertext'
              !~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
         OR length(p_encrypted_contact->>'city_ciphertext') NOT BETWEEN 20 AND 2048
       )
     )
     OR (
       p_encrypted_contact->'size_ciphertext' <> 'null'::jsonb
       AND (
         jsonb_typeof(p_encrypted_contact->'size_ciphertext') <> 'string'
         OR p_encrypted_contact->>'size_ciphertext'
              !~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
         OR length(p_encrypted_contact->>'size_ciphertext') NOT BETWEEN 20 AND 2048
       )
     )
     OR (
       p_encrypted_contact->'budget_kzt' <> 'null'::jsonb
       AND (
         jsonb_typeof(p_encrypted_contact->'budget_kzt') <> 'number'
         OR (p_encrypted_contact->>'budget_kzt')::NUMERIC <> trunc(
           (p_encrypted_contact->>'budget_kzt')::NUMERIC
         )
         OR (p_encrypted_contact->>'budget_kzt')::NUMERIC NOT BETWEEN 0 AND 100000000
       )
     )
     OR (
       p_encrypted_contact ? 'encryption_key_version'
       AND (
         jsonb_typeof(p_encrypted_contact->'encryption_key_version') <> 'number'
         OR (p_encrypted_contact->>'encryption_key_version')::INTEGER NOT BETWEEN 1 AND 32767
       )
     ) THEN
    RAISE EXCEPTION 'invalid encrypted contact values' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT interest ORDER BY interest), ARRAY[]::TEXT[])
    INTO v_interests
    FROM jsonb_array_elements_text(p_encrypted_contact->'interests') AS interest;
  IF NOT v_interests <@ ARRAY[
       'hunting', 'fishing', 'outdoor', 'mountains', 'tactical', 'footwear',
       'base_layer', 'accessories'
     ]::TEXT[] THEN
    RAISE EXCEPTION 'invalid contact interests' USING ERRCODE = '22023';
  END IF;

  IF p_lifecycle IS NULL
     OR jsonb_typeof(p_lifecycle) <> 'object'
     OR pg_column_size(p_lifecycle) > 32768
     OR NOT p_lifecycle ?& ARRAY[
       'registered_at', 'last_activity_at', 'last_order_at', 'order_count',
       'lifetime_value_kzt', 'last_order_product_ids', 'abandoned_cart',
       'club_interest', 'back_in_stock_product_ids', 'unresolved_complaint',
       'marketing_hold', 'marketing_hold_reason'
     ]
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(p_lifecycle) AS key_name
       WHERE key_name <> ALL(ARRAY[
         'registered_at', 'last_activity_at', 'last_order_at', 'order_count',
         'lifetime_value_kzt', 'last_order_product_ids', 'abandoned_cart',
         'club_interest', 'back_in_stock_product_ids', 'unresolved_complaint',
         'marketing_hold', 'marketing_hold_reason'
       ]::TEXT[])
     )
     OR jsonb_typeof(p_lifecycle->'order_count') <> 'number'
     OR (p_lifecycle->>'order_count')::NUMERIC <> trunc(
       (p_lifecycle->>'order_count')::NUMERIC
     )
     OR (p_lifecycle->>'order_count')::NUMERIC NOT BETWEEN 0 AND 1000000
     OR jsonb_typeof(p_lifecycle->'lifetime_value_kzt') <> 'number'
     OR (p_lifecycle->>'lifetime_value_kzt')::NUMERIC NOT BETWEEN 0 AND 1000000000000
     OR jsonb_typeof(p_lifecycle->'last_order_product_ids') <> 'array'
     OR jsonb_array_length(p_lifecycle->'last_order_product_ids') > 50
     OR jsonb_typeof(p_lifecycle->'club_interest') <> 'boolean'
     OR jsonb_typeof(p_lifecycle->'back_in_stock_product_ids') <> 'array'
     OR jsonb_array_length(p_lifecycle->'back_in_stock_product_ids') > 50
     OR jsonb_typeof(p_lifecycle->'unresolved_complaint') <> 'boolean'
     OR jsonb_typeof(p_lifecycle->'marketing_hold') <> 'boolean'
     OR (
       p_lifecycle->'marketing_hold_reason' <> 'null'::jsonb
       AND (
         jsonb_typeof(p_lifecycle->'marketing_hold_reason') <> 'string'
         OR p_lifecycle->>'marketing_hold_reason' NOT IN (
           'open_order', 'recent_cancel_or_return', 'payment_unknown',
           'source_incomplete', 'identity_conflict', 'manual_review'
         )
       )
     )
     OR (
       (p_lifecycle->>'marketing_hold')::BOOLEAN
       <> (p_lifecycle->'marketing_hold_reason' <> 'null'::jsonb)
     ) THEN
    RAISE EXCEPTION 'invalid lifecycle payload' USING ERRCODE = '22023';
  END IF;

  v_last_products := p_lifecycle->'last_order_product_ids';
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(v_last_products) AS product_id
     WHERE product_id !~ '^myhonor:[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'invalid lifecycle product id' USING ERRCODE = '22023';
  END IF;
  v_back_in_stock_products := p_lifecycle->'back_in_stock_product_ids';
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(v_back_in_stock_products) AS product_id
     WHERE product_id !~ '^myhonor:[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'invalid back-in-stock product id' USING ERRCODE = '22023';
  END IF;
  v_cart := CASE
    WHEN p_lifecycle->'abandoned_cart' = 'null'::jsonb THEN NULL
    ELSE p_lifecycle->'abandoned_cart'
  END;
  IF v_cart IS NOT NULL AND (
    jsonb_typeof(v_cart) <> 'object'
    OR NOT v_cart ?& ARRAY['active', 'updated_at', 'product_ids']
    OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_cart) AS key_name
      WHERE key_name <> ALL(ARRAY['active', 'updated_at', 'product_ids']::TEXT[])
    )
    OR jsonb_typeof(v_cart->'active') <> 'boolean'
    OR jsonb_typeof(v_cart->'updated_at') <> 'string'
    OR jsonb_typeof(v_cart->'product_ids') <> 'array'
    OR jsonb_array_length(v_cart->'product_ids') NOT BETWEEN 1 AND 50
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_cart->'product_ids') AS product_id
      WHERE product_id !~ '^myhonor:[a-f0-9]{64}$'
    )
  ) THEN
    RAISE EXCEPTION 'invalid abandoned cart payload' USING ERRCODE = '22023';
  END IF;

  IF p_consent IS NULL
     OR jsonb_typeof(p_consent) <> 'object'
     OR pg_column_size(p_consent) > 8192
     OR NOT p_consent ?& ARRAY[
       'status', 'purposes', 'source', 'notice_version', 'evidence_hash',
       'obtained_at', 'revoked_at', 'cross_border_disclosed'
     ]
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_consent) AS key_name
       WHERE key_name <> ALL(ARRAY[
         'status', 'purposes', 'source', 'notice_version', 'evidence_hash',
         'obtained_at', 'revoked_at', 'cross_border_disclosed'
       ]::TEXT[])
     )
     OR p_consent->>'status' NOT IN ('granted', 'revoked')
     OR p_consent->>'source' NOT IN (
       'checkout_checkbox', 'account_settings', 'whatsapp_reply', 'in_store',
       'import_verified'
     )
     OR length(btrim(p_consent->>'notice_version')) NOT BETWEEN 1 AND 100
     OR p_consent->>'evidence_hash' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_consent->'purposes') <> 'array'
     OR jsonb_array_length(p_consent->'purposes') > 3
     OR jsonb_typeof(p_consent->'cross_border_disclosed') <> 'boolean' THEN
    RAISE EXCEPTION 'invalid consent payload' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT purpose ORDER BY purpose), ARRAY[]::TEXT[])
    INTO v_consent_purposes
    FROM jsonb_array_elements_text(p_consent->'purposes') AS purpose;
  v_consent_status := p_consent->>'status';
  v_consent_source := p_consent->>'source';
  IF NOT v_consent_purposes <@ ARRAY[
       'marketing_offers', 'product_recommendations', 'club_updates'
     ]::TEXT[] THEN
    RAISE EXCEPTION 'invalid marketing purposes' USING ERRCODE = '22023';
  END IF;
  IF v_consent_status = 'granted' THEN
    IF cardinality(v_consent_purposes) = 0
       OR p_consent->'obtained_at' = 'null'::jsonb
       OR p_consent->'revoked_at' <> 'null'::jsonb
       OR NOT (p_consent->>'cross_border_disclosed')::BOOLEAN THEN
      RAISE EXCEPTION 'invalid granted consent' USING ERRCODE = '22023';
    END IF;
    v_consent_time := (p_consent->>'obtained_at')::TIMESTAMPTZ;
  ELSE
    IF cardinality(v_consent_purposes) <> 0
       OR p_consent->'obtained_at' <> 'null'::jsonb
       OR p_consent->'revoked_at' = 'null'::jsonb THEN
      RAISE EXCEPTION 'invalid revoked consent' USING ERRCODE = '22023';
    END IF;
    v_consent_time := (p_consent->>'revoked_at')::TIMESTAMPTZ;
  END IF;
  IF v_consent_time IS NULL
     OR NOT isfinite(v_consent_time)
     OR v_consent_time > p_occurred_at + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid consent evidence time' USING ERRCODE = '22023';
  END IF;

  -- Serialize identical event ids and contact identity merges.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::TEXT || ':' || btrim(p_company_id) || ':' || p_event_id, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::TEXT || ':' || btrim(p_company_id) || ':'
      || (p_encrypted_contact->>'phone_hash'), 1)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::TEXT || ':' || btrim(p_company_id) || ':'
      || (p_encrypted_contact->>'external_customer_hash'), 2)
  );

  SELECT * INTO v_existing_event
    FROM public.myhonor_reactivation_contact_ingest_events
   WHERE user_id = p_user_id
     AND company_id = btrim(p_company_id)
     AND source = 'myhonor.shop'
     AND event_id = p_event_id
   FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing_event.contact_id,
      CASE WHEN v_existing_event.event_hash = p_event_hash
                  AND v_existing_event.source_version = p_source_version
        THEN 'duplicate' ELSE 'conflict' END,
      v_existing_event.event_hash = p_event_hash
        AND v_existing_event.source_version = p_source_version,
      v_existing_event.event_hash <> p_event_hash
        OR v_existing_event.source_version <> p_source_version;
    RETURN;
  END IF;

  -- external_customer_hash is the immutable person anchor. A phone hash may
  -- rotate only while that same external identity remains present; it is never
  -- sufficient on its own to merge a Store event into an existing person.
  SELECT candidate.id INTO v_external_contact_id
    FROM public.myhonor_reactivation_contacts AS candidate
   WHERE candidate.user_id = p_user_id
     AND candidate.company_id = btrim(p_company_id)
     AND candidate.source = 'myhonor.shop'
     AND candidate.external_customer_hash =
       p_encrypted_contact->>'external_customer_hash';
  SELECT candidate.id INTO v_phone_contact_id
    FROM public.myhonor_reactivation_contacts AS candidate
   WHERE candidate.user_id = p_user_id
     AND candidate.company_id = btrim(p_company_id)
     AND candidate.source = 'myhonor.shop'
     AND candidate.phone_hash = p_encrypted_contact->>'phone_hash';

  IF v_external_contact_id IS NULL AND v_phone_contact_id IS NOT NULL THEN
    -- Phone-only matching can recycle a number into a different person. A guest
    -- whose external id is phone-derived must become a new identity when both
    -- values change, never mutate the prior guest through an OR match.
    RETURN QUERY SELECT NULL::UUID, 'conflict'::TEXT, FALSE, TRUE;
    RETURN;
  ELSIF v_external_contact_id IS NOT NULL
        AND v_phone_contact_id IS NOT NULL
        AND v_external_contact_id <> v_phone_contact_id THEN
    RETURN QUERY SELECT NULL::UUID, 'conflict'::TEXT, FALSE, TRUE;
    RETURN;
  END IF;

  IF v_external_contact_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_user_id::TEXT || ':' || btrim(p_company_id) || ':'
        || v_external_contact_id::TEXT || ':myhonor-reactivation-contact',
      0
    ));
    SELECT * INTO v_contact
      FROM public.myhonor_reactivation_contacts
     WHERE id = v_external_contact_id
     FOR UPDATE;

    -- source_version, not wall-clock delivery order, owns the Store state.
    -- A replay under another event id is idempotent only when its canonical
    -- hash is identical; changing a payload at an existing version conflicts.
    SELECT * INTO v_existing_version
      FROM public.myhonor_reactivation_contact_ingest_events AS ingest
     WHERE ingest.user_id = p_user_id
       AND ingest.company_id = btrim(p_company_id)
       AND ingest.source = 'myhonor.shop'
       AND ingest.contact_id = v_contact.id
       AND ingest.source_version = p_source_version
     FOR UPDATE;
    IF FOUND THEN
      RETURN QUERY SELECT
        v_contact.id,
        CASE WHEN v_existing_version.event_hash = p_event_hash
          THEN 'duplicate' ELSE 'conflict' END,
        v_existing_version.event_hash = p_event_hash,
        v_existing_version.event_hash <> p_event_hash;
      RETURN;
    END IF;

    IF p_source_version > v_contact.source_version THEN
      UPDATE public.myhonor_reactivation_contacts
         SET phone_hash = p_encrypted_contact->>'phone_hash',
             phone_ciphertext = p_encrypted_contact->>'phone_ciphertext',
             phone_masked = p_encrypted_contact->>'phone_masked',
             first_name_ciphertext = NULLIF(
               p_encrypted_contact->>'first_name_ciphertext', ''
             ),
             city_ciphertext = NULLIF(p_encrypted_contact->>'city_ciphertext', ''),
             encryption_key_version = COALESCE(
               (p_encrypted_contact->>'encryption_key_version')::SMALLINT, 1
             ),
             locale = p_encrypted_contact->>'locale',
             source_version = p_source_version,
             source_updated_at = p_occurred_at
       WHERE id = v_contact.id
       RETURNING * INTO v_contact;
      v_source_applied := TRUE;
    ELSE
      v_result := 'stale_profile';
    END IF;
  ELSE
    INSERT INTO public.myhonor_reactivation_contacts (
      user_id, company_id, external_customer_hash, phone_hash,
      phone_ciphertext, phone_masked, first_name_ciphertext, city_ciphertext,
      encryption_key_version, locale, source_version, source_updated_at
    ) VALUES (
      p_user_id,
      btrim(p_company_id),
      p_encrypted_contact->>'external_customer_hash',
      p_encrypted_contact->>'phone_hash',
      p_encrypted_contact->>'phone_ciphertext',
      p_encrypted_contact->>'phone_masked',
      NULLIF(p_encrypted_contact->>'first_name_ciphertext', ''),
      NULLIF(p_encrypted_contact->>'city_ciphertext', ''),
      COALESCE((p_encrypted_contact->>'encryption_key_version')::SMALLINT, 1),
      p_encrypted_contact->>'locale',
      p_source_version,
      p_occurred_at
    ) RETURNING * INTO v_contact;
    v_result := 'created';
    v_source_applied := TRUE;
  END IF;

  IF v_source_applied THEN
    INSERT INTO public.myhonor_reactivation_profiles (
      contact_id, user_id, company_id, interests, size_ciphertext, budget_kzt,
      club_status, customer_kind, registered_at, last_activity_at,
      last_order_at, order_count, lifetime_value_kzt, last_order_product_ids,
      abandoned_cart, club_interest, back_in_stock_product_ids,
      unresolved_complaint, marketing_hold, marketing_hold_reason,
      source_version, source_updated_at
    ) VALUES (
      v_contact.id,
      p_user_id,
      btrim(p_company_id),
      v_interests,
      NULLIF(p_encrypted_contact->>'size_ciphertext', ''),
      (p_encrypted_contact->>'budget_kzt')::BIGINT,
      p_encrypted_contact->>'club_status',
      p_encrypted_contact->>'customer_kind',
      (p_lifecycle->>'registered_at')::TIMESTAMPTZ,
      (p_lifecycle->>'last_activity_at')::TIMESTAMPTZ,
      (p_lifecycle->>'last_order_at')::TIMESTAMPTZ,
      (p_lifecycle->>'order_count')::INTEGER,
      (p_lifecycle->>'lifetime_value_kzt')::NUMERIC(18,2),
      v_last_products,
      v_cart,
      (p_lifecycle->>'club_interest')::BOOLEAN,
      v_back_in_stock_products,
      (p_lifecycle->>'unresolved_complaint')::BOOLEAN,
      (p_lifecycle->>'marketing_hold')::BOOLEAN,
      NULLIF(p_lifecycle->>'marketing_hold_reason', ''),
      p_source_version,
      p_occurred_at
    )
    ON CONFLICT (contact_id) DO UPDATE SET
      interests = EXCLUDED.interests,
      size_ciphertext = EXCLUDED.size_ciphertext,
      budget_kzt = EXCLUDED.budget_kzt,
      club_status = EXCLUDED.club_status,
      customer_kind = EXCLUDED.customer_kind,
      registered_at = EXCLUDED.registered_at,
      last_activity_at = EXCLUDED.last_activity_at,
      last_order_at = EXCLUDED.last_order_at,
      order_count = EXCLUDED.order_count,
      lifetime_value_kzt = EXCLUDED.lifetime_value_kzt,
      last_order_product_ids = EXCLUDED.last_order_product_ids,
      abandoned_cart = EXCLUDED.abandoned_cart,
      club_interest = EXCLUDED.club_interest,
      back_in_stock_product_ids = EXCLUDED.back_in_stock_product_ids,
      unresolved_complaint = EXCLUDED.unresolved_complaint,
      marketing_hold = EXCLUDED.marketing_hold,
      marketing_hold_reason = EXCLUDED.marketing_hold_reason,
      source_version = EXCLUDED.source_version,
      source_updated_at = EXCLUDED.source_updated_at
    WHERE public.myhonor_reactivation_profiles.source_version
          < EXCLUDED.source_version;
  END IF;

  IF v_source_applied AND v_consent_status = 'revoked' THEN
    v_result := 'revoked';
  END IF;

  INSERT INTO public.myhonor_reactivation_contact_ingest_events (
    user_id, company_id, event_id, event_hash, source_version, contact_id,
    occurred_at, result
  ) VALUES (
    p_user_id, btrim(p_company_id), p_event_id, p_event_hash, p_source_version,
    v_contact.id, p_occurred_at, v_result
  ) RETURNING id INTO v_ingest_id;

  INSERT INTO public.myhonor_reactivation_consent_events (
    user_id, company_id, contact_id, ingest_event_id, source_version,
    status, purposes,
    consent_source, notice_version, evidence_hash, obtained_at, revoked_at,
    cross_border_disclosed, occurred_at
  ) VALUES (
    p_user_id,
    btrim(p_company_id),
    v_contact.id,
    v_ingest_id,
    p_source_version,
    v_consent_status,
    v_consent_purposes,
    v_consent_source,
    btrim(p_consent->>'notice_version'),
    p_consent->>'evidence_hash',
    CASE WHEN v_consent_status = 'granted' THEN v_consent_time ELSE NULL END,
    CASE WHEN v_consent_status = 'revoked' THEN v_consent_time ELSE NULL END,
    (p_consent->>'cross_border_disclosed')::BOOLEAN,
    p_occurred_at
  );

  -- A verified re-opt-in clears only a prior consent_revoked suppression.
  -- Manual, legal, complaint and provider-quality suppressions remain active.
  INSERT INTO public.myhonor_reactivation_suppression_events (
    user_id, company_id, contact_id, action, reason, source_event_id,
    evidence_hash, source_version, occurred_at
  ) VALUES (
    p_user_id,
    btrim(p_company_id),
    v_contact.id,
    CASE WHEN v_consent_status = 'revoked' THEN 'suppress' ELSE 'unsuppress' END,
    'consent_revoked',
    p_event_id,
    p_consent->>'evidence_hash',
    p_source_version,
    p_occurred_at
  );

  -- Only a newly effective Store snapshot can invalidate work. First exclude
  -- campaign purposes absent from the complete consent snapshot, then exclude
  -- any remaining unsent work because lifecycle/identity facts also changed
  -- and the approved segment/recommendation must be previewed again. An older
  -- out-of-order version remains in the immutable ledgers and does neither.
  IF v_source_applied THEN
    UPDATE public.myhonor_reactivation_recipients AS recipient
       SET state = 'excluded',
           exclusion_reason = CASE WHEN v_consent_status = 'revoked'
             THEN 'global_suppression' ELSE 'missing_consent' END,
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = CASE WHEN v_consent_status = 'revoked'
             THEN 'consent_revoked' ELSE 'consent_purpose_withdrawn' END,
           last_error_at = v_now,
           completed_at = v_now
      FROM public.myhonor_reactivation_campaigns AS campaign
     WHERE recipient.contact_id = v_contact.id
       AND recipient.user_id = p_user_id
       AND recipient.company_id = btrim(p_company_id)
       AND recipient.campaign_id = campaign.id
       AND campaign.user_id = recipient.user_id
       AND campaign.company_id = recipient.company_id
       AND recipient.state IN ('preview', 'queued', 'leased')
       AND NOT EXISTS (
         SELECT 1
         FROM public.myhonor_reactivation_effective_consent AS consent
         WHERE consent.user_id = recipient.user_id
           AND consent.company_id = recipient.company_id
           AND consent.contact_id = recipient.contact_id
           AND consent.purpose = campaign.purpose
           AND consent.eligible
       );

    UPDATE public.myhonor_reactivation_recipients
       SET state = 'excluded',
           exclusion_reason = CASE
             WHEN (p_lifecycle->>'marketing_hold')::BOOLEAN
               THEN 'manual_hold'
             ELSE 'source_snapshot_changed'
           END,
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = CASE
             WHEN (p_lifecycle->>'marketing_hold')::BOOLEAN
               THEN 'manual_hold'
             ELSE 'source_snapshot_changed'
           END,
           last_error_at = v_now,
           completed_at = v_now
     WHERE contact_id = v_contact.id
       AND user_id = p_user_id
       AND company_id = btrim(p_company_id)
       AND state IN ('preview', 'queued', 'leased');
  END IF;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, action, entity_type, entity_id, details,
    occurred_at
  ) VALUES (
    p_user_id,
    btrim(p_company_id),
    'api',
    'contact.ingested',
    'contact',
    v_contact.id,
    jsonb_build_object(
      'event_hash', p_event_hash,
      'source_version', p_source_version,
      'result', v_result,
      'consent_status', v_consent_status,
      'purposes', to_jsonb(v_consent_purposes),
      'marketing_hold', (p_lifecycle->>'marketing_hold')::BOOLEAN,
      'marketing_hold_reason', p_lifecycle->'marketing_hold_reason'
    ),
    v_now
  );

  RETURN QUERY SELECT v_contact.id, v_result, FALSE, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_myhonor_reactivation_campaign(
  p_user_id UUID,
  p_company_id TEXT,
  p_definition JSONB,
  p_actor_hash TEXT
)
RETURNS TABLE (
  campaign_id UUID,
  campaign_state TEXT,
  dry_run BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign public.myhonor_reactivation_campaigns%ROWTYPE;
  v_segment TEXT;
  v_dry_run BOOLEAN;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_actor_hash IS NULL OR p_actor_hash !~ '^[a-f0-9]{64}$'
     OR p_definition IS NULL
     OR jsonb_typeof(p_definition) <> 'object'
     OR pg_column_size(p_definition) > 32768
     OR NOT p_definition ?& ARRAY[
       'name', 'segment', 'season', 'interest', 'inactivity_days', 'frequency_cap_days',
       'monthly_cap', 'daily_limit', 'holdout_percent', 'product_limit',
       'dry_run', 'utm_campaign', 'template_name', 'template_language'
     ]
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_definition) AS key_name
       WHERE key_name <> ALL(ARRAY[
         'name', 'segment', 'season', 'interest', 'inactivity_days', 'frequency_cap_days',
         'monthly_cap', 'daily_limit', 'holdout_percent', 'product_limit',
         'dry_run', 'utm_campaign', 'template_name', 'template_language',
         'eligibility_rules'
       ]::TEXT[])
     ) THEN
    RAISE EXCEPTION 'invalid campaign definition' USING ERRCODE = '22023';
  END IF;

  v_segment := p_definition->>'segment';
  v_dry_run := (p_definition->>'dry_run')::BOOLEAN;
  IF length(btrim(p_definition->>'name')) NOT BETWEEN 3 AND 160
     OR v_segment NOT IN (
       'old_lead', 'registered_no_order', 'dormant_customer', 'post_purchase',
       'seasonal', 'club_interest', 'back_in_stock', 'abandoned_cart'
     )
     OR (
       p_definition->'season' <> 'null'::jsonb
       AND p_definition->>'season' NOT IN (
         'spring', 'summer', 'autumn', 'winter', 'all_season'
       )
     )
     OR (v_segment = 'seasonal' AND p_definition->'season' = 'null'::jsonb)
     OR (
       p_definition->'interest' <> 'null'::jsonb
       AND p_definition->>'interest' NOT IN (
         'hunting', 'fishing', 'outdoor', 'mountains', 'tactical', 'footwear',
         'base_layer', 'accessories'
       )
     )
     OR (p_definition->>'inactivity_days')::INTEGER NOT BETWEEN 3 AND 730
     OR (p_definition->>'frequency_cap_days')::INTEGER NOT BETWEEN 7 AND 365
     OR (p_definition->>'monthly_cap')::INTEGER NOT BETWEEN 1 AND 3
     OR (p_definition->>'daily_limit')::INTEGER NOT BETWEEN 1 AND 100
     OR (p_definition->>'holdout_percent')::INTEGER NOT BETWEEN 0 AND 50
     OR (p_definition->>'product_limit')::INTEGER NOT BETWEEN 1 AND 3
     OR p_definition->>'utm_campaign' !~ '^[a-z0-9][a-z0-9_-]{2,99}$'
     OR jsonb_typeof(p_definition->'dry_run') <> 'boolean'
     OR (
       p_definition ? 'eligibility_rules'
       AND (
         jsonb_typeof(p_definition->'eligibility_rules') <> 'object'
         OR pg_column_size(p_definition->'eligibility_rules') > 16384
       )
     )
     OR (
       p_definition->'template_name' <> 'null'::jsonb
       AND p_definition->>'template_name' !~ '^[a-z0-9_]{1,512}$'
     )
     OR (
       p_definition->'template_language' <> 'null'::jsonb
       AND p_definition->>'template_language' !~ '^[a-z]{2,3}(?:_[A-Z]{2})?$'
     )
     OR (p_definition->'template_name' = 'null'::jsonb)
          <> (p_definition->'template_language' = 'null'::jsonb)
     OR (
       NOT v_dry_run
       AND (
         p_definition->'template_name' = 'null'::jsonb
         OR p_definition->'template_language' = 'null'::jsonb
       )
     ) THEN
    RAISE EXCEPTION 'invalid campaign values' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.myhonor_reactivation_campaigns (
    user_id, company_id, name, segment, season, purpose, interest, inactivity_days,
    frequency_cap_days, monthly_cap, daily_limit, holdout_percent,
    product_limit, template_name, template_language, utm_campaign,
    eligibility_rules, dry_run, created_by_hash
  ) VALUES (
    p_user_id,
    btrim(p_company_id),
    btrim(p_definition->>'name'),
    v_segment,
    NULLIF(p_definition->>'season', ''),
    CASE WHEN v_segment = 'club_interest'
      THEN 'club_updates' ELSE 'product_recommendations' END,
    NULLIF(p_definition->>'interest', ''),
    (p_definition->>'inactivity_days')::INTEGER,
    (p_definition->>'frequency_cap_days')::INTEGER,
    (p_definition->>'monthly_cap')::SMALLINT,
    (p_definition->>'daily_limit')::INTEGER,
    (p_definition->>'holdout_percent')::SMALLINT,
    (p_definition->>'product_limit')::SMALLINT,
    NULLIF(p_definition->>'template_name', ''),
    NULLIF(p_definition->>'template_language', ''),
    p_definition->>'utm_campaign',
    COALESCE(p_definition->'eligibility_rules', '{}'::jsonb),
    v_dry_run,
    p_actor_hash
  ) RETURNING * INTO v_campaign;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, actor_hash, action, entity_type,
    entity_id, details
  ) VALUES (
    v_campaign.user_id,
    v_campaign.company_id,
    'admin',
    p_actor_hash,
    'campaign.created',
    'campaign',
    v_campaign.id,
    jsonb_build_object(
      'segment', v_campaign.segment,
      'season', v_campaign.season,
      'purpose', v_campaign.purpose,
      'dry_run', v_campaign.dry_run
    )
  );

  RETURN QUERY SELECT v_campaign.id, v_campaign.state, v_campaign.dry_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.myhonor_reactivation_recommendation_is_live(
  p_user_id UUID,
  p_company_id TEXT,
  p_snapshot JSONB,
  p_product_limit INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_ids JSONB;
  v_products JSONB;
  v_item JSONB;
  v_variant_id UUID;
  v_live BOOLEAN;
  v_latest_price_run_id UUID;
  v_latest_inventory_run_id UUID;
  v_latest_inventory_published_at TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR p_product_limit IS NULL OR p_product_limit NOT BETWEEN 1 AND 3 THEN
    RETURN FALSE;
  END IF;
  v_product_ids := p_snapshot->'product_ids';
  v_products := p_snapshot->'products';
  IF v_product_ids IS NULL OR jsonb_typeof(v_product_ids) <> 'array'
     OR v_products IS NULL OR jsonb_typeof(v_products) <> 'array'
     OR jsonb_array_length(v_product_ids) NOT BETWEEN 1 AND p_product_limit
     OR jsonb_array_length(v_products) <> jsonb_array_length(v_product_ids)
     OR (
       SELECT count(DISTINCT product_id)
       FROM jsonb_array_elements_text(v_product_ids) AS product_id
     ) <> jsonb_array_length(v_product_ids)
     OR (
       SELECT count(DISTINCT item->>'productId')
       FROM jsonb_array_elements(v_products) AS item
     ) <> jsonb_array_length(v_product_ids)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(v_product_ids) AS product_id
       WHERE product_id !~ '^myhonor:[a-f0-9]{64}$'
     ) THEN
    RETURN FALSE;
  END IF;

  SELECT run.id INTO v_latest_price_run_id
    FROM public.store_import_runs AS run
   WHERE run.user_id = p_user_id
     AND run.company_id = btrim(p_company_id)
     AND run.import_kind = 'prices'
     AND run.status = 'published'
     AND run.published_at IS NOT NULL
   ORDER BY run.published_at DESC NULLS LAST, run.created_at DESC, run.id DESC
   LIMIT 1;
  SELECT run.id, run.published_at
    INTO v_latest_inventory_run_id, v_latest_inventory_published_at
    FROM public.store_import_runs AS run
   WHERE run.user_id = p_user_id
     AND run.company_id = btrim(p_company_id)
     AND run.import_kind = 'inventory'
     AND run.status = 'published'
     AND run.published_at IS NOT NULL
   ORDER BY run.published_at DESC NULLS LAST, run.created_at DESC, run.id DESC
   LIMIT 1;
  IF v_latest_inventory_run_id IS NULL
     OR v_latest_inventory_published_at IS NULL
     OR v_latest_inventory_published_at < now() - interval '48 hours' THEN
    RETURN FALSE;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_products)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NOT (v_item ?& ARRAY[
         'productId', 'variantId', 'priceKzt', 'canonicalUrl',
         'warehouseCode', 'availableQuantity'
       ])
       OR v_item->>'productId' !~ '^myhonor:[a-f0-9]{64}$'
       OR v_item->>'variantId'
            !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_item->'priceKzt') <> 'number'
       OR (v_item->>'priceKzt')::NUMERIC NOT BETWEEN 0.01 AND 100000000
       OR v_item->>'canonicalUrl' NOT LIKE 'https://myhonor.shop/product/%'
       OR length(btrim(v_item->>'warehouseCode')) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(v_item->'availableQuantity') <> 'number'
       OR (v_item->>'availableQuantity')::NUMERIC <= 0
       OR NOT (v_product_ids ? (v_item->>'productId')) THEN
      RETURN FALSE;
    END IF;

    BEGIN
      v_variant_id := (v_item->>'variantId')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RETURN FALSE;
    END;

    -- A published import is a complete snapshot: every item must exist in the
    -- single newest inventory run, so a missing sold-out variant cannot fall
    -- back to an older positive row. The newest price run is handled the same
    -- way; its missing/null retail price falls back only to the fresh, KZT,
    -- server-owned ecommerce_products.price used by catalog.ts.
    SELECT EXISTS (
      SELECT 1
      FROM public.ecommerce_products AS product
      JOIN public.store_product_variants AS variant
        ON variant.ecommerce_product_id = product.id
       AND variant.user_id = product.user_id
       AND variant.company_id = product.company_id
      WHERE product.user_id = p_user_id
        AND product.company_id = btrim(p_company_id)
        AND product.source = 'myhonor.shop'
        AND product.external_id = v_item->>'productId'
        AND product.catalog_active
        AND product.availability = 'in_stock'
        AND product.currency = 'KZT'
        AND product.price > 0
        AND product.catalog_synced_at >= now() - interval '168 hours'
        AND product.url = v_item->>'canonicalUrl'
        AND variant.id = v_variant_id
        AND variant.is_active
        AND COALESCE((
          SELECT price.retail_price
          FROM public.store_price_snapshots AS price
          WHERE price.variant_id = variant.id
            AND price.user_id = p_user_id
            AND price.company_id = btrim(p_company_id)
            AND price.import_run_id = v_latest_price_run_id
          ORDER BY price.snapshot_date DESC, price.created_at DESC, price.id DESC
          LIMIT 1
        ), product.price) = (v_item->>'priceKzt')::NUMERIC
        AND COALESCE((
          SELECT inventory.quantity_available - inventory.quantity_reserved
          FROM public.store_inventory_snapshots AS inventory
          JOIN public.store_warehouses AS warehouse
            ON warehouse.id = inventory.warehouse_id
           AND warehouse.user_id = inventory.user_id
           AND warehouse.company_id = inventory.company_id
          WHERE inventory.variant_id = variant.id
            AND inventory.user_id = p_user_id
            AND inventory.company_id = btrim(p_company_id)
            AND inventory.import_run_id = v_latest_inventory_run_id
            AND warehouse.is_active
            AND warehouse.code = v_item->>'warehouseCode'
          ORDER BY inventory.snapshot_date DESC, inventory.created_at DESC,
                   inventory.id DESC
          LIMIT 1
        ), 0) > 0
    ) INTO v_live;
    IF NOT COALESCE(v_live, FALSE) THEN RETURN FALSE; END IF;
  END LOOP;

  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.materialize_myhonor_reactivation_campaign(
  p_campaign_id UUID,
  p_candidates JSONB,
  p_actor_hash TEXT,
  p_template_contract_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
  inserted_count INTEGER,
  queued_count INTEGER,
  preview_count INTEGER,
  holdout_count INTEGER,
  excluded_count INTEGER,
  preview_snapshot_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign public.myhonor_reactivation_campaigns%ROWTYPE;
  v_candidate JSONB;
  v_contact public.myhonor_reactivation_contacts%ROWTYPE;
  v_profile public.myhonor_reactivation_profiles%ROWTYPE;
  v_consent RECORD;
  v_suppression RECORD;
  v_consent_snapshot JSONB;
  v_consent_hash TEXT;
  v_eligibility_hash TEXT;
  v_recommendation_hash TEXT;
  v_product_ids JSONB;
  v_last_sent TIMESTAMPTZ;
  v_monthly_count INTEGER;
  v_bucket SMALLINT;
  v_is_holdout BOOLEAN;
  v_state TEXT;
  v_exclusion TEXT;
  v_run_at TIMESTAMPTZ;
  v_inserted INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_inserted_count INTEGER := 0;
  v_queued_count INTEGER := 0;
  v_preview_count INTEGER := 0;
  v_holdout_count INTEGER := 0;
  v_excluded_count INTEGER := 0;
  v_preview_snapshot_hash TEXT;
BEGIN
  IF p_campaign_id IS NULL
     OR p_actor_hash IS NULL OR p_actor_hash !~ '^[a-f0-9]{64}$'
     OR p_candidates IS NULL
     OR jsonb_typeof(p_candidates) <> 'array'
     OR jsonb_array_length(p_candidates) > 10000
     OR pg_column_size(p_candidates) > 8388608 THEN
    RAISE EXCEPTION 'invalid campaign candidates' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_campaign
    FROM public.myhonor_reactivation_campaigns
   WHERE id = p_campaign_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_campaign.state <> 'draft' THEN
    RAISE EXCEPTION 'only draft campaigns can be materialized'
      USING ERRCODE = '55000';
  END IF;

  -- Only the server-side Meta preflight may supply this digest through the
  -- service-role RPC. It binds the exact template components/parameter order
  -- to the preview; after the first preview a changed contract requires a new
  -- campaign instead of silently changing an already-reviewed message.
  IF (v_campaign.template_name IS NULL) <> (v_campaign.template_language IS NULL)
     OR (
       v_campaign.template_name IS NULL
       AND p_template_contract_hash IS NOT NULL
     )
     OR (
       v_campaign.template_name IS NOT NULL
       AND (
         p_template_contract_hash IS NULL
         OR p_template_contract_hash !~ '^[a-f0-9]{64}$'
       )
     ) THEN
    RAISE EXCEPTION 'invalid verified template contract'
      USING ERRCODE = '22023';
  END IF;
  IF v_campaign.preview_snapshot_hash IS NOT NULL
     AND v_campaign.template_contract_hash
       IS DISTINCT FROM p_template_contract_hash THEN
    RAISE EXCEPTION 'template contract is immutable after preview'
      USING ERRCODE = '55000';
  END IF;
  UPDATE public.myhonor_reactivation_campaigns
     SET template_contract_hash = p_template_contract_hash
   WHERE id = v_campaign.id
   RETURNING * INTO v_campaign;

  -- A preview is a complete revision, not an append to a stale snapshot.
  -- Draft recipients have never crossed the provider boundary, so replacing
  -- them under the locked campaign row is safe and keeps approval reviewable.
  DELETE FROM public.myhonor_reactivation_recipients
   WHERE campaign_id = v_campaign.id;

  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_candidates)
  LOOP
    IF jsonb_typeof(v_candidate) <> 'object'
       OR NOT v_candidate ?& ARRAY[
         'contact_id', 'eligibility_snapshot', 'eligibility_hash',
         'recommendation_snapshot', 'recommendation_hash',
         'template_parameters_ciphertext', 'template_parameters_hash', 'run_at'
       ]
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(v_candidate) AS key_name
         WHERE key_name <> ALL(ARRAY[
           'contact_id', 'eligibility_snapshot', 'eligibility_hash',
           'recommendation_snapshot', 'recommendation_hash',
           'template_parameters_ciphertext', 'template_parameters_hash', 'run_at'
         ]::TEXT[])
       )
       OR jsonb_typeof(v_candidate->'eligibility_snapshot') <> 'object'
       OR pg_column_size(v_candidate->'eligibility_snapshot') > 32768
       OR NOT (v_candidate->'eligibility_snapshot' ?& ARRAY[
         'eligible', 'exclusions', 'segment_match', 'marketing_hold_reason',
         'source_updated_at'
       ])
       OR jsonb_typeof(v_candidate->'eligibility_snapshot'->'eligible') <> 'boolean'
       OR jsonb_typeof(v_candidate->'eligibility_snapshot'->'segment_match') <> 'boolean'
       OR jsonb_typeof(v_candidate->'eligibility_snapshot'->'exclusions') <> 'array'
       OR jsonb_typeof(
         v_candidate->'eligibility_snapshot'->'source_updated_at'
       ) <> 'string'
       OR (
         v_candidate->'eligibility_snapshot'->'marketing_hold_reason'
           <> 'null'::jsonb
         AND (
           jsonb_typeof(
             v_candidate->'eligibility_snapshot'->'marketing_hold_reason'
           ) <> 'string'
           OR v_candidate->'eligibility_snapshot'->>'marketing_hold_reason'
             NOT IN (
               'open_order', 'recent_cancel_or_return', 'payment_unknown',
               'source_incomplete', 'identity_conflict', 'manual_review'
             )
         )
       )
       OR jsonb_array_length(
         v_candidate->'eligibility_snapshot'->'exclusions'
       ) > 32
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(
           v_candidate->'eligibility_snapshot'->'exclusions'
         ) AS exclusion
         WHERE length(exclusion) NOT BETWEEN 1 AND 120
            OR exclusion !~ '^[a-z0-9][a-z0-9._:-]*$'
       )
       OR v_candidate->>'eligibility_hash' !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(v_candidate->'recommendation_snapshot') <> 'object'
       OR pg_column_size(v_candidate->'recommendation_snapshot') > 32768
       OR v_candidate->>'recommendation_hash' !~ '^[a-f0-9]{64}$'
       OR v_candidate->>'template_parameters_ciphertext'
            !~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
       OR length(v_candidate->>'template_parameters_ciphertext') NOT BETWEEN 20 AND 8192
       OR v_candidate->>'template_parameters_hash' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'invalid candidate payload' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_run_at := (v_candidate->>'run_at')::TIMESTAMPTZ;
      IF NOT isfinite(v_run_at) THEN
        RAISE EXCEPTION 'non-finite run_at';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid candidate run_at' USING ERRCODE = '22023';
    END;

    v_eligibility_hash := encode(sha256(convert_to(
      public.myhonor_reactivation_canonical_jsonb(
        v_candidate->'eligibility_snapshot'
      ), 'UTF8'
    )), 'hex');
    v_recommendation_hash := encode(sha256(convert_to(
      public.myhonor_reactivation_canonical_jsonb(
        v_candidate->'recommendation_snapshot'
      ), 'UTF8'
    )), 'hex');
    IF v_candidate->>'eligibility_hash' <> v_eligibility_hash
       OR v_candidate->>'recommendation_hash' <> v_recommendation_hash THEN
      RAISE EXCEPTION 'candidate snapshot hash mismatch' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
      v_campaign.user_id::TEXT || ':' || v_campaign.company_id || ':'
        || (v_candidate->>'contact_id') || ':myhonor-reactivation-contact',
      0
    ));
    SELECT * INTO v_contact
      FROM public.myhonor_reactivation_contacts
     WHERE id = (v_candidate->>'contact_id')::UUID
       AND user_id = v_campaign.user_id
       AND company_id = v_campaign.company_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'candidate contact does not belong to campaign owner'
        USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_profile
      FROM public.myhonor_reactivation_profiles
     WHERE contact_id = v_contact.id;

    SELECT * INTO v_suppression
      FROM public.myhonor_reactivation_effective_suppressions
     WHERE user_id = v_campaign.user_id
       AND company_id = v_campaign.company_id
       AND contact_id = v_contact.id;

    SELECT * INTO v_consent
      FROM public.myhonor_reactivation_effective_consent
     WHERE user_id = v_campaign.user_id
       AND company_id = v_campaign.company_id
       AND contact_id = v_contact.id
       AND purpose = v_campaign.purpose;

    v_consent_snapshot := jsonb_build_object(
      'purpose', v_campaign.purpose,
      'consent_event_id', CASE WHEN v_consent.consent_event_id IS NULL
        THEN NULL ELSE v_consent.consent_event_id END,
      'source_version', v_consent.source_version,
      'status', COALESCE(v_consent.status, 'missing'),
      'source', v_consent.consent_source,
      'notice_version', v_consent.notice_version,
      'obtained_at', v_consent.obtained_at,
      'cross_border_disclosed', COALESCE(v_consent.cross_border_disclosed, FALSE),
      'eligible', COALESCE(v_consent.eligible, FALSE),
      'active_suppressions', COALESCE(
        to_jsonb(v_suppression.active_reasons), '[]'::jsonb
      ),
      'captured_at', v_now
    );
    v_consent_hash := encode(
      sha256(convert_to(v_consent_snapshot::TEXT, 'UTF8')), 'hex'
    );

    v_exclusion := NULL;
    IF v_profile.contact_id IS NULL OR v_profile.unresolved_complaint THEN
      v_exclusion := 'unresolved_complaint';
    ELSIF v_profile.marketing_hold
       OR COALESCE(
         v_suppression.active_reasons
           && ARRAY['manual', 'legal', 'unresolved_complaint']::TEXT[], FALSE
       ) THEN
      v_exclusion := 'manual_hold';
    ELSIF v_contact.source_updated_at IS NULL
       OR v_profile.source_updated_at IS NULL
       OR v_contact.source_updated_at < v_now - interval '24 hours'
       OR v_profile.source_updated_at < v_now - interval '24 hours' THEN
      v_exclusion := 'source_snapshot_stale';
    ELSIF v_suppression.contact_id IS NOT NULL THEN
      v_exclusion := 'global_suppression';
    ELSIF NOT COALESCE(v_consent.eligible, FALSE) THEN
      v_exclusion := 'missing_consent';
    ELSIF NOT (v_candidate->'eligibility_snapshot'->>'eligible')::BOOLEAN
       OR NOT (v_candidate->'eligibility_snapshot'->>'segment_match')::BOOLEAN
       OR jsonb_array_length(
         v_candidate->'eligibility_snapshot'->'exclusions'
       ) > 0 THEN
      v_exclusion := 'application_ineligible';
    ELSIF v_profile.provider_cooldown_until > v_now THEN
      v_exclusion := 'provider_cooldown';
    END IF;

    v_product_ids := v_candidate->'recommendation_snapshot'->'product_ids';
    IF v_exclusion IS NULL AND v_campaign.purpose = 'product_recommendations' THEN
      IF v_product_ids IS NULL
         OR jsonb_typeof(v_product_ids) <> 'array'
         OR jsonb_array_length(v_product_ids) NOT BETWEEN 1 AND v_campaign.product_limit
         OR jsonb_typeof(
           v_candidate->'recommendation_snapshot'->'products'
         ) <> 'array'
         OR jsonb_array_length(
           v_candidate->'recommendation_snapshot'->'products'
         ) <> jsonb_array_length(v_product_ids)
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(v_product_ids) AS product_id
           WHERE product_id !~ '^myhonor:[a-f0-9]{64}$'
         ) THEN
        v_exclusion := 'invalid_recommendation';
      ELSE
        IF NOT public.myhonor_reactivation_recommendation_is_live(
          v_campaign.user_id,
          v_campaign.company_id,
          v_candidate->'recommendation_snapshot',
          v_campaign.product_limit
        ) THEN
          v_exclusion := 'inactive_product';
        END IF;
      END IF;
    END IF;

    IF v_exclusion IS NULL AND v_campaign.segment = 'abandoned_cart' AND (
      v_profile.abandoned_cart IS NULL
      OR NOT COALESCE((v_profile.abandoned_cart->>'active')::BOOLEAN, FALSE)
      OR jsonb_typeof(v_profile.abandoned_cart->'product_ids') <> 'array'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_product_ids) AS product_id
        WHERE NOT (v_profile.abandoned_cart->'product_ids' ? product_id)
      )
    ) THEN
      v_exclusion := 'application_ineligible';
    END IF;

    SELECT max(COALESCE(
             provider_accepted_at,
             CASE WHEN state IN ('authorized', 'delivery_unknown')
               THEN authorized_at END
           )),
           count(*) FILTER (
             WHERE COALESCE(
               provider_accepted_at,
               CASE WHEN state IN ('authorized', 'delivery_unknown')
                 THEN authorized_at END
             ) >= v_now - interval '30 days'
           )::INTEGER
      INTO v_last_sent, v_monthly_count
      FROM public.myhonor_reactivation_recipients
     WHERE contact_id = v_contact.id
       AND user_id = v_campaign.user_id
       AND company_id = v_campaign.company_id
       AND (
         provider_accepted_at IS NOT NULL
         OR (state IN ('authorized', 'delivery_unknown') AND authorized_at IS NOT NULL)
       );
    IF v_exclusion IS NULL
       AND v_last_sent IS NOT NULL
       AND v_last_sent > v_now - make_interval(days => v_campaign.frequency_cap_days) THEN
      v_exclusion := 'frequency_cap';
    ELSIF v_exclusion IS NULL AND v_monthly_count >= v_campaign.monthly_cap THEN
      v_exclusion := 'monthly_frequency_cap';
    END IF;

    v_bucket := (
      (hashtextextended(v_campaign.id::TEXT || ':' || v_contact.phone_hash, 0)
        & 9223372036854775807) % 100
    )::SMALLINT;
    v_is_holdout := v_exclusion IS NULL
      AND v_bucket < v_campaign.holdout_percent;
    v_state := CASE
      WHEN v_exclusion IS NOT NULL THEN 'excluded'
      WHEN v_campaign.dry_run THEN 'preview'
      WHEN v_is_holdout THEN 'holdout'
      ELSE 'queued'
    END;

    INSERT INTO public.myhonor_reactivation_recipients (
      campaign_id, contact_id, user_id, company_id, send_idempotency_key,
      phone_hash_snapshot, phone_ciphertext_snapshot, locale_snapshot,
      contact_source_version_snapshot, profile_source_version_snapshot,
      eligibility_snapshot, eligibility_hash, recommendation_snapshot,
      recommendation_hash, consent_snapshot, consent_source_version_snapshot,
      consent_hash, template_parameters_ciphertext, template_parameters_hash,
      holdout_bucket, is_holdout, state,
      exclusion_reason, run_at, completed_at
    ) VALUES (
      v_campaign.id,
      v_contact.id,
      v_campaign.user_id,
      v_campaign.company_id,
      encode(sha256(convert_to(
        v_campaign.id::TEXT || ':' || v_contact.id::TEXT, 'UTF8'
      )), 'hex'),
      v_contact.phone_hash,
      v_contact.phone_ciphertext,
      v_contact.locale,
      v_contact.source_version,
      v_profile.source_version,
      v_candidate->'eligibility_snapshot',
      v_eligibility_hash,
      v_candidate->'recommendation_snapshot',
      v_recommendation_hash,
      v_consent_snapshot,
      v_consent.source_version,
      v_consent_hash,
      v_candidate->>'template_parameters_ciphertext',
      v_candidate->>'template_parameters_hash',
      v_bucket,
      v_is_holdout,
      v_state,
      v_exclusion,
      GREATEST(v_run_at, v_now),
      CASE WHEN v_state IN ('holdout', 'excluded') THEN v_now ELSE NULL END
    )
    ON CONFLICT (campaign_id, contact_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      v_inserted_count := v_inserted_count + 1;
      IF v_state = 'queued' THEN v_queued_count := v_queued_count + 1; END IF;
      IF v_state = 'preview' THEN v_preview_count := v_preview_count + 1; END IF;
      IF v_state = 'holdout' THEN v_holdout_count := v_holdout_count + 1; END IF;
      IF v_state = 'excluded' THEN v_excluded_count := v_excluded_count + 1; END IF;
    END IF;
  END LOOP;

  SELECT encode(sha256(convert_to(jsonb_build_object(
    'definition', jsonb_build_object(
      'id', v_campaign.id,
      'user_id', v_campaign.user_id,
      'company_id', v_campaign.company_id,
      'name', v_campaign.name,
      'segment', v_campaign.segment,
      'season', v_campaign.season,
      'purpose', v_campaign.purpose,
      'interest', v_campaign.interest,
      'inactivity_days', v_campaign.inactivity_days,
      'frequency_cap_days', v_campaign.frequency_cap_days,
      'monthly_cap', v_campaign.monthly_cap,
      'daily_limit', v_campaign.daily_limit,
      'holdout_percent', v_campaign.holdout_percent,
      'product_limit', v_campaign.product_limit,
      'template_name', v_campaign.template_name,
      'template_language', v_campaign.template_language,
      'template_contract_hash', v_campaign.template_contract_hash,
      'utm_campaign', v_campaign.utm_campaign,
      'eligibility_rules', v_campaign.eligibility_rules,
      'dry_run', v_campaign.dry_run
    ),
    'recipients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'contact_id', recipient.contact_id,
        'send_idempotency_key', recipient.send_idempotency_key,
        'phone_hash_snapshot', recipient.phone_hash_snapshot,
        'locale_snapshot', recipient.locale_snapshot,
        'contact_source_version_snapshot', recipient.contact_source_version_snapshot,
        'profile_source_version_snapshot', recipient.profile_source_version_snapshot,
        'eligibility_hash', recipient.eligibility_hash,
        'recommendation_hash', recipient.recommendation_hash,
        'consent_source_version_snapshot', recipient.consent_source_version_snapshot,
        'consent_hash', recipient.consent_hash,
        'template_parameters_hash', recipient.template_parameters_hash,
        'holdout_bucket', recipient.holdout_bucket,
        'is_holdout', recipient.is_holdout,
        'state', recipient.state,
        'exclusion_reason', recipient.exclusion_reason,
        'run_at', recipient.run_at
      ) ORDER BY recipient.contact_id)
      FROM public.myhonor_reactivation_recipients AS recipient
      WHERE recipient.campaign_id = v_campaign.id
    ), '[]'::jsonb)
  )::TEXT, 'UTF8')), 'hex')
  INTO v_preview_snapshot_hash;

  UPDATE public.myhonor_reactivation_campaigns
     SET preview_snapshot_hash = v_preview_snapshot_hash
   WHERE id = v_campaign.id;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, actor_hash, action, entity_type,
    entity_id, details
  ) VALUES (
    v_campaign.user_id,
    v_campaign.company_id,
    'admin',
    p_actor_hash,
    'campaign.materialized',
    'campaign',
    v_campaign.id,
    jsonb_build_object(
      'inserted', v_inserted_count,
      'queued', v_queued_count,
      'preview', v_preview_count,
      'holdout', v_holdout_count,
      'excluded', v_excluded_count,
      'preview_snapshot_hash', v_preview_snapshot_hash,
      'template_contract_hash', v_campaign.template_contract_hash
    )
  );

  RETURN QUERY SELECT
    v_inserted_count, v_queued_count, v_preview_count, v_holdout_count,
    v_excluded_count, v_preview_snapshot_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_myhonor_reactivation_campaign(
  p_campaign_id UUID,
  p_target_state TEXT,
  p_actor_hash TEXT,
  p_approval_snapshot_hash TEXT DEFAULT NULL,
  p_template_contract_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
  changed BOOLEAN,
  campaign_state TEXT,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign public.myhonor_reactivation_campaigns%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER;
BEGIN
  IF p_campaign_id IS NULL
     OR p_target_state NOT IN ('approved', 'running', 'paused', 'completed')
     OR p_actor_hash IS NULL OR p_actor_hash !~ '^[a-f0-9]{64}$'
     OR p_approval_snapshot_hash IS NOT NULL
        AND p_approval_snapshot_hash !~ '^[a-f0-9]{64}$'
     OR p_template_contract_hash IS NOT NULL
        AND p_template_contract_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid campaign transition' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_campaign
    FROM public.myhonor_reactivation_campaigns
   WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'not_found'::TEXT;
    RETURN;
  END IF;
  -- Serialize tenant-level lifecycle transitions so two campaigns cannot both
  -- pass the single-running-campaign check concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_campaign.user_id::TEXT || ':' || v_campaign.company_id
      || ':myhonor-reactivation-running',
    0
  ));
  SELECT * INTO v_campaign
    FROM public.myhonor_reactivation_campaigns
   WHERE id = p_campaign_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'not_found'::TEXT;
    RETURN;
  END IF;
  IF p_target_state IN ('approved', 'running') AND (
    (v_campaign.template_name IS NULL) <> (v_campaign.template_language IS NULL)
    OR (
      v_campaign.template_name IS NULL
      AND (
        v_campaign.template_contract_hash IS NOT NULL
        OR p_template_contract_hash IS NOT NULL
      )
    )
    OR (
      v_campaign.template_name IS NOT NULL
      AND (
        v_campaign.template_contract_hash IS NULL
        OR p_template_contract_hash IS NULL
        OR p_template_contract_hash <> v_campaign.template_contract_hash
      )
    )
  ) THEN
    RETURN QUERY SELECT
      FALSE, v_campaign.state, 'template_contract_hash_mismatch'::TEXT;
    RETURN;
  END IF;
  IF v_campaign.state = p_target_state THEN
    IF p_target_state = 'running' AND (
      p_approval_snapshot_hash IS NULL
      OR p_approval_snapshot_hash <> v_campaign.approval_snapshot_hash
      OR p_approval_snapshot_hash <> v_campaign.preview_snapshot_hash
    ) THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'approval_hash_mismatch'::TEXT;
      RETURN;
    END IF;
    RETURN QUERY SELECT FALSE, v_campaign.state, 'already_in_state'::TEXT;
    RETURN;
  END IF;

  IF p_target_state = 'approved' THEN
    IF v_campaign.state <> 'draft' THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'invalid_transition'::TEXT;
      RETURN;
    END IF;
    IF p_approval_snapshot_hash IS NULL THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'approval_hash_required'::TEXT;
      RETURN;
    END IF;
    IF v_campaign.preview_snapshot_hash IS NULL
       OR p_approval_snapshot_hash <> v_campaign.preview_snapshot_hash THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'preview_hash_mismatch'::TEXT;
      RETURN;
    END IF;
    IF NOT v_campaign.dry_run
       AND (v_campaign.template_name IS NULL OR v_campaign.template_language IS NULL) THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'template_required'::TEXT;
      RETURN;
    END IF;
    SELECT count(*)::INTEGER INTO v_count
      FROM public.myhonor_reactivation_recipients
     WHERE campaign_id = v_campaign.id;
    IF v_count = 0 THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'materialization_required'::TEXT;
      RETURN;
    END IF;
    UPDATE public.myhonor_reactivation_campaigns
       SET state = 'approved',
           approval_snapshot_hash = p_approval_snapshot_hash,
           approved_by_hash = p_actor_hash,
           approved_at = v_now
     WHERE id = v_campaign.id
     RETURNING * INTO v_campaign;
  ELSIF p_target_state = 'running' THEN
    IF v_campaign.state NOT IN ('approved', 'paused') THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'invalid_transition'::TEXT;
      RETURN;
    END IF;
    IF v_campaign.dry_run THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'dry_run_cannot_run'::TEXT;
      RETURN;
    END IF;
    IF p_approval_snapshot_hash IS NULL
       OR p_approval_snapshot_hash <> v_campaign.approval_snapshot_hash
       OR p_approval_snapshot_hash <> v_campaign.preview_snapshot_hash THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'approval_hash_mismatch'::TEXT;
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.myhonor_reactivation_campaigns AS other_campaign
      WHERE other_campaign.user_id = v_campaign.user_id
        AND other_campaign.company_id = v_campaign.company_id
        AND other_campaign.id <> v_campaign.id
        AND other_campaign.state = 'running'
    ) THEN
      RETURN QUERY SELECT
        FALSE, v_campaign.state, 'another_campaign_running'::TEXT;
      RETURN;
    END IF;
    SELECT count(*)::INTEGER INTO v_count
      FROM public.myhonor_reactivation_recipients
     WHERE campaign_id = v_campaign.id AND state = 'queued';
    IF v_count = 0 THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'no_queued_recipients'::TEXT;
      RETURN;
    END IF;
    UPDATE public.myhonor_reactivation_campaigns
       SET state = 'running',
           started_at = COALESCE(started_at, v_now),
           paused_at = NULL
     WHERE id = v_campaign.id
     RETURNING * INTO v_campaign;
  ELSIF p_target_state = 'paused' THEN
    IF v_campaign.state <> 'running' THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'invalid_transition'::TEXT;
      RETURN;
    END IF;
    UPDATE public.myhonor_reactivation_campaigns
       SET state = 'paused', paused_at = v_now
     WHERE id = v_campaign.id
     RETURNING * INTO v_campaign;
  ELSE
    IF v_campaign.state NOT IN ('approved', 'running', 'paused') THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'invalid_transition'::TEXT;
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.myhonor_reactivation_recipients
       WHERE campaign_id = v_campaign.id AND state IN ('leased', 'authorized')
    ) THEN
      RETURN QUERY SELECT FALSE, v_campaign.state, 'active_delivery_lease'::TEXT;
      RETURN;
    END IF;
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'cancelled',
           completed_at = v_now,
           last_error_code = 'campaign_completed',
           last_error_at = v_now
     WHERE campaign_id = v_campaign.id AND state IN ('preview', 'queued');
    UPDATE public.myhonor_reactivation_campaigns
       SET state = 'completed', completed_at = v_now
     WHERE id = v_campaign.id
     RETURNING * INTO v_campaign;
  END IF;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, actor_hash, action, entity_type,
    entity_id, details
  ) VALUES (
    v_campaign.user_id,
    v_campaign.company_id,
    'admin',
    p_actor_hash,
    'campaign.' || v_campaign.state,
    'campaign',
    v_campaign.id,
    jsonb_build_object(
      'state', v_campaign.state,
      'template_contract_hash', v_campaign.template_contract_hash
    )
  );

  RETURN QUERY SELECT TRUE, v_campaign.state, 'ok'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_myhonor_reactivation_candidate_context(
  p_user_id UUID,
  p_company_id TEXT,
  p_campaign_id UUID,
  p_limit INTEGER DEFAULT 500
)
RETURNS TABLE (
  contact_id UUID,
  locale TEXT,
  phone_validated BOOLEAN,
  city_ciphertext TEXT,
  interests TEXT[],
  size_ciphertext TEXT,
  budget_kzt BIGINT,
  club_status TEXT,
  customer_kind TEXT,
  registered_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  last_order_at TIMESTAMPTZ,
  order_count INTEGER,
  lifetime_value_kzt NUMERIC,
  last_order_product_ids JSONB,
  abandoned_cart JSONB,
  club_interest BOOLEAN,
  back_in_stock_product_ids JSONB,
  unresolved_complaint BOOLEAN,
  source_updated_at TIMESTAMPTZ,
  marketing_hold BOOLEAN,
  marketing_hold_reason TEXT,
  effective_consent JSONB,
  active_suppressions TEXT[],
  manual_hold BOOLEAN,
  provider_marketing_limited BOOLEAN,
  cooldown_until TIMESTAMPTZ,
  last_marketing_sent_at TIMESTAMPTZ,
  marketing_sent_last_30_days INTEGER,
  campaign_definition JSONB,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign public.myhonor_reactivation_campaigns%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_campaign_id IS NULL
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'invalid candidate context request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_campaign
    FROM public.myhonor_reactivation_campaigns
   WHERE id = p_campaign_id
     AND user_id = p_user_id
     AND company_id = btrim(p_company_id);
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    contact.id,
    contact.locale,
    (
      contact.phone_hash ~ '^[a-f0-9]{64}$'
      AND contact.phone_ciphertext ~ '^v[0-9]+:[A-Za-z0-9+/]+={0,2}$'
      AND contact.phone_masked ~ '^\+[0-9]{1,3}•{4,10}[0-9]{4}$'
    ),
    contact.city_ciphertext,
    profile.interests,
    profile.size_ciphertext,
    profile.budget_kzt,
    profile.club_status,
    profile.customer_kind,
    profile.registered_at,
    profile.last_activity_at,
    profile.last_order_at,
    profile.order_count,
    profile.lifetime_value_kzt,
    profile.last_order_product_ids,
    profile.abandoned_cart,
    profile.club_interest,
    profile.back_in_stock_product_ids,
    profile.unresolved_complaint,
    LEAST(contact.source_updated_at, profile.source_updated_at),
    profile.marketing_hold,
    profile.marketing_hold_reason,
    jsonb_build_object(
      'purpose', v_campaign.purpose,
      'consent_event_id', consent.consent_event_id,
      'source_version', consent.source_version,
      'status', COALESCE(consent.status, 'missing'),
      'source', consent.consent_source,
      'notice_version', consent.notice_version,
      'obtained_at', consent.obtained_at,
      'cross_border_disclosed', COALESCE(consent.cross_border_disclosed, FALSE),
      'eligible', COALESCE(consent.eligible, FALSE)
    ),
    COALESCE(suppression.active_reasons, ARRAY[]::TEXT[]),
    (
      profile.marketing_hold
      OR COALESCE(
        suppression.active_reasons
          && ARRAY['manual', 'legal', 'unresolved_complaint']::TEXT[], FALSE
      )
    ),
    (
      COALESCE('provider_quality' = ANY(suppression.active_reasons), FALSE)
      OR COALESCE(profile.provider_cooldown_until > clock_timestamp(), FALSE)
    ),
    GREATEST(
      profile.provider_cooldown_until,
      frequency.last_sent_at + make_interval(days => v_campaign.frequency_cap_days)
    ),
    frequency.last_sent_at,
    COALESCE(frequency.sent_last_30_days, 0),
    jsonb_build_object(
      'id', v_campaign.id,
      'name', v_campaign.name,
      'segment', v_campaign.segment,
      'season', v_campaign.season,
      'purpose', v_campaign.purpose,
      'interest', v_campaign.interest,
      'inactivity_days', v_campaign.inactivity_days,
      'frequency_cap_days', v_campaign.frequency_cap_days,
      'monthly_cap', v_campaign.monthly_cap,
      'daily_limit', v_campaign.daily_limit,
      'holdout_percent', v_campaign.holdout_percent,
      'product_limit', v_campaign.product_limit,
      'utm_campaign', v_campaign.utm_campaign,
      'template_name', v_campaign.template_name,
      'template_language', v_campaign.template_language,
      'template_contract_hash', v_campaign.template_contract_hash,
      'eligibility_rules', v_campaign.eligibility_rules,
      'dry_run', v_campaign.dry_run,
      'state', v_campaign.state
    ),
    count(*) OVER ()
  FROM public.myhonor_reactivation_contacts AS contact
  JOIN public.myhonor_reactivation_profiles AS profile
    ON profile.contact_id = contact.id
   AND profile.user_id = contact.user_id
   AND profile.company_id = contact.company_id
  LEFT JOIN public.myhonor_reactivation_effective_consent AS consent
    ON consent.contact_id = contact.id
   AND consent.user_id = contact.user_id
   AND consent.company_id = contact.company_id
   AND consent.purpose = v_campaign.purpose
  LEFT JOIN public.myhonor_reactivation_effective_suppressions AS suppression
    ON suppression.contact_id = contact.id
   AND suppression.user_id = contact.user_id
   AND suppression.company_id = contact.company_id
  LEFT JOIN LATERAL (
    SELECT
      max(COALESCE(
        recipient.provider_accepted_at,
        CASE WHEN recipient.state IN ('authorized', 'delivery_unknown')
          THEN recipient.authorized_at END
      )) AS last_sent_at,
      count(*) FILTER (
        WHERE COALESCE(
          recipient.provider_accepted_at,
          CASE WHEN recipient.state IN ('authorized', 'delivery_unknown')
            THEN recipient.authorized_at END
        ) >= clock_timestamp() - interval '30 days'
      )::INTEGER AS sent_last_30_days
    FROM public.myhonor_reactivation_recipients AS recipient
    WHERE recipient.contact_id = contact.id
      AND recipient.user_id = contact.user_id
      AND recipient.company_id = contact.company_id
      AND (
        recipient.provider_accepted_at IS NOT NULL
        OR (
          recipient.state IN ('authorized', 'delivery_unknown')
          AND recipient.authorized_at IS NOT NULL
        )
      )
  ) AS frequency ON TRUE
  WHERE contact.user_id = p_user_id
    AND contact.company_id = btrim(p_company_id)
  ORDER BY COALESCE(
    profile.last_activity_at, profile.registered_at, contact.created_at
  ) ASC, contact.id
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_myhonor_reactivation_campaign_definition(
  p_user_id UUID,
  p_company_id TEXT,
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign public.myhonor_reactivation_campaigns%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'invalid campaign definition request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_campaign
    FROM public.myhonor_reactivation_campaigns
   WHERE id = p_campaign_id
     AND user_id = p_user_id
     AND company_id = btrim(p_company_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_campaign.id,
    'name', v_campaign.name,
    'segment', v_campaign.segment,
    'season', v_campaign.season,
    'purpose', v_campaign.purpose,
    'interest', v_campaign.interest,
    'inactivity_days', v_campaign.inactivity_days,
    'frequency_cap_days', v_campaign.frequency_cap_days,
    'monthly_cap', v_campaign.monthly_cap,
    'daily_limit', v_campaign.daily_limit,
    'holdout_percent', v_campaign.holdout_percent,
    'product_limit', v_campaign.product_limit,
    'template_name', v_campaign.template_name,
    'template_language', v_campaign.template_language,
    'template_contract_hash', v_campaign.template_contract_hash,
    'utm_campaign', v_campaign.utm_campaign,
    'eligibility_rules', v_campaign.eligibility_rules,
    'dry_run', v_campaign.dry_run,
    'state', v_campaign.state,
    'preview_snapshot_hash', v_campaign.preview_snapshot_hash,
    'approval_snapshot_hash', v_campaign.approval_snapshot_hash,
    'created_at', v_campaign.created_at,
    'approved_at', v_campaign.approved_at,
    'started_at', v_campaign.started_at,
    'paused_at', v_campaign.paused_at,
    'completed_at', v_campaign.completed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_myhonor_reactivation_campaigns(
  p_user_id UUID,
  p_company_id TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  campaign_id UUID,
  name TEXT,
  segment TEXT,
  season TEXT,
  campaign_state TEXT,
  dry_run BOOLEAN,
  created_at TIMESTAMPTZ,
  recipient_count INTEGER,
  queued_count INTEGER,
  accepted_count INTEGER,
  excluded_count INTEGER,
  holdout_count INTEGER,
  preview_snapshot_hash TEXT,
  approval_snapshot_hash TEXT,
  template_contract_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid campaign list request' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    campaign.id,
    campaign.name,
    campaign.segment,
    campaign.season,
    campaign.state,
    campaign.dry_run,
    campaign.created_at,
    count(recipient.id)::INTEGER,
    count(recipient.id) FILTER (WHERE recipient.state = 'queued')::INTEGER,
    count(recipient.id) FILTER (
      WHERE recipient.state IN ('accepted', 'sent', 'delivered', 'read')
    )::INTEGER,
    count(recipient.id) FILTER (WHERE recipient.state = 'excluded')::INTEGER,
    count(recipient.id) FILTER (WHERE recipient.state = 'holdout')::INTEGER,
    campaign.preview_snapshot_hash,
    campaign.approval_snapshot_hash,
    campaign.template_contract_hash
  FROM public.myhonor_reactivation_campaigns AS campaign
  LEFT JOIN public.myhonor_reactivation_recipients AS recipient
    ON recipient.campaign_id = campaign.id
  WHERE campaign.user_id = p_user_id
    AND campaign.company_id = btrim(p_company_id)
  GROUP BY campaign.id
  ORDER BY campaign.created_at DESC, campaign.id DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_myhonor_reactivation_campaign_overview(
  p_user_id UUID,
  p_company_id TEXT,
  p_campaign_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid campaign overview request' USING ERRCODE = '22023';
  END IF;

  IF p_campaign_id IS NULL THEN
    SELECT jsonb_build_object(
      'scope', 'global',
      'campaign_states', COALESCE((
        SELECT jsonb_object_agg(grouped.state, grouped.total)
        FROM (
          SELECT campaign.state, count(*)::INTEGER AS total
          FROM public.myhonor_reactivation_campaigns AS campaign
          WHERE campaign.user_id = p_user_id
            AND campaign.company_id = btrim(p_company_id)
          GROUP BY campaign.state
        ) AS grouped
      ), '{}'::jsonb),
      'recipient_states', COALESCE((
        SELECT jsonb_object_agg(grouped.state, grouped.total)
        FROM (
          SELECT recipient.state, count(*)::INTEGER AS total
          FROM public.myhonor_reactivation_recipients AS recipient
          WHERE recipient.user_id = p_user_id
            AND recipient.company_id = btrim(p_company_id)
          GROUP BY recipient.state
        ) AS grouped
      ), '{}'::jsonb),
      'exclusion_reasons', COALESCE((
        SELECT jsonb_object_agg(grouped.reason, grouped.total)
        FROM (
          SELECT recipient.exclusion_reason AS reason, count(*)::INTEGER AS total
          FROM public.myhonor_reactivation_recipients AS recipient
          WHERE recipient.user_id = p_user_id
            AND recipient.company_id = btrim(p_company_id)
            AND recipient.exclusion_reason IS NOT NULL
          GROUP BY recipient.exclusion_reason
        ) AS grouped
      ), '{}'::jsonb),
      'contacts', jsonb_build_object(
        'total', (
          SELECT count(*)::INTEGER
          FROM public.myhonor_reactivation_contacts AS contact
          WHERE contact.user_id = p_user_id
            AND contact.company_id = btrim(p_company_id)
        ),
        'with_effective_consent', (
          SELECT count(DISTINCT consent.contact_id)::INTEGER
          FROM public.myhonor_reactivation_effective_consent AS consent
          WHERE consent.user_id = p_user_id
            AND consent.company_id = btrim(p_company_id)
            AND consent.eligible
        ),
        'globally_suppressed', (
          SELECT count(*)::INTEGER
          FROM public.myhonor_reactivation_effective_suppressions AS suppression
          WHERE suppression.user_id = p_user_id
            AND suppression.company_id = btrim(p_company_id)
        ),
        'provider_marketing_limited', (
          SELECT count(DISTINCT profile.contact_id)::INTEGER
          FROM public.myhonor_reactivation_profiles AS profile
          LEFT JOIN public.myhonor_reactivation_effective_suppressions AS suppression
            ON suppression.user_id = profile.user_id
           AND suppression.company_id = profile.company_id
           AND suppression.contact_id = profile.contact_id
          WHERE profile.user_id = p_user_id
            AND profile.company_id = btrim(p_company_id)
            AND (
              profile.provider_cooldown_until > CURRENT_TIMESTAMP
              OR COALESCE(
                'provider_quality' = ANY(suppression.active_reasons), FALSE
              )
            )
        )
      )
    ) INTO v_result;
    RETURN v_result;
  END IF;

  SELECT jsonb_build_object(
    'campaign', jsonb_build_object(
      'id', campaign.id,
      'name', campaign.name,
      'segment', campaign.segment,
      'season', campaign.season,
      'purpose', campaign.purpose,
      'interest', campaign.interest,
      'state', campaign.state,
      'dry_run', campaign.dry_run,
      'frequency_cap_days', campaign.frequency_cap_days,
      'monthly_cap', campaign.monthly_cap,
      'daily_limit', campaign.daily_limit,
      'holdout_percent', campaign.holdout_percent,
      'product_limit', campaign.product_limit,
      'utm_campaign', campaign.utm_campaign,
      'template_contract_hash', campaign.template_contract_hash,
      'preview_snapshot_hash', campaign.preview_snapshot_hash,
      'approval_snapshot_hash', campaign.approval_snapshot_hash,
      'created_at', campaign.created_at,
      'approved_at', campaign.approved_at,
      'started_at', campaign.started_at,
      'paused_at', campaign.paused_at,
      'completed_at', campaign.completed_at
    ),
    'recipient_states', COALESCE(states.counts, '{}'::jsonb),
    'exclusion_reasons', COALESCE(exclusions.counts, '{}'::jsonb),
    'attribution', jsonb_build_object(
      'replies', COALESCE(attribution.replies, 0),
      'clicks', COALESCE(attribution.clicks, 0),
      'club_joins', COALESCE(attribution.club_joins, 0),
      'orders', COALESCE(attribution.orders, 0),
      'revenue_kzt', COALESCE(attribution.revenue_kzt, 0)
    )
  ) INTO v_result
  FROM public.myhonor_reactivation_campaigns AS campaign
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(grouped.state, grouped.total) AS counts
    FROM (
      SELECT recipient.state, count(*)::INTEGER AS total
      FROM public.myhonor_reactivation_recipients AS recipient
      WHERE recipient.campaign_id = campaign.id
      GROUP BY recipient.state
    ) AS grouped
  ) AS states ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(grouped.reason, grouped.total) AS counts
    FROM (
      SELECT recipient.exclusion_reason AS reason, count(*)::INTEGER AS total
      FROM public.myhonor_reactivation_recipients AS recipient
      WHERE recipient.campaign_id = campaign.id
        AND recipient.exclusion_reason IS NOT NULL
      GROUP BY recipient.exclusion_reason
    ) AS grouped
  ) AS exclusions ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE item.attribution_kind = 'reply')::INTEGER AS replies,
      count(*) FILTER (WHERE item.attribution_kind = 'click')::INTEGER AS clicks,
      count(*) FILTER (WHERE item.attribution_kind = 'club_join')::INTEGER AS club_joins,
      count(*) FILTER (WHERE item.attribution_kind = 'order')::INTEGER AS orders,
      COALESCE(sum(item.value_kzt) FILTER (
        WHERE item.attribution_kind = 'revenue'
      ), 0)::NUMERIC AS revenue_kzt
    FROM public.myhonor_reactivation_attributions AS item
    WHERE item.campaign_id = campaign.id
  ) AS attribution ON TRUE
  WHERE campaign.id = p_campaign_id
    AND campaign.user_id = p_user_id
    AND campaign.company_id = btrim(p_company_id);

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_ready_myhonor_reactivation_recipients(
  p_user_id UUID,
  p_company_id TEXT,
  p_campaign_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (recipient_id UUID, run_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_campaign_id IS NULL
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid ready recipient request' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT recipient.id, recipient.run_at
  FROM public.myhonor_reactivation_recipients AS recipient
  JOIN public.myhonor_reactivation_campaigns AS campaign
    ON campaign.id = recipient.campaign_id
   AND campaign.user_id = recipient.user_id
   AND campaign.company_id = recipient.company_id
  WHERE recipient.user_id = p_user_id
    AND recipient.company_id = btrim(p_company_id)
    AND recipient.campaign_id = p_campaign_id
    AND (
      recipient.state = 'queued'
      OR (
        recipient.state IN ('leased', 'authorized')
        AND recipient.lease_until <= clock_timestamp()
      )
    )
    AND campaign.state = 'running'
    AND NOT campaign.dry_run
  ORDER BY
    CASE WHEN recipient.state = 'queued' THEN recipient.run_at
      ELSE recipient.lease_until END,
    recipient.created_at,
    recipient.id
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_myhonor_reactivation_recipient(
  p_recipient_id UUID,
  p_owner_token TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  recipient_id UUID,
  lease_token UUID,
  campaign_id UUID,
  contact_id UUID,
  phone_ciphertext TEXT,
  locale TEXT,
  segment TEXT,
  template_name TEXT,
  template_language TEXT,
  template_parameters_ciphertext TEXT,
  template_parameters_hash TEXT,
  recommendation_snapshot JSONB,
  attempts INTEGER,
  max_attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_recipient public.myhonor_reactivation_recipients%ROWTYPE;
  v_campaign public.myhonor_reactivation_campaigns%ROWTYPE;
BEGIN
  IF p_recipient_id IS NULL
     OR p_owner_token IS NULL
     OR length(btrim(p_owner_token)) NOT BETWEEN 1 AND 200
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid recipient claim' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_recipient
    FROM public.myhonor_reactivation_recipients
   WHERE id = p_recipient_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_campaign
    FROM public.myhonor_reactivation_campaigns
   WHERE id = v_recipient.campaign_id;

  IF v_recipient.state = 'leased'
     AND v_recipient.lease_owner = btrim(p_owner_token) THEN
    UPDATE public.myhonor_reactivation_recipients
       SET lease_until = v_now + make_interval(secs => p_lease_seconds)
     WHERE id = v_recipient.id
     RETURNING * INTO v_recipient;
  ELSIF v_recipient.state = 'authorized'
        AND v_recipient.lease_owner = btrim(p_owner_token) THEN
    UPDATE public.myhonor_reactivation_provider_attempts
       SET state = 'delivery_unknown',
           completed_at = v_now,
           error_code = 'authorized_workflow_replayed'
     WHERE recipient_id = v_recipient.id
       AND lease_token = v_recipient.lease_token
       AND state = 'authorized';
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'delivery_unknown',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = 'authorized_workflow_replayed',
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_recipient.id;
    RETURN;
  ELSIF v_recipient.state = 'authorized' AND v_recipient.lease_until <= v_now THEN
    UPDATE public.myhonor_reactivation_provider_attempts
       SET state = 'delivery_unknown',
           completed_at = v_now,
           error_code = 'authorized_lease_expired'
     WHERE recipient_id = v_recipient.id
       AND lease_token = v_recipient.lease_token
       AND state = 'authorized';
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'delivery_unknown',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = 'authorized_lease_expired',
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_recipient.id;
    RETURN;
  ELSIF v_recipient.state = 'leased' AND v_recipient.lease_until <= v_now THEN
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'queued',
           attempts = GREATEST(attempts - 1, 0),
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = 'lease_expired_before_authorization',
           last_error_at = v_now,
           run_at = v_now
     WHERE id = v_recipient.id
     RETURNING * INTO v_recipient;
  END IF;

  IF v_recipient.state = 'leased'
     AND v_recipient.lease_owner = btrim(p_owner_token) THEN
    NULL;
  ELSIF v_recipient.state <> 'queued'
        OR v_recipient.run_at > v_now
        OR v_campaign.state <> 'running'
        OR v_campaign.dry_run THEN
    RETURN;
  ELSIF v_recipient.attempts >= v_recipient.max_attempts THEN
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'failed',
           last_error_code = 'max_attempts_exhausted',
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_recipient.id;
    RETURN;
  ELSE
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'leased',
           attempts = attempts + 1,
           lease_owner = btrim(p_owner_token),
           lease_token = gen_random_uuid(),
           lease_until = v_now + make_interval(secs => p_lease_seconds)
     WHERE id = v_recipient.id
     RETURNING * INTO v_recipient;
  END IF;

  RETURN QUERY SELECT
    v_recipient.id,
    v_recipient.lease_token,
    v_recipient.campaign_id,
    v_recipient.contact_id,
    v_recipient.phone_ciphertext_snapshot,
    v_recipient.locale_snapshot,
    v_campaign.segment,
    v_campaign.template_name,
    v_campaign.template_language,
    v_recipient.template_parameters_ciphertext,
    v_recipient.template_parameters_hash,
    v_recipient.recommendation_snapshot,
    v_recipient.attempts::INTEGER,
    v_recipient.max_attempts::INTEGER;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_myhonor_reactivation_recipient(
  p_recipient_id UUID,
  p_lease_token UUID,
  p_owner_token TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  authorized BOOLEAN,
  reason TEXT,
  provider_attempt_id UUID,
  next_run_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_local TIMESTAMP;
  v_recipient public.myhonor_reactivation_recipients%ROWTYPE;
  v_campaign public.myhonor_reactivation_campaigns%ROWTYPE;
  v_contact public.myhonor_reactivation_contacts%ROWTYPE;
  v_profile public.myhonor_reactivation_profiles%ROWTYPE;
  v_consent RECORD;
  v_suppression RECORD;
  v_last_sent TIMESTAMPTZ;
  v_monthly_count INTEGER;
  v_daily_count INTEGER;
  v_product_ids JSONB;
  v_terminal_reason TEXT;
  v_requeue_reason TEXT;
  v_attempt_id UUID;
  v_next_run TIMESTAMPTZ;
BEGIN
  IF p_recipient_id IS NULL
     OR p_lease_token IS NULL
     OR p_owner_token IS NULL
     OR length(btrim(p_owner_token)) NOT BETWEEN 1 AND 200
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RETURN QUERY SELECT
      FALSE, 'invalid_authorization_request'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT * INTO v_recipient
    FROM public.myhonor_reactivation_recipients
   WHERE id = p_recipient_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      FALSE, 'authorization_fence_rejected'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_recipient.user_id::TEXT || ':' || v_recipient.company_id || ':'
      || v_recipient.contact_id::TEXT || ':myhonor-reactivation-contact',
    0
  ));
  SELECT * INTO v_recipient
    FROM public.myhonor_reactivation_recipients
   WHERE id = p_recipient_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_recipient.state <> 'leased'
     OR v_recipient.lease_token IS DISTINCT FROM p_lease_token
     OR v_recipient.lease_owner IS DISTINCT FROM btrim(p_owner_token)
     OR v_recipient.lease_until <= v_now THEN
    RETURN QUERY SELECT
      FALSE, 'authorization_fence_rejected'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Lock the campaign so concurrent authorizations cannot exceed daily_limit.
  SELECT * INTO v_campaign
    FROM public.myhonor_reactivation_campaigns
   WHERE id = v_recipient.campaign_id
   FOR UPDATE;
  IF v_campaign.state <> 'running' OR v_campaign.dry_run THEN
    v_next_run := CASE WHEN v_campaign.state = 'completed'
      THEN NULL ELSE v_now + interval '15 minutes' END;
    UPDATE public.myhonor_reactivation_recipients
       SET state = CASE WHEN v_campaign.state = 'completed'
         THEN 'cancelled' ELSE 'queued' END,
           attempts = CASE WHEN v_campaign.state = 'completed'
             THEN attempts ELSE GREATEST(attempts - 1, 0) END,
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           completed_at = CASE WHEN v_campaign.state = 'completed'
             THEN v_now ELSE NULL END,
           last_error_code = 'campaign_not_running',
           last_error_at = v_now,
           run_at = COALESCE(v_next_run, run_at)
     WHERE id = v_recipient.id;
    RETURN QUERY SELECT
      FALSE, 'campaign_not_running'::TEXT, NULL::UUID, v_next_run;
    RETURN;
  END IF;
  IF v_campaign.template_name IS NULL OR v_campaign.template_language IS NULL THEN
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'failed',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = 'template_not_configured',
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_recipient.id;
    RETURN QUERY SELECT
      FALSE, 'template_not_configured'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_local := v_now AT TIME ZONE 'Asia/Almaty';
  IF (
    (extract(isodow FROM v_local) BETWEEN 1 AND 5
      AND (extract(hour FROM v_local) < 10 OR extract(hour FROM v_local) >= 20))
    OR
    (extract(isodow FROM v_local) BETWEEN 6 AND 7
      AND (extract(hour FROM v_local) < 11 OR extract(hour FROM v_local) >= 18))
  ) THEN
    v_requeue_reason := 'quiet_hours';
  END IF;

  SELECT * INTO v_contact
    FROM public.myhonor_reactivation_contacts
   WHERE id = v_recipient.contact_id
     AND user_id = v_recipient.user_id
     AND company_id = v_recipient.company_id
   FOR UPDATE;
  IF NOT FOUND OR v_contact.phone_hash <> v_recipient.phone_hash_snapshot THEN
    v_terminal_reason := 'identity_changed';
  ELSIF v_contact.source_updated_at IS NULL
        OR v_contact.source_updated_at < v_now - interval '24 hours' THEN
    v_terminal_reason := 'source_snapshot_stale';
  ELSIF v_contact.source_version
        <> v_recipient.contact_source_version_snapshot THEN
    v_terminal_reason := 'source_snapshot_changed';
  END IF;

  SELECT * INTO v_profile
    FROM public.myhonor_reactivation_profiles
   WHERE contact_id = v_recipient.contact_id;
  IF v_terminal_reason IS NULL
     AND (NOT FOUND OR v_profile.unresolved_complaint) THEN
    v_terminal_reason := 'unresolved_complaint';
  ELSIF v_terminal_reason IS NULL
        AND v_profile.marketing_hold THEN
    v_terminal_reason := 'manual_hold';
  ELSIF v_terminal_reason IS NULL
        AND (
          v_profile.source_updated_at IS NULL
          OR v_profile.source_updated_at < v_now - interval '24 hours'
        ) THEN
    v_terminal_reason := 'source_snapshot_stale';
  ELSIF v_terminal_reason IS NULL
        AND v_profile.source_version
          IS DISTINCT FROM v_recipient.profile_source_version_snapshot THEN
    v_terminal_reason := 'source_snapshot_changed';
  END IF;
  IF v_terminal_reason IS NULL
     AND v_profile.provider_cooldown_until > v_now THEN
    v_requeue_reason := 'provider_cooldown';
  END IF;

  SELECT * INTO v_suppression
    FROM public.myhonor_reactivation_effective_suppressions
   WHERE user_id = v_recipient.user_id
     AND company_id = v_recipient.company_id
     AND contact_id = v_recipient.contact_id;
  IF v_terminal_reason IS NULL AND v_suppression.contact_id IS NOT NULL THEN
    v_terminal_reason := CASE WHEN COALESCE(
      v_suppression.active_reasons
        && ARRAY['manual', 'legal', 'unresolved_complaint']::TEXT[], FALSE
    ) THEN 'manual_hold' ELSE 'global_suppression' END;
  END IF;

  SELECT * INTO v_consent
    FROM public.myhonor_reactivation_effective_consent
   WHERE user_id = v_recipient.user_id
     AND company_id = v_recipient.company_id
     AND contact_id = v_recipient.contact_id
     AND purpose = v_campaign.purpose;
  IF v_terminal_reason IS NULL AND NOT COALESCE(v_consent.eligible, FALSE) THEN
    v_terminal_reason := 'missing_consent';
  ELSIF v_terminal_reason IS NULL
        AND v_consent.source_version
          IS DISTINCT FROM v_recipient.consent_source_version_snapshot THEN
    v_terminal_reason := 'source_snapshot_changed';
  END IF;

  SELECT max(COALESCE(
           provider_accepted_at,
           CASE WHEN state IN ('authorized', 'delivery_unknown')
             THEN authorized_at END
         )),
         count(*) FILTER (
           WHERE COALESCE(
             provider_accepted_at,
             CASE WHEN state IN ('authorized', 'delivery_unknown')
               THEN authorized_at END
           ) >= v_now - interval '30 days'
         )::INTEGER
    INTO v_last_sent, v_monthly_count
    FROM public.myhonor_reactivation_recipients
   WHERE contact_id = v_recipient.contact_id
     AND user_id = v_recipient.user_id
     AND company_id = v_recipient.company_id
     AND id <> v_recipient.id
     AND (
       provider_accepted_at IS NOT NULL
       OR (state IN ('authorized', 'delivery_unknown') AND authorized_at IS NOT NULL)
     );
  IF v_terminal_reason IS NULL
     AND v_last_sent IS NOT NULL
     AND v_last_sent > v_now - make_interval(days => v_campaign.frequency_cap_days) THEN
    v_terminal_reason := 'frequency_cap';
  ELSIF v_terminal_reason IS NULL AND v_monthly_count >= v_campaign.monthly_cap THEN
    v_terminal_reason := 'monthly_frequency_cap';
  END IF;

  IF v_terminal_reason IS NULL
     AND v_campaign.purpose = 'product_recommendations' THEN
    v_product_ids := v_recipient.recommendation_snapshot->'product_ids';
    IF v_product_ids IS NULL
       OR jsonb_typeof(v_product_ids) <> 'array'
       OR jsonb_array_length(v_product_ids) NOT BETWEEN 1 AND v_campaign.product_limit
       OR jsonb_typeof(v_recipient.recommendation_snapshot->'products') <> 'array'
       OR jsonb_array_length(v_recipient.recommendation_snapshot->'products')
            <> jsonb_array_length(v_product_ids)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(v_product_ids) AS product_id
         WHERE product_id !~ '^myhonor:[a-f0-9]{64}$'
       ) THEN
      v_terminal_reason := 'invalid_recommendation';
    ELSIF v_campaign.segment = 'abandoned_cart' AND (
      v_profile.abandoned_cart IS NULL
      OR NOT COALESCE((v_profile.abandoned_cart->>'active')::BOOLEAN, FALSE)
      OR jsonb_typeof(v_profile.abandoned_cart->'product_ids') <> 'array'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_product_ids) AS product_id
        WHERE NOT (v_profile.abandoned_cart->'product_ids' ? product_id)
      )
    ) THEN
      v_terminal_reason := 'application_ineligible';
    ELSE
      IF NOT public.myhonor_reactivation_recommendation_is_live(
        v_recipient.user_id,
        v_recipient.company_id,
        v_recipient.recommendation_snapshot,
        v_campaign.product_limit
      ) THEN
        v_terminal_reason := 'inactive_product';
      END IF;
    END IF;
  END IF;

  SELECT count(*)::INTEGER INTO v_daily_count
    FROM public.myhonor_reactivation_provider_attempts AS attempt
   WHERE attempt.campaign_id = v_campaign.id
     AND (attempt.authorized_at AT TIME ZONE 'Asia/Almaty')::DATE = v_local::DATE;
  IF v_terminal_reason IS NULL
     AND v_requeue_reason IS NULL
     AND v_daily_count >= v_campaign.daily_limit THEN
    v_requeue_reason := 'daily_limit';
  END IF;

  IF v_terminal_reason IS NOT NULL THEN
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'excluded',
           exclusion_reason = v_terminal_reason,
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = v_terminal_reason,
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_recipient.id;
    INSERT INTO public.myhonor_reactivation_audit_events (
      user_id, company_id, actor_kind, action, entity_type, entity_id, details
    ) VALUES (
      v_recipient.user_id, v_recipient.company_id, 'workflow',
      'recipient.authorization_rejected', 'recipient', v_recipient.id,
      jsonb_build_object('reason', v_terminal_reason)
    );
    RETURN QUERY SELECT FALSE, v_terminal_reason, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_requeue_reason IS NOT NULL THEN
    v_next_run := CASE
      WHEN v_requeue_reason = 'daily_limit' THEN
        public.myhonor_reactivation_next_allowed_send_at(
          (v_local::DATE + 1)::TIMESTAMP AT TIME ZONE 'Asia/Almaty'
        )
      WHEN v_requeue_reason = 'provider_cooldown'
        THEN public.myhonor_reactivation_next_allowed_send_at(
          v_profile.provider_cooldown_until
        )
      ELSE public.myhonor_reactivation_next_allowed_send_at(v_now)
    END;
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'queued',
           attempts = GREATEST(attempts - 1, 0),
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = v_requeue_reason,
           last_error_at = v_now,
           run_at = v_next_run
     WHERE id = v_recipient.id;
    RETURN QUERY SELECT FALSE, v_requeue_reason, NULL::UUID, v_next_run;
    RETURN;
  END IF;

  INSERT INTO public.myhonor_reactivation_provider_attempts (
    recipient_id, campaign_id, user_id, company_id, attempt_number,
    lease_token, authorized_at
  ) VALUES (
    v_recipient.id,
    v_recipient.campaign_id,
    v_recipient.user_id,
    v_recipient.company_id,
    v_recipient.attempts,
    p_lease_token,
    v_now
  ) RETURNING id INTO v_attempt_id;

  UPDATE public.myhonor_reactivation_recipients
     SET state = 'authorized',
         authorized_at = v_now,
         lease_until = v_now + make_interval(secs => p_lease_seconds),
         last_error_code = NULL,
         last_error_at = NULL
   WHERE id = v_recipient.id;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, action, entity_type, entity_id, details
  ) VALUES (
    v_recipient.user_id, v_recipient.company_id, 'workflow',
    'recipient.authorized', 'provider_attempt', v_attempt_id,
    jsonb_build_object(
      'recipient_id', v_recipient.id,
      'attempt_number', v_recipient.attempts
    )
  );

  RETURN QUERY SELECT TRUE, 'authorized'::TEXT, v_attempt_id, NULL::TIMESTAMPTZ;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_myhonor_reactivation_recipient(
  p_recipient_id UUID,
  p_lease_token UUID,
  p_owner_token TEXT,
  p_outcome TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT FALSE,
  p_retry_after_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
  accepted BOOLEAN,
  recipient_state TEXT,
  next_run_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_recipient public.myhonor_reactivation_recipients%ROWTYPE;
  v_attempt public.myhonor_reactivation_provider_attempts%ROWTYPE;
  v_state TEXT;
  v_next_run TIMESTAMPTZ;
  v_provider_marketing_limited BOOLEAN := FALSE;
BEGIN
  IF p_recipient_id IS NULL
     OR p_lease_token IS NULL
     OR p_owner_token IS NULL
     OR length(btrim(p_owner_token)) NOT BETWEEN 1 AND 200
     OR p_outcome NOT IN ('accepted', 'failed', 'delivery_unknown')
     OR p_error_code IS NOT NULL
        AND p_error_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
     OR p_retry_after_seconds IS NULL
        OR p_retry_after_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'invalid recipient outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_recipient
    FROM public.myhonor_reactivation_recipients
   WHERE id = p_recipient_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_recipient.lease_token IS DISTINCT FROM p_lease_token
     OR v_recipient.lease_owner IS DISTINCT FROM btrim(p_owner_token)
     OR v_recipient.state NOT IN ('leased', 'authorized') THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT * INTO v_attempt
    FROM public.myhonor_reactivation_provider_attempts
   WHERE recipient_id = v_recipient.id
     AND lease_token = p_lease_token
   FOR UPDATE;

  IF p_outcome IN ('accepted', 'delivery_unknown')
     AND v_recipient.state <> 'authorized' THEN
    RETURN QUERY SELECT FALSE, v_recipient.state, v_recipient.run_at;
    RETURN;
  END IF;
  IF v_recipient.state = 'authorized' AND v_attempt.id IS NULL THEN
    RETURN QUERY SELECT FALSE, v_recipient.state, v_recipient.run_at;
    RETURN;
  END IF;
  IF p_outcome = 'accepted'
     AND (
       p_provider_message_id IS NULL
       OR length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 500
     ) THEN
    RAISE EXCEPTION 'accepted outcome requires provider message id'
      USING ERRCODE = '22023';
  END IF;

  v_provider_marketing_limited := p_outcome = 'failed'
    AND COALESCE(p_error_code, '') ~ '(^|[.:])131049$';
  IF v_provider_marketing_limited THEN
    UPDATE public.myhonor_reactivation_profiles
       SET provider_cooldown_until = GREATEST(
         COALESCE(provider_cooldown_until, v_now),
         v_now + interval '7 days'
       )
     WHERE contact_id = v_recipient.contact_id;
  END IF;

  IF p_outcome = 'accepted' THEN
    UPDATE public.myhonor_reactivation_provider_attempts
       SET state = 'accepted',
           completed_at = v_now,
           provider_message_id = btrim(p_provider_message_id),
           error_code = NULL
     WHERE id = v_attempt.id;
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'accepted',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           provider_message_id = btrim(p_provider_message_id),
           provider_accepted_at = v_now,
           last_error_code = NULL,
           last_error_at = NULL,
           completed_at = v_now
     WHERE id = v_recipient.id;
    v_state := 'accepted';
    v_next_run := NULL;
  ELSIF p_outcome = 'delivery_unknown' THEN
    UPDATE public.myhonor_reactivation_provider_attempts
       SET state = 'delivery_unknown',
           completed_at = v_now,
           error_code = COALESCE(p_error_code, 'delivery_unknown')
     WHERE id = v_attempt.id;
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'delivery_unknown',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = COALESCE(p_error_code, 'delivery_unknown'),
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_recipient.id;
    v_state := 'delivery_unknown';
    v_next_run := NULL;
  ELSE
    IF v_attempt.id IS NOT NULL THEN
      UPDATE public.myhonor_reactivation_provider_attempts
         SET state = 'failed',
             completed_at = v_now,
             error_code = COALESCE(p_error_code, 'provider_failed')
       WHERE id = v_attempt.id;
    END IF;

    IF p_retryable
       AND NOT v_provider_marketing_limited
       AND v_recipient.attempts < v_recipient.max_attempts THEN
      v_state := 'queued';
      v_next_run := public.myhonor_reactivation_next_allowed_send_at(
        v_now + make_interval(secs => p_retry_after_seconds)
      );
      UPDATE public.myhonor_reactivation_recipients
         SET state = 'queued',
             run_at = v_next_run,
             lease_owner = NULL,
             lease_token = NULL,
             lease_until = NULL,
             last_error_code = COALESCE(p_error_code, 'provider_retryable_error'),
             last_error_at = v_now
       WHERE id = v_recipient.id;
    ELSE
      v_state := 'failed';
      v_next_run := NULL;
      UPDATE public.myhonor_reactivation_recipients
         SET state = 'failed',
             lease_owner = NULL,
             lease_token = NULL,
             lease_until = NULL,
             last_error_code = COALESCE(p_error_code, 'provider_failed'),
             last_error_at = v_now,
             completed_at = v_now
       WHERE id = v_recipient.id;
    END IF;
  END IF;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, action, entity_type, entity_id, details
  ) VALUES (
    v_recipient.user_id,
    v_recipient.company_id,
    'workflow',
    'recipient.' || v_state,
    'recipient',
    v_recipient.id,
    jsonb_build_object(
      'outcome', p_outcome,
      'attempt_number', v_recipient.attempts,
      'retryable', p_retryable,
      'provider_marketing_limited', v_provider_marketing_limited,
      'error_code', p_error_code
    )
  );

  RETURN QUERY SELECT TRUE, v_state, v_next_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_myhonor_reactivation_delivery_status(
  p_provider_message_id TEXT,
  p_status TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_error_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  matched BOOLEAN,
  recipient_id UUID,
  recipient_state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient public.myhonor_reactivation_recipients%ROWTYPE;
  v_when TIMESTAMPTZ := COALESCE(p_occurred_at, clock_timestamp());
  v_next_state TEXT;
  v_current_rank INTEGER;
  v_next_rank INTEGER;
BEGIN
  IF p_provider_message_id IS NULL
     OR length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 500
     OR p_status NOT IN ('sent', 'delivered', 'read', 'failed')
     OR p_occurred_at IS NOT NULL AND NOT isfinite(p_occurred_at)
     OR p_error_code IS NOT NULL
        AND p_error_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' THEN
    RAISE EXCEPTION 'invalid reactivation delivery status'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_recipient
    FROM public.myhonor_reactivation_recipients
   WHERE provider_message_id = btrim(p_provider_message_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  v_current_rank := CASE v_recipient.state
    WHEN 'accepted' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
    WHEN 'read' THEN 3 ELSE -1 END;
  v_next_rank := CASE p_status
    WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE -1 END;

  IF v_recipient.state IN ('delivery_unknown', 'failed') THEN
    v_next_state := v_recipient.state;
  ELSIF p_status = 'failed' THEN
    v_next_state := CASE WHEN v_current_rank >= 2 THEN v_recipient.state ELSE 'failed' END;
  ELSIF v_next_rank >= v_current_rank THEN
    v_next_state := p_status;
  ELSE
    v_next_state := v_recipient.state;
  END IF;

  UPDATE public.myhonor_reactivation_recipients
     SET state = v_next_state,
         completed_at = COALESCE(completed_at, v_when),
         last_error_code = CASE
           WHEN v_next_state = 'failed'
             THEN COALESCE(p_error_code, 'provider_delivery_failed')
           ELSE last_error_code
         END,
         last_error_at = CASE
           WHEN v_next_state = 'failed' THEN v_when ELSE last_error_at END
   WHERE id = v_recipient.id;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, action, entity_type, entity_id, details,
    occurred_at
  ) VALUES (
    v_recipient.user_id,
    v_recipient.company_id,
    'provider',
    'recipient.delivery_status',
    'recipient',
    v_recipient.id,
    jsonb_build_object(
      'reported_status', p_status,
      'effective_state', v_next_state,
      'error_code', p_error_code
    ),
    v_when
  );

  RETURN QUERY SELECT TRUE, v_recipient.id, v_next_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_myhonor_reactivation_suppression(
  p_user_id UUID,
  p_company_id TEXT,
  p_contact_id UUID,
  p_action TEXT,
  p_reason TEXT,
  p_source_event_id TEXT,
  p_evidence_hash TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_actor_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
  suppression_event_id UUID,
  active_reasons TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contact public.myhonor_reactivation_contacts%ROWTYPE;
  v_existing public.myhonor_reactivation_suppression_events%ROWTYPE;
  v_event_id UUID;
  v_active_reasons TEXT[];
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_contact_id IS NULL
     OR p_action NOT IN ('suppress', 'unsuppress')
     -- consent_revoked is Store-versioned and may only be emitted atomically
     -- by ingest_myhonor_reactivation_contact_event.
     OR p_reason NOT IN (
       'whatsapp_opt_out', 'manual', 'legal', 'unresolved_complaint',
       'provider_quality'
     )
     OR p_source_event_id IS NULL
     OR length(p_source_event_id) NOT BETWEEN 8 AND 200
     OR p_source_event_id !~ '^(myhonor|whatsapp|meta-wa)(:[a-z][a-z0-9-]{0,39})?:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$'
     OR p_evidence_hash IS NULL OR p_evidence_hash !~ '^[a-f0-9]{64}$'
     OR p_occurred_at IS NULL OR NOT isfinite(p_occurred_at)
     OR p_occurred_at > v_now + interval '5 minutes'
     OR p_actor_hash IS NOT NULL AND p_actor_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid suppression event' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'unsuppress' AND p_reason IN ('legal', 'provider_quality') THEN
    RAISE EXCEPTION 'legal/provider suppressions require a new reviewed reason'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || btrim(p_company_id) || ':' || p_contact_id::TEXT
      || ':myhonor-reactivation-contact',
    0
  ));

  SELECT * INTO v_contact
    FROM public.myhonor_reactivation_contacts
   WHERE id = p_contact_id
     AND user_id = p_user_id
     AND company_id = btrim(p_company_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || btrim(p_company_id) || ':' || p_contact_id::TEXT
      || ':' || p_reason || ':' || p_source_event_id,
    0
  ));
  SELECT * INTO v_existing
    FROM public.myhonor_reactivation_suppression_events
   WHERE user_id = p_user_id
     AND company_id = btrim(p_company_id)
     AND contact_id = p_contact_id
     AND reason = p_reason
     AND source_event_id = p_source_event_id;
  IF FOUND THEN
    IF v_existing.action <> p_action
       OR v_existing.evidence_hash <> p_evidence_hash
       OR v_existing.occurred_at <> p_occurred_at THEN
      RAISE EXCEPTION 'suppression event idempotency conflict'
        USING ERRCODE = '23505';
    END IF;
    SELECT suppression.active_reasons INTO v_active_reasons
      FROM public.myhonor_reactivation_effective_suppressions AS suppression
     WHERE suppression.user_id = p_user_id
       AND suppression.company_id = btrim(p_company_id)
       AND suppression.contact_id = p_contact_id;
    RETURN QUERY SELECT
      v_existing.id, COALESCE(v_active_reasons, ARRAY[]::TEXT[]);
    RETURN;
  END IF;

  INSERT INTO public.myhonor_reactivation_suppression_events (
    user_id, company_id, contact_id, action, reason, source_event_id,
    evidence_hash, occurred_at
  ) VALUES (
    p_user_id, btrim(p_company_id), p_contact_id, p_action, p_reason,
    p_source_event_id, p_evidence_hash, p_occurred_at
  ) RETURNING id INTO v_event_id;

  SELECT suppression.active_reasons INTO v_active_reasons
    FROM public.myhonor_reactivation_effective_suppressions AS suppression
   WHERE suppression.user_id = p_user_id
     AND suppression.company_id = btrim(p_company_id)
     AND suppression.contact_id = p_contact_id;

  -- Keep a stale ledger event for audit, but only the current effective event
  -- may cancel queued work.
  IF p_action = 'suppress'
     AND p_reason = ANY(COALESCE(v_active_reasons, ARRAY[]::TEXT[])) THEN
    UPDATE public.myhonor_reactivation_recipients
       SET state = 'excluded',
           exclusion_reason = 'global_suppression',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = p_reason,
           last_error_at = v_now,
           completed_at = v_now
     WHERE contact_id = p_contact_id
       AND state IN ('preview', 'queued', 'leased');
  END IF;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, actor_hash, action, entity_type,
    entity_id, details, occurred_at
  ) VALUES (
    p_user_id,
    btrim(p_company_id),
    CASE WHEN p_actor_hash IS NULL THEN 'system' ELSE 'admin' END,
    p_actor_hash,
    'suppression.' || p_action,
    'suppression',
    v_event_id,
    jsonb_build_object('reason', p_reason),
    v_now
  );

  RETURN QUERY SELECT v_event_id, COALESCE(v_active_reasons, ARRAY[]::TEXT[]);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_myhonor_reactivation_attribution(
  p_user_id UUID,
  p_company_id TEXT,
  p_event_id TEXT,
  p_event_hash TEXT,
  p_recipient_id UUID,
  p_kind TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_value_kzt NUMERIC DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  attribution_id UUID,
  created BOOLEAN,
  conflict BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient public.myhonor_reactivation_recipients%ROWTYPE;
  v_existing public.myhonor_reactivation_attributions%ROWTYPE;
  v_created_id UUID;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_event_id IS NULL
     OR length(p_event_id) NOT BETWEEN 8 AND 200
     OR p_event_id !~ '^(myhonor|whatsapp|meta-wa)(:[a-z][a-z0-9-]{0,39})?:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$'
     OR p_event_hash IS NULL OR p_event_hash !~ '^[a-f0-9]{64}$'
     OR p_recipient_id IS NULL
     OR p_kind NOT IN ('reply', 'click', 'club_join', 'order', 'revenue', 'unsubscribe')
     OR p_occurred_at IS NULL OR NOT isfinite(p_occurred_at)
     OR p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR pg_column_size(p_details) > 16384
     OR public.myhonor_reactivation_jsonb_contains_pii(p_details)
     OR (p_kind IN ('order', 'revenue') AND (p_value_kzt IS NULL OR p_value_kzt < 0))
     OR (p_kind NOT IN ('order', 'revenue') AND p_value_kzt IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid attribution event' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::TEXT || ':' || btrim(p_company_id) || ':' || p_event_id, 0)
  );
  SELECT * INTO v_existing
    FROM public.myhonor_reactivation_attributions
   WHERE user_id = p_user_id
     AND company_id = btrim(p_company_id)
     AND event_id = p_event_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.id,
      FALSE,
      (
        v_existing.event_hash <> p_event_hash
        OR v_existing.recipient_id <> p_recipient_id
        OR v_existing.attribution_kind <> p_kind
        OR v_existing.occurred_at <> p_occurred_at
        OR v_existing.value_kzt IS DISTINCT FROM p_value_kzt
        OR v_existing.details <> p_details
      );
    RETURN;
  END IF;

  SELECT * INTO v_recipient
    FROM public.myhonor_reactivation_recipients
   WHERE id = p_recipient_id
     AND user_id = p_user_id
     AND company_id = btrim(p_company_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recipient not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_kind = 'unsubscribe' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_user_id::TEXT || ':' || btrim(p_company_id) || ':'
        || v_recipient.contact_id::TEXT || ':myhonor-reactivation-contact',
      0
    ));
  END IF;

  INSERT INTO public.myhonor_reactivation_attributions (
    user_id, company_id, event_id, event_hash, recipient_id, campaign_id,
    contact_id, attribution_kind, occurred_at, value_kzt, details
  ) VALUES (
    p_user_id, btrim(p_company_id), p_event_id, p_event_hash,
    v_recipient.id, v_recipient.campaign_id, v_recipient.contact_id,
    p_kind, p_occurred_at, p_value_kzt, p_details
  ) RETURNING id INTO v_created_id;

  IF p_kind = 'unsubscribe' THEN
    PERFORM 1
      FROM public.record_myhonor_reactivation_suppression(
        p_user_id,
        btrim(p_company_id),
        v_recipient.contact_id,
        'suppress',
        'whatsapp_opt_out',
        p_event_id,
        p_event_hash,
        p_occurred_at,
        NULL
      );
  END IF;

  INSERT INTO public.myhonor_reactivation_audit_events (
    user_id, company_id, actor_kind, action, entity_type, entity_id, details,
    occurred_at
  ) VALUES (
    p_user_id,
    btrim(p_company_id),
    'system',
    'attribution.recorded',
    'attribution',
    v_created_id,
    jsonb_build_object('kind', p_kind, 'campaign_id', v_recipient.campaign_id),
    clock_timestamp()
  );

  RETURN QUERY SELECT v_created_id, TRUE, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_myhonor_reactivation_inbound_signal(
  p_user_id UUID,
  p_company_id TEXT,
  p_phone_hash TEXT,
  p_event_id TEXT,
  p_event_hash TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_opt_out BOOLEAN,
  p_actor_hash TEXT
)
RETURNS TABLE (
  matched_contact BOOLEAN,
  attributed_recipient_id UUID,
  suppressed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contact public.myhonor_reactivation_contacts%ROWTYPE;
  v_contact_id UUID;
  v_recipient public.myhonor_reactivation_recipients%ROWTYPE;
  v_existing public.myhonor_reactivation_attributions%ROWTYPE;
  v_active_reasons TEXT[];
  v_source_event_id TEXT;
  v_reply_event_id TEXT;
  v_unsubscribe_event_id TEXT;
  v_reply_hash TEXT;
  v_unsubscribe_hash TEXT;
  v_attribution_id UUID;
  v_reply_exists BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_phone_hash IS NULL OR p_phone_hash !~ '^[a-f0-9]{64}$'
     OR p_event_id IS NULL
     OR length(p_event_id) NOT BETWEEN 8 AND 200
     OR p_event_id !~ '^(myhonor|whatsapp|meta-wa)(:[a-z][a-z0-9-]{0,39})?:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$'
     OR p_event_hash IS NULL OR p_event_hash !~ '^[a-f0-9]{64}$'
     OR p_occurred_at IS NULL OR NOT isfinite(p_occurred_at)
     OR p_occurred_at > v_now + interval '5 minutes'
     OR p_opt_out IS NULL
     OR p_actor_hash IS NULL OR p_actor_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid inbound reactivation signal' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || btrim(p_company_id) || ':inbound:' || p_event_id,
    0
  ));
  SELECT * INTO v_contact
    FROM public.myhonor_reactivation_contacts
   WHERE user_id = p_user_id
     AND company_id = btrim(p_company_id)
     AND source = 'myhonor.shop'
     AND phone_hash = p_phone_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, FALSE;
    RETURN;
  END IF;
  v_contact_id := v_contact.id;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || btrim(p_company_id) || ':' || v_contact_id::TEXT
      || ':myhonor-reactivation-contact',
    0
  ));
  SELECT * INTO v_contact
    FROM public.myhonor_reactivation_contacts
   WHERE id = v_contact_id
     AND user_id = p_user_id
     AND company_id = btrim(p_company_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, FALSE;
    RETURN;
  END IF;

  v_source_event_id := 'whatsapp:inbound:'
    || encode(sha256(convert_to(p_event_id, 'UTF8')), 'hex');
  IF p_opt_out THEN
    SELECT result.active_reasons INTO v_active_reasons
    FROM public.record_myhonor_reactivation_suppression(
      p_user_id,
      btrim(p_company_id),
      v_contact.id,
      'suppress',
      'whatsapp_opt_out',
      v_source_event_id,
      p_event_hash,
      p_occurred_at,
      p_actor_hash
    ) AS result;
  ELSE
    SELECT suppression.active_reasons INTO v_active_reasons
      FROM public.myhonor_reactivation_effective_suppressions AS suppression
     WHERE suppression.user_id = p_user_id
       AND suppression.company_id = btrim(p_company_id)
       AND suppression.contact_id = v_contact.id;
  END IF;

  v_reply_event_id := 'whatsapp:reply:'
    || encode(sha256(convert_to(p_event_id, 'UTF8')), 'hex');
  v_reply_hash := encode(sha256(convert_to(p_event_hash || ':reply', 'UTF8')), 'hex');
  SELECT * INTO v_existing
    FROM public.myhonor_reactivation_attributions
   WHERE user_id = p_user_id
     AND company_id = btrim(p_company_id)
     AND event_id = v_reply_event_id;
  IF FOUND THEN
    IF v_existing.event_hash <> v_reply_hash
       OR v_existing.contact_id <> v_contact.id
       OR v_existing.attribution_kind <> 'reply' THEN
      RAISE EXCEPTION 'inbound reply idempotency conflict' USING ERRCODE = '23505';
    END IF;
    v_reply_exists := TRUE;
    SELECT * INTO v_recipient
      FROM public.myhonor_reactivation_recipients AS recipient
     WHERE recipient.id = v_existing.recipient_id
       AND recipient.user_id = p_user_id
       AND recipient.company_id = btrim(p_company_id);
  ELSE
    SELECT * INTO v_recipient
      FROM public.myhonor_reactivation_recipients AS recipient
     WHERE recipient.user_id = p_user_id
       AND recipient.company_id = btrim(p_company_id)
       AND recipient.contact_id = v_contact.id
       AND recipient.state IN ('accepted', 'sent', 'delivered', 'read')
       AND recipient.provider_accepted_at >= p_occurred_at - interval '30 days'
       AND recipient.provider_accepted_at <= p_occurred_at + interval '5 minutes'
     ORDER BY recipient.provider_accepted_at DESC, recipient.id DESC
     LIMIT 1;
  END IF;

  IF v_recipient.id IS NOT NULL THEN
    IF NOT v_reply_exists THEN
      INSERT INTO public.myhonor_reactivation_attributions (
        user_id, company_id, event_id, event_hash, recipient_id, campaign_id,
        contact_id, attribution_kind, occurred_at, value_kzt, details
      ) VALUES (
        p_user_id, btrim(p_company_id), v_reply_event_id, v_reply_hash,
        v_recipient.id, v_recipient.campaign_id, v_contact.id, 'reply',
        p_occurred_at, NULL, jsonb_build_object('source', 'whatsapp_inbound')
      ) RETURNING id INTO v_attribution_id;
      INSERT INTO public.myhonor_reactivation_audit_events (
        user_id, company_id, actor_kind, actor_hash, action, entity_type,
        entity_id, details, occurred_at
      ) VALUES (
        p_user_id, btrim(p_company_id), 'provider', p_actor_hash,
        'attribution.recorded', 'attribution', v_attribution_id,
        jsonb_build_object('kind', 'reply', 'campaign_id', v_recipient.campaign_id),
        v_now
      );
    END IF;

    IF p_opt_out THEN
      v_unsubscribe_event_id := 'whatsapp:unsubscribe:'
        || encode(sha256(convert_to(p_event_id, 'UTF8')), 'hex');
      v_unsubscribe_hash := encode(sha256(convert_to(
        p_event_hash || ':unsubscribe', 'UTF8'
      )), 'hex');
      SELECT * INTO v_existing
        FROM public.myhonor_reactivation_attributions
       WHERE user_id = p_user_id
         AND company_id = btrim(p_company_id)
         AND event_id = v_unsubscribe_event_id;
      IF FOUND AND (
        v_existing.event_hash <> v_unsubscribe_hash
        OR v_existing.recipient_id <> v_recipient.id
        OR v_existing.attribution_kind <> 'unsubscribe'
      ) THEN
        RAISE EXCEPTION 'inbound unsubscribe idempotency conflict'
          USING ERRCODE = '23505';
      ELSIF NOT FOUND THEN
        INSERT INTO public.myhonor_reactivation_attributions (
          user_id, company_id, event_id, event_hash, recipient_id, campaign_id,
          contact_id, attribution_kind, occurred_at, value_kzt, details
        ) VALUES (
          p_user_id, btrim(p_company_id), v_unsubscribe_event_id,
          v_unsubscribe_hash, v_recipient.id, v_recipient.campaign_id,
          v_contact.id, 'unsubscribe', p_occurred_at, NULL,
          jsonb_build_object('source', 'whatsapp_inbound')
        ) RETURNING id INTO v_attribution_id;
        INSERT INTO public.myhonor_reactivation_audit_events (
          user_id, company_id, actor_kind, actor_hash, action, entity_type,
          entity_id, details, occurred_at
        ) VALUES (
          p_user_id, btrim(p_company_id), 'provider', p_actor_hash,
          'attribution.recorded', 'attribution', v_attribution_id,
          jsonb_build_object(
            'kind', 'unsubscribe', 'campaign_id', v_recipient.campaign_id
          ),
          v_now
        );
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    CASE WHEN v_recipient.id IS NULL THEN NULL ELSE v_recipient.id END,
    p_opt_out AND COALESCE(
      'whatsapp_opt_out' = ANY(v_active_reasons), FALSE
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_myhonor_reactivation_recipient_previews(
  p_user_id UUID,
  p_company_id TEXT,
  p_campaign_id UUID,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  recipient_id UUID,
  preview_snapshot_hash TEXT,
  phone_masked TEXT,
  locale TEXT,
  recipient_state TEXT,
  exclusion_reason TEXT,
  is_holdout BOOLEAN,
  consent_snapshot JSONB,
  eligibility_snapshot JSONB,
  recommendation_snapshot JSONB,
  template_parameters_ciphertext TEXT,
  template_parameters_hash TEXT,
  run_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_campaign_id IS NULL
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'invalid recipient preview request' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    recipient.id,
    campaign.preview_snapshot_hash,
    contact.phone_masked,
    recipient.locale_snapshot,
    recipient.state,
    recipient.exclusion_reason,
    recipient.is_holdout,
    recipient.consent_snapshot,
    recipient.eligibility_snapshot,
    recipient.recommendation_snapshot,
    recipient.template_parameters_ciphertext,
    recipient.template_parameters_hash,
    recipient.run_at
  FROM public.myhonor_reactivation_recipients AS recipient
  JOIN public.myhonor_reactivation_campaigns AS campaign
    ON campaign.id = recipient.campaign_id
   AND campaign.user_id = recipient.user_id
   AND campaign.company_id = recipient.company_id
  JOIN public.myhonor_reactivation_contacts AS contact
    ON contact.id = recipient.contact_id
   AND contact.user_id = recipient.user_id
   AND contact.company_id = recipient.company_id
  WHERE recipient.user_id = p_user_id
    AND recipient.company_id = btrim(p_company_id)
    AND recipient.campaign_id = p_campaign_id
  ORDER BY
    CASE recipient.state
      WHEN 'queued' THEN 0
      WHEN 'preview' THEN 1
      WHEN 'holdout' THEN 2
      WHEN 'excluded' THEN 3
      ELSE 4
    END,
    recipient.created_at,
    recipient.id
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_myhonor_reactivation_outbound_context(
  p_user_id UUID,
  p_company_id TEXT,
  p_recipient_id UUID
)
RETURNS TABLE (
  recipient_id UUID,
  campaign_id UUID,
  segment TEXT,
  template_name TEXT,
  template_language TEXT,
  template_parameters_ciphertext TEXT,
  provider_message_id TEXT,
  provider_accepted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'invalid outbound context request' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    recipient.id,
    recipient.campaign_id,
    campaign.segment,
    campaign.template_name,
    campaign.template_language,
    recipient.template_parameters_ciphertext,
    recipient.provider_message_id,
    recipient.provider_accepted_at
  FROM public.myhonor_reactivation_recipients AS recipient
  JOIN public.myhonor_reactivation_campaigns AS campaign
    ON campaign.id = recipient.campaign_id
   AND campaign.user_id = recipient.user_id
   AND campaign.company_id = recipient.company_id
  WHERE recipient.id = p_recipient_id
    AND recipient.user_id = p_user_id
    AND recipient.company_id = btrim(p_company_id)
    AND recipient.state IN ('accepted', 'sent', 'delivered', 'read')
    AND recipient.provider_message_id IS NOT NULL
    AND recipient.provider_accepted_at IS NOT NULL
  LIMIT 1;
END;
$$;

ALTER TABLE public.myhonor_reactivation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_contact_ingest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_suppression_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_provider_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myhonor_reactivation_attributions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.myhonor_reactivation_contacts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_profiles
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_contact_ingest_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_consent_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_suppression_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_campaigns
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_recipients
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_provider_attempts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_audit_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_attributions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_effective_consent
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.myhonor_reactivation_effective_suppressions
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.myhonor_reactivation_reject_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.myhonor_reactivation_protect_campaign_definition()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.myhonor_reactivation_protect_recipient_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.myhonor_reactivation_canonical_jsonb(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.myhonor_reactivation_next_allowed_send_at(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.myhonor_reactivation_jsonb_contains_pii(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.myhonor_reactivation_recommendation_is_live(
  UUID, TEXT, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ingest_myhonor_reactivation_contact_event(
  UUID, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, JSONB, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_myhonor_reactivation_campaign(
  UUID, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.materialize_myhonor_reactivation_campaign(
  UUID, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_myhonor_reactivation_campaign(
  UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_myhonor_reactivation_candidate_context(
  UUID, TEXT, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_myhonor_reactivation_campaign_definition(
  UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_myhonor_reactivation_campaigns(
  UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_myhonor_reactivation_campaign_overview(
  UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_ready_myhonor_reactivation_recipients(
  UUID, TEXT, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_myhonor_reactivation_recipient(
  UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_myhonor_reactivation_recipient(
  UUID, UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_myhonor_reactivation_recipient(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_myhonor_reactivation_delivery_status(
  TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_myhonor_reactivation_suppression(
  UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_myhonor_reactivation_attribution(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, NUMERIC, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_myhonor_reactivation_inbound_signal(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_myhonor_reactivation_recipient_previews(
  UUID, TEXT, UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_myhonor_reactivation_outbound_context(
  UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_myhonor_reactivation_contact_event(
  UUID, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, JSONB, JSONB, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_myhonor_reactivation_campaign(
  UUID, TEXT, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.materialize_myhonor_reactivation_campaign(
  UUID, JSONB, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_myhonor_reactivation_campaign(
  UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_myhonor_reactivation_candidate_context(
  UUID, TEXT, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_myhonor_reactivation_campaign_definition(
  UUID, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_myhonor_reactivation_campaigns(
  UUID, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_myhonor_reactivation_campaign_overview(
  UUID, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_ready_myhonor_reactivation_recipients(
  UUID, TEXT, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_myhonor_reactivation_recipient(
  UUID, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_myhonor_reactivation_recipient(
  UUID, UUID, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_myhonor_reactivation_recipient(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_myhonor_reactivation_delivery_status(
  TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_myhonor_reactivation_suppression(
  UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_myhonor_reactivation_attribution(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, NUMERIC, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_myhonor_reactivation_inbound_signal(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_myhonor_reactivation_recipient_previews(
  UUID, TEXT, UUID, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_myhonor_reactivation_outbound_context(
  UUID, TEXT, UUID
) TO service_role;

NOTIFY pgrst, 'reload schema';
