-- In-app notification feed (client-scoped). Named app_notifications to avoid the
-- existing Prisma-owned `notifications` table in the same DB. Auth-user-scoped;
-- RLS: self-read + self-update (mark read/archive); inserts via the service role
-- (createNotification). Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    text NOT NULL DEFAULT 'system',
  priority    text NOT NULL DEFAULT 'medium',
  title       text NOT NULL,
  body        text,
  link        text,
  is_read     boolean NOT NULL DEFAULT false,
  read_at     timestamptz,
  archived_at timestamptz,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_notifications_user_idx ON public.app_notifications(user_id, is_read, created_at DESC);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_notifications' AND policyname='app_notifications_select_own') THEN
    CREATE POLICY app_notifications_select_own ON public.app_notifications
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_notifications' AND policyname='app_notifications_update_own') THEN
    CREATE POLICY app_notifications_update_own ON public.app_notifications
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.app_notifications IS 'In-app notification feed. Self-read + self-update (mark read) via RLS; writes via service role (createNotification).';
