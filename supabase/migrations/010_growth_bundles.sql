-- 9 связок роста + карта потерь выручки для медицинской вертикали.
-- Одна строка = один расчёт связки для клиники (после аудита базы).
-- Пересчитывается при каждой загрузке новой базы пациентов.

CREATE TABLE IF NOT EXISTS public.growth_bundles (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Ключ связки. Соответствует lib/clinic-bundles.ts
  bundle_key             TEXT         NOT NULL
    CHECK (bundle_key IN (
      'no_show',
      'cross_sell_after_ekg',
      'follow_up_diagnostics',
      'reactivation',
      'nps_referral',
      'instant_callback',
      'upsell_at_booking',
      'seasonal_campaigns',
      'chronic_control'
    )),

  target_segments        TEXT[]       NOT NULL,  -- какие patient_segments.segment обслуживаются
  target_patient_count   INT          NOT NULL,  -- сколько пациентов попадают

  -- Финансовый потенциал
  estimated_conversion   NUMERIC(5,2) NOT NULL,  -- %
  estimated_revenue_kzt  BIGINT       NOT NULL,  -- прогноз выручки/мес

  -- Приоритет запуска (от mат.расчёта ROI)
  priority               INT          NOT NULL,
  complexity             TEXT         NOT NULL
    CHECK (complexity IN ('easy', 'medium', 'hard')),
  effect_timeline        TEXT,                   -- '24-48h', '3-7d', '2-4w', etc

  -- Описание сценария (ai-generated или из шаблона)
  trigger_description    TEXT,
  script_preview         TEXT,

  calculated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (client_id, bundle_key)
);

CREATE INDEX IF NOT EXISTS idx_growth_bundles_client ON public.growth_bundles(client_id, priority);

-- Карта потерь выручки (revenue_losses) — отдельная таблица
CREATE TABLE IF NOT EXISTS public.revenue_losses (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  loss_key            TEXT         NOT NULL
    CHECK (loss_key IN (
      'no_shows',
      'missed_calls',
      'missing_follow_up',
      'missing_upsell',
      'missing_reactivation',
      'missing_chronic_control',
      'weak_nps',
      'missing_seasonal',
      'post_diagnostic_drop'
    )),

  estimated_loss_kzt  BIGINT       NOT NULL,     -- потери в месяц
  severity            TEXT         NOT NULL
    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  source_data         TEXT,                      -- как посчитали (для transparency)
  linked_bundle_key   TEXT,                      -- какая связка закроет

  calculated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (client_id, loss_key)
);

CREATE INDEX IF NOT EXISTS idx_revenue_losses_client ON public.revenue_losses(client_id);

-- RLS -------------------------------------------------------------------------
ALTER TABLE public.growth_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_losses ENABLE ROW LEVEL SECURITY;

-- Client reads own
CREATE POLICY "growth_bundles_client_read_own" ON public.growth_bundles
  FOR SELECT USING (client_id = auth.uid());

CREATE POLICY "revenue_losses_client_read_own" ON public.revenue_losses
  FOR SELECT USING (client_id = auth.uid());

-- Staff reads all (non-recursive via current_user_role helper)
CREATE POLICY "growth_bundles_staff_read" ON public.growth_bundles
  FOR SELECT USING (
    public.current_user_role() IN ('expert', 'admin', 'super_admin')
  );

CREATE POLICY "revenue_losses_staff_read" ON public.revenue_losses
  FOR SELECT USING (
    public.current_user_role() IN ('expert', 'admin', 'super_admin')
  );
