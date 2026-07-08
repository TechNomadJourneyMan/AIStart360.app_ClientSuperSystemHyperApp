-- 043_gri_calc_sessions.sql
-- Сессии GRI-калькулятора: кросс-девайс история «Сохранить сессию» /
-- «Сравнить с прошлым» (раньше — только localStorage['gri_history']).
-- Применение: node scripts/apply-migration.js supabase/migrations/043_gri_calc_sessions.sql

CREATE TABLE IF NOT EXISTS public.gri_calc_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  scores JSONB NOT NULL,
  gri_index NUMERIC(4,2) NOT NULL,
  niche TEXT NOT NULL DEFAULT 'general',
  size TEXT NOT NULL DEFAULT 'small',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gri_calc_sessions_user_created
  ON public.gri_calc_sessions (user_id, created_at DESC);

ALTER TABLE public.gri_calc_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gri_calc_sessions_select_own ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_select_own ON public.gri_calc_sessions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_calc_sessions_insert_own ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_insert_own ON public.gri_calc_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_calc_sessions_delete_own ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_delete_own ON public.gri_calc_sessions
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_calc_sessions_select_admin ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_select_admin ON public.gri_calc_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

NOTIFY pgrst, 'reload schema';
