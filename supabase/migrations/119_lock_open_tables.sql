-- 119_lock_open_tables.sql
--
-- public.idempotency_records and public.outbox_events existed on production
-- without row level security and with table grants to anon / authenticated:
-- readable and writable with the public anon key. Neither is used by the
-- application (no code references, both empty on 2026-10-12). Locked down to
-- the service role: RLS on (no policies), API roles revoked.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/119_lock_open_tables.sql

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['idempotency_records', 'outbox_events'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
