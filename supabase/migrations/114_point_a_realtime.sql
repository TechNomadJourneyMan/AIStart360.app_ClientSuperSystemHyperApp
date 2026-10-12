-- 114_point_a_realtime.sql
--
-- The Point A page (/client/point-a, spec §4) refreshes itself when a new
-- snapshot is written or a data discrepancy opens / closes: both tables join
-- the supabase_realtime publication. RLS (can_read_company) still scopes what
-- a subscriber receives.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/114_point_a_realtime.sql

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['point_a_snapshots', 'data_discrepancies'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.point_a_snapshots REPLICA IDENTITY FULL;
ALTER TABLE public.data_discrepancies REPLICA IDENTITY FULL;
