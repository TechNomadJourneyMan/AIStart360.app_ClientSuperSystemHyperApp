-- 042_dashboard_layouts.sql
-- DASH-01/05: per-user dashboard layout persistence.
--
-- The widget engine (components/dashboard/WidgetGrid) persisted only to
-- localStorage, so a user's layout was lost across devices and clients got no
-- customization at all. This table stores the layout server-side, keyed by
-- (user_id, surface) so a user can have distinct layouts for 'client',
-- 'admin', 'medical', etc. Self-scoped RLS — a user sees/edits only their own.

CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surface    TEXT        NOT NULL DEFAULT 'client',
  layout     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, surface)
);

ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_layouts_select_own ON public.dashboard_layouts;
CREATE POLICY dashboard_layouts_select_own ON public.dashboard_layouts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS dashboard_layouts_insert_own ON public.dashboard_layouts;
CREATE POLICY dashboard_layouts_insert_own ON public.dashboard_layouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS dashboard_layouts_update_own ON public.dashboard_layouts;
CREATE POLICY dashboard_layouts_update_own ON public.dashboard_layouts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS dashboard_layouts_delete_own ON public.dashboard_layouts;
CREATE POLICY dashboard_layouts_delete_own ON public.dashboard_layouts
  FOR DELETE USING (auth.uid() = user_id);
