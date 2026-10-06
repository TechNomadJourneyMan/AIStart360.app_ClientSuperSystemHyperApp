-- 106_billing_unify.sql
--
-- One source of truth for a client's plan (W8, «оплата из админки»).
--
-- Before: four writers disagreed. The trial checkout wrote subscriptions
-- (pilot/trialing) but never profiles.tier; the Kaspi webhook wrote both in
-- two unrelated calls; the GIGA access editor wrote profiles.tier only, so a
-- plan granted by an administrator never reached subscriptions and Settings ›
-- Биллинг showed «нет подписки» to a paying-by-agreement client; nothing ever
-- ended an expired trial or period.
--
-- After: lib/payments/billing.ts is the only writer and calls
-- billing_set_plan(), which changes subscriptions AND profiles.tier in one
-- transaction (row locks on both), so the access gate (profiles.tier,
-- migration 048) and the billing record cannot drift apart.
--
--   subscriptions."source"      who set the current plan:
--                               admin  — назначен администратором (GIGA)
--                               trial  — пробный период (checkout pilot)
--                               kaspi  — оплачен через Kaspi (webhook)
--                               stub   — демо-эквайринг (no money moved)
--                               system — переведён на free по окончании срока
--   subscriptions."note"        free-text reason from the administrator
--   subscriptions."assignedBy"  actor id (profiles UUID, 'kaspi:webhook',
--                               'system:billing-expiry', or the user for a trial)
--
-- Tier mapping (subscriptions.tier → profiles.tier): free → free;
-- pilot / pro / enterprise → pro. feature_flags (per-user overrides set in
-- GIGA) are never touched by a plan change.
-- 'free' is not a SubscriptionTier: a downgrade keeps the last tier for
-- history and sets status = 'canceled'.
-- One person may hold rows under both tenant keys (companies.id and the user
-- id): a deliberate change cancels the other live rows; the expiry job leaves
-- profiles.tier alone while another live row still entitles the person.
--
-- Timestamps: the Prisma columns are TIMESTAMP(3) WITHOUT TIME ZONE holding
-- UTC; inputs arrive as timestamptz and are converted with AT TIME ZONE 'UTC'.
--
-- Functions are SECURITY DEFINER, EXECUTE for service_role only.
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/106_billing_unify.sql

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS "source"     TEXT,
  ADD COLUMN IF NOT EXISTS "note"       TEXT,
  ADD COLUMN IF NOT EXISTS "assignedBy" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_source_check') THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_source_check
      CHECK ("source" IS NULL OR "source" IN ('admin', 'trial', 'kaspi', 'stub', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_note_length') THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_note_length CHECK ("note" IS NULL OR length("note") <= 1000);
  END IF;
END $$;

-- Rows the expiry job looks at: still entitled, with an end date.
CREATE INDEX IF NOT EXISTS subscriptions_trial_due_idx
  ON public.subscriptions ("trialEndsAt") WHERE status = 'trialing';
CREATE INDEX IF NOT EXISTS subscriptions_period_due_idx
  ON public.subscriptions ("currentPeriodEnd") WHERE status IN ('active', 'past_due');

-- Legacy rows: name their source from what they hold, so Settings › Биллинг
-- can say how the plan was obtained.
UPDATE public.subscriptions SET "source" = CASE
    WHEN provider = 'kaspi' THEN 'kaspi'
    WHEN provider IS NOT NULL THEN 'stub'
    WHEN status = 'trialing' THEN 'trial'
    ELSE NULL
  END
WHERE "source" IS NULL;

-- Pro granted by an administrator before 106 lived only in profiles.tier
-- (the old GIGA editor never wrote subscriptions), often next to the client's
-- old trial row. Left alone, the expiry cron would read that trial as expired
-- and take Pro away. The old trial checkout never wrote profiles.tier, so
-- profiles.tier = 'pro' with a trialing row and no paid row can only come from
-- an administrator: that row becomes an open-ended admin Pro (other trialing
-- rows of the same person are closed). Paid rows (active / past_due) with an
-- expired period are ambiguous (Kaspi month vs. admin grant): they are only
-- LISTED for a manual check before the cron runs. Idempotent.
DO $$
DECLARE
  v_converted TEXT;
  v_review    TEXT;
BEGIN
  WITH person_rows AS (
    SELECT p.id AS user_id, s.id AS sub_id, s."orgId" AS org_id, s.status::text AS status,
           s."trialEndsAt" AS trial_end
      FROM public.profiles p
      JOIN public.subscriptions s
        ON s."orgId" = p.id::text
        OR s."orgId" IN (SELECT c.id FROM public.companies c WHERE c.user_id = p.id)
     WHERE p.tier = 'pro'
  ), people AS (
    SELECT user_id FROM person_rows
     GROUP BY user_id
    HAVING bool_or(status = 'trialing') AND NOT bool_or(status IN ('active', 'past_due'))
  ), keep AS (
    SELECT DISTINCT ON (r.user_id) r.user_id, r.sub_id
      FROM person_rows r JOIN people USING (user_id)
     WHERE r.status = 'trialing'
     ORDER BY r.user_id, r.trial_end DESC NULLS LAST, r.sub_id
  ), closed AS (
    UPDATE public.subscriptions s
       SET status = 'canceled', "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM person_rows r JOIN people USING (user_id)
     WHERE s.id = r.sub_id AND r.status = 'trialing'
       AND r.sub_id NOT IN (SELECT sub_id FROM keep)
    RETURNING s.id
  ), converted AS (
    UPDATE public.subscriptions s
       SET tier = 'pro', status = 'active', "currentPeriodEnd" = NULL, "source" = 'admin',
           note = 'Pro назначен администратором до миграции 106 (перенесено из profiles.tier)',
           "assignedBy" = 'migration:106', "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM keep k
     WHERE s.id = k.sub_id
    RETURNING s."orgId"
  )
  SELECT string_agg("orgId", ', ') INTO v_converted FROM converted;
  IF v_converted IS NOT NULL THEN
    RAISE NOTICE '106: admin-granted Pro moved onto subscriptions (old trial rows): %', v_converted;
  END IF;

  SELECT string_agg(DISTINCT s."orgId", ', ') INTO v_review
    FROM public.profiles p
    JOIN public.subscriptions s
      ON s."orgId" = p.id::text
      OR s."orgId" IN (SELECT c.id FROM public.companies c WHERE c.user_id = p.id)
   WHERE p.tier = 'pro'
     AND s.status IN ('active', 'past_due')
     AND s."currentPeriodEnd" IS NOT NULL
     AND s."currentPeriodEnd" <= (now() AT TIME ZONE 'UTC');
  IF v_review IS NOT NULL THEN
    RAISE NOTICE '106: CHECK BEFORE ENABLING the billing-expiry cron — profiles with Pro whose paid period has ended (the cron will move them to free): %', v_review;
  END IF;
END $$;

-- ─── Expired = entitled status whose end date has passed ────────────────────
CREATE OR REPLACE FUNCTION public.billing_is_expired(
  p_status TEXT, p_trial_ends_at TIMESTAMP, p_period_end TIMESTAMP, p_now TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_status = 'trialing' THEN p_trial_ends_at IS NOT NULL AND p_trial_ends_at <= (p_now AT TIME ZONE 'UTC')
    WHEN p_status IN ('active', 'past_due') THEN p_period_end IS NOT NULL AND p_period_end <= (p_now AT TIME ZONE 'UTC')
    ELSE false
  END
$$;

-- ─── The only write path ────────────────────────────────────────────────────
-- p_only_if_expired: the expiry job's guard. The row is re-checked under its
-- lock, so a period an administrator extended a moment ago is not downgraded,
-- and a second run finds nothing to do.
-- p_payment_tx: a payment callback (Kaspi). The payment_transactions row is
-- marked succeeded in the SAME transaction as the plan change, and only while
-- it is not final yet — a repeated callback (retry after a lost response,
-- duplicate delivery) changes nothing, so a month is never added twice.
-- p_extend_months: a paid month counted from the end of the person's live
-- paid period (any tenant key), read under the row locks — two payments at
-- once each add their month. An open-ended live plan stays open-ended.
-- Lock order (deadlock-free): payment row, then every subscription row of the
-- person ordered by key, then the profile.
DROP FUNCTION IF EXISTS public.billing_set_plan(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.billing_set_plan(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT);
CREATE OR REPLACE FUNCTION public.billing_set_plan(
  p_org_id          TEXT,
  p_user_id         UUID,
  p_tier            TEXT,
  p_period_end      TIMESTAMPTZ,
  p_source          TEXT,
  p_provider        TEXT    DEFAULT NULL,
  p_note            TEXT    DEFAULT NULL,
  p_actor           TEXT    DEFAULT NULL,
  p_only_if_expired BOOLEAN DEFAULT false,
  p_now             TIMESTAMPTZ DEFAULT now(),
  p_payment_tx      TEXT    DEFAULT NULL,
  p_extend_months   INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before         public.subscriptions%ROWTYPE;
  v_after          public.subscriptions%ROWTYPE;
  v_has_before     BOOLEAN;
  v_profile_before TEXT;
  v_profile_found  BOOLEAN := false;
  v_access         TEXT;
  v_now_utc        TIMESTAMP := (p_now AT TIME ZONE 'UTC');
  v_end_utc        TIMESTAMP := (p_period_end AT TIME ZONE 'UTC');
  v_status         TEXT;
  v_keep_access    BOOLEAN := false;
  v_siblings       TEXT[]  := ARRAY[]::TEXT[];
BEGIN
  IF p_org_id IS NULL OR length(p_org_id) = 0 OR length(p_org_id) > 128 THEN
    RAISE EXCEPTION 'billing_set_plan: org id required' USING ERRCODE = '22023';
  END IF;
  IF p_tier IS NULL OR p_tier NOT IN ('free', 'pilot', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'billing_set_plan: unknown tier %', p_tier USING ERRCODE = '22023';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('admin', 'trial', 'kaspi', 'stub', 'system') THEN
    RAISE EXCEPTION 'billing_set_plan: unknown source %', p_source USING ERRCODE = '22023';
  END IF;
  IF p_extend_months IS NOT NULL AND (p_extend_months < 1 OR p_extend_months > 36 OR p_tier IN ('free', 'pilot')) THEN
    RAISE EXCEPTION 'billing_set_plan: bad extension' USING ERRCODE = '22023';
  END IF;
  IF p_tier = 'pilot' AND p_period_end IS NULL THEN
    RAISE EXCEPTION 'billing_set_plan: a trial needs an end date' USING ERRCODE = '22023';
  END IF;

  IF p_payment_tx IS NOT NULL THEN
    -- Row lock: a concurrent duplicate callback waits here, then finds the
    -- payment final and stops.
    UPDATE public.payment_transactions
       SET status = 'succeeded'
     WHERE id = p_payment_tx AND status NOT IN ('succeeded', 'failed');
    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'payment_already_final', 'org_id', p_org_id, 'user_id', p_user_id);
    END IF;
  END IF;

  -- Sibling tenant keys of the person, then lock all their rows in key order
  -- before the profile: every caller takes the locks in the same order.
  IF p_user_id IS NOT NULL THEN
    SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_siblings
      FROM (
        SELECT c.id AS k FROM public.companies c WHERE c.user_id = p_user_id
        UNION SELECT p_user_id::text
      ) keys
     WHERE k <> p_org_id;
  END IF;
  PERFORM 1 FROM public.subscriptions
   WHERE "orgId" = p_org_id OR "orgId" = ANY (v_siblings)
   ORDER BY "orgId"
   FOR UPDATE;

  SELECT * INTO v_before FROM public.subscriptions WHERE "orgId" = p_org_id;
  v_has_before := FOUND;

  IF p_only_if_expired AND NOT (
    v_has_before AND public.billing_is_expired(v_before.status::text, v_before."trialEndsAt", v_before."currentPeriodEnd", p_now)
  ) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_expired', 'org_id', p_org_id, 'user_id', p_user_id);
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT tier INTO v_profile_before FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    v_profile_found := FOUND;
    -- A plan for a person who has no profile would grant nothing: refuse,
    -- so the caller reports it instead of «saved» with no effect.
    IF NOT v_profile_found THEN
      RAISE EXCEPTION 'billing_set_plan: profile % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  v_access := CASE WHEN p_tier = 'free' THEN 'free' ELSE 'pro' END;

  -- The same person may have rows under both tenant keys (company id and user
  -- id). A deliberate change supersedes the other live rows, so one live plan
  -- remains; the expiry job never takes away access that another live row
  -- still pays for.
  IF p_extend_months IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.subscriptions s
       WHERE (s."orgId" = p_org_id OR s."orgId" = ANY (v_siblings))
         AND s.status IN ('active', 'past_due') AND s."currentPeriodEnd" IS NULL
    ) THEN
      v_end_utc := NULL;
    ELSE
      SELECT GREATEST(v_now_utc, coalesce(max(s."currentPeriodEnd"), v_now_utc))
        INTO v_end_utc
        FROM public.subscriptions s
       WHERE (s."orgId" = p_org_id OR s."orgId" = ANY (v_siblings))
         AND s.status IN ('active', 'past_due');
      v_end_utc := v_end_utc + make_interval(months => p_extend_months);
    END IF;
  END IF;

  IF p_user_id IS NOT NULL THEN
    IF p_only_if_expired THEN
      v_keep_access := EXISTS (
        SELECT 1 FROM public.subscriptions s
         WHERE s."orgId" = ANY (v_siblings)
           AND s.status IN ('trialing', 'active', 'past_due')
           AND NOT public.billing_is_expired(s.status::text, s."trialEndsAt", s."currentPeriodEnd", p_now)
      );
    ELSE
      UPDATE public.subscriptions
         SET status = 'canceled', "updatedAt" = v_now_utc
       WHERE "orgId" = ANY (v_siblings) AND status IN ('trialing', 'active', 'past_due');
    END IF;
  END IF;

  IF p_tier = 'free' THEN
    IF v_has_before THEN
      UPDATE public.subscriptions
         SET status = 'canceled', "source" = p_source, note = p_note, "assignedBy" = p_actor, "updatedAt" = v_now_utc
       WHERE id = v_before.id
      RETURNING * INTO v_after;
    END IF;
  ELSE
    v_status := CASE WHEN p_tier = 'pilot' THEN 'trialing' ELSE 'active' END;
    INSERT INTO public.subscriptions AS s
      (id, "orgId", tier, status, provider, "trialEndsAt", "currentPeriodEnd", "source", note, "assignedBy", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid()::text, p_org_id, p_tier::"SubscriptionTier", v_status::"SubscriptionStatus",
      p_provider::"AcquiringProvider",
      CASE WHEN p_tier = 'pilot' THEN v_end_utc ELSE NULL END,
      CASE WHEN p_tier = 'pilot' THEN NULL ELSE v_end_utc END,
      p_source, p_note, p_actor, v_now_utc, v_now_utc
    )
    ON CONFLICT ("orgId") DO UPDATE SET
      tier               = EXCLUDED.tier,
      status             = EXCLUDED.status,
      provider           = EXCLUDED.provider,
      "trialEndsAt"      = CASE WHEN EXCLUDED.tier = 'pilot' THEN EXCLUDED."trialEndsAt" ELSE s."trialEndsAt" END,
      "currentPeriodEnd" = EXCLUDED."currentPeriodEnd",
      "source"           = EXCLUDED."source",
      note               = EXCLUDED.note,
      "assignedBy"       = EXCLUDED."assignedBy",
      "updatedAt"        = EXCLUDED."updatedAt"
    RETURNING * INTO v_after;
  END IF;

  IF v_profile_found AND NOT v_keep_access THEN
    UPDATE public.profiles SET tier = v_access WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'org_id', p_org_id,
    'user_id', p_user_id,
    'before', CASE WHEN v_has_before THEN to_jsonb(v_before) ELSE NULL END,
    'after', CASE WHEN v_after.id IS NOT NULL THEN to_jsonb(v_after) ELSE NULL END,
    'profile_tier_before', v_profile_before,
    'profile_tier', CASE WHEN NOT v_profile_found THEN NULL
                         WHEN v_keep_access THEN v_profile_before
                         ELSE v_access END,
    'kept_access', v_keep_access
  );
END;
$$;

-- ─── What the expiry job has to do ──────────────────────────────────────────
-- Each due subscription with the person it belongs to (companies.user_id for a
-- company tenant key, else the key itself when it is a profile id).
CREATE OR REPLACE FUNCTION public.billing_due_expirations(
  p_now   TIMESTAMPTZ DEFAULT now(),
  p_limit INTEGER     DEFAULT 500
) RETURNS TABLE (org_id TEXT, user_id UUID, tier TEXT, status TEXT, ends_at TIMESTAMP)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s."orgId",
         COALESCE(
           (SELECT c.user_id FROM public.companies c WHERE c.id = s."orgId" LIMIT 1),
           (SELECT p.id FROM public.profiles p WHERE p.id::text = s."orgId" LIMIT 1)
         ),
         s.tier::text,
         s.status::text,
         CASE WHEN s.status = 'trialing' THEN s."trialEndsAt" ELSE s."currentPeriodEnd" END
    FROM public.subscriptions s
   WHERE public.billing_is_expired(s.status::text, s."trialEndsAt", s."currentPeriodEnd", p_now)
   ORDER BY 5 ASC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 5000))
$$;

REVOKE EXECUTE ON FUNCTION public.billing_is_expired(TEXT, TIMESTAMP, TIMESTAMP, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_set_plan(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_due_expirations(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_is_expired(TEXT, TIMESTAMP, TIMESTAMP, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_set_plan(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_due_expirations(TIMESTAMPTZ, INTEGER) TO service_role;
