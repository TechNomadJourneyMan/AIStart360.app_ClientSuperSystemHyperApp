-- ============================================================================
-- 077: RLS for the four Prisma-owned tables added by 033
--
-- PROBLEM (033_app_share_payments_leads.sql:31-92). mini_gri_leads,
-- shared_reports, subscriptions and payment_transactions were created without
-- ENABLE ROW LEVEL SECURITY and without a single policy. Supabase grants anon
-- and authenticated access to new tables in `public` by default, so with the
-- public anon key anyone could read every lead email + answer set, enumerate
-- share tokens, and read/alter billing rows straight through PostgREST.
--
-- FIX: RLS ON with NO policies + REVOKE from PUBLIC/anon/authenticated — the
-- same "service-role only" shape as 039_user_security.sql and
-- 061_omnichannel_inbox.sql. service_role keeps its grants (and bypasses RLS),
-- so every real caller keeps working.
--
-- WHO ACTUALLY TOUCHES THESE TABLES (checked on 2026-07-29) — all server-side,
-- all service-role or Prisma, none of them the browser anon client:
--   * mini_gri_leads      — app/api/public/mini-gri/route.ts (server route,
--                           service-role PostgREST insert),
--                           app/api/giga-admin/leads/route.ts and
--                           app/api/giga-admin/leads/[id]/route.ts
--                           (createServiceClient).
--   * shared_reports      — lib/share/tokens.ts only (service-role PostgREST),
--                           used by app/api/share/route.ts and the server
--                           component app/r/[token]/page.tsx.
--   * subscriptions       — app/api/checkout/route.ts and
--                           app/api/webhooks/kaspi/route.ts via Prisma (the
--                           DATABASE_URL role is postgres → owner/BYPASSRLS),
--                           app/api/v1/settings/billing/route.ts via srGet()
--                           (service-role; its own comment already notes the
--                           table has no self-read policy).
--   * payment_transactions — app/api/checkout/route.ts and
--                           app/api/webhooks/kaspi/route.ts via Prisma.
-- None of the four is in the supabase_realtime publication, so no realtime
-- subscriber breaks either.
--
-- ONE KNOWN CONSEQUENCE, and it is the point of the fix: lib/share/tokens.ts:23,
-- lib/expert-auth.ts:14 and app/api/public/mini-gri/route.ts:30-33 fall back to
-- NEXT_PUBLIC_SUPABASE_ANON_KEY when SUPABASE_SERVICE_ROLE_KEY is unset. That
-- fallback is exactly the hole being closed — after this migration it returns
-- 401/permission denied instead of silently working. Both call sites are
-- best-effort and log, but SUPABASE_SERVICE_ROLE_KEY must be present in every
-- deployed environment. Verify it before applying.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY, REVOKE, GRANT and COMMENT are all
-- safe to re-run. Additive — no data is read or written.
-- ============================================================================

-- ── Free mini-GRI lead capture (emails + full answer payloads) ───────────────
ALTER TABLE public.mini_gri_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mini_gri_leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mini_gri_leads TO service_role;
COMMENT ON TABLE public.mini_gri_leads IS
  'Free mini-GRI lead magnet captures (email + answers). RLS on, NO policies → service-role only: /api/public/mini-gri writes, /api/giga-admin/leads reads.';

-- ── Shareable report links (bearer tokens — never browsable) ─────────────────
ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shared_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shared_reports TO service_role;
COMMENT ON TABLE public.shared_reports IS
  'Share-link tokens for survey/GRI/point_a/point_b reports. RLS on, NO policies → service-role only (lib/share/tokens.ts); the token must stay unguessable, so the table must never be enumerable by anon.';

-- ── Billing state ───────────────────────────────────────────────────────────
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;
COMMENT ON TABLE public.subscriptions IS
  'Per-tenant subscription tier/status. RLS on, NO policies → Prisma (owner) + service role only; self-scoped reads go through /api/v1/settings/billing, which resolves the tenant id from the session.';

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_transactions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payment_transactions TO service_role;
COMMENT ON TABLE public.payment_transactions IS
  'Acquiring transactions (amounts, provider ids, metadata). RLS on, NO policies → Prisma (owner) + service role only; written by /api/checkout and the Kaspi webhook.';

-- Make PostgREST drop the cached privileges for these tables immediately.
NOTIFY pgrst, 'reload schema';

-- ── Post-apply verification (run MANUALLY) ──────────────────────────────────
--   SELECT c.relname, c.relrowsecurity,
--          has_table_privilege('anon',          c.oid, 'SELECT') AS anon_select,
--          has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
--          has_table_privilege('service_role',  c.oid, 'SELECT') AS sr_select
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('mini_gri_leads','shared_reports','subscriptions','payment_transactions');
--   -- expected: relrowsecurity = t, anon_select = f, auth_select = f, sr_select = t
