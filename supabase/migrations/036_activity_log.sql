-- Журнал действий (client-scoped activity log).
-- Auth-user-scoped (references auth.users, matches the Supabase client model —
-- Prisma's activity_logs.userId points at the separate Prisma User table and
-- can't hold Supabase client ids). RLS: users read only their own rows; no
-- UPDATE/DELETE policy → immutable from the app; inserts go through the service
-- role (logActivity). Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      text NOT NULL,
  category    text NOT NULL DEFAULT 'system',
  description text,
  severity    text NOT NULL DEFAULT 'info',
  status      text NOT NULL DEFAULT 'success',
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_user_created_idx ON public.activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_user_category_idx ON public.activity_log(user_id, category);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'activity_log' AND policyname = 'activity_log_select_own'
  ) THEN
    CREATE POLICY activity_log_select_own ON public.activity_log
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.activity_log IS 'Client-facing activity journal. Immutable: SELECT-own via RLS, writes via service role (logActivity).';
