-- RFM-сегментация пациентов для медицинской вертикали.
-- Одна строка = один пациент клиники, сегментированный по recency/frequency/monetary.
-- Клиника-владелец определяется через client_id (ссылка на profiles с role='client').
-- Телефон хранится как hash (sha256) чтобы не светить ПДн в таблицах, но при этом
-- можно матчить одного пациента через разные аплоады базы.

CREATE TABLE IF NOT EXISTS public.patient_segments (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Хэш телефона (sha256). Сырой номер не храним.
  patient_hash      TEXT         NOT NULL,
  -- Для UI можем показать имя, но без контактов.
  display_name      TEXT,

  -- RFM-признаки
  recency_days      INT          NOT NULL,   -- дней с последнего визита
  frequency         INT          NOT NULL,   -- визитов за 12 мес
  monetary_kzt      BIGINT       NOT NULL,   -- суммарный LTV в тенге

  -- Вычисленный сегмент. См. lib/rfm-segmentation.ts
  segment           TEXT         NOT NULL
    CHECK (segment IN (
      'vip_retention',      -- S1: LTV ≥80k ₸, визит ≤90 дней
      'vip_reactivation',   -- S2: LTV ≥80k ₸, визит >90 дней
      'loyal_active',       -- S3: 2+ визитов, ≤90 дней
      'churn_risk',         -- S4: 2+ визитов, 91–180 дней
      'sleeping',           -- S6: >180 дней с последнего визита
      'one_time_fresh',     -- S7: 1 визит, ≤90 дней
      'one_time_old',       -- S8: 1 визит, >90 дней
      'dead_lead'           -- S5: 0 визитов (контакт без приёмов)
    )),

  -- Приоритет обзвона: 1 = самый высокий
  priority          INT          NOT NULL,

  -- Из какой загрузки (documents.id — patient_base файл)
  source_document_id UUID         REFERENCES public.documents(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Один клиент — один пациент (uniq по hash)
  UNIQUE (client_id, patient_hash)
);

CREATE INDEX IF NOT EXISTS idx_patient_segments_client ON public.patient_segments(client_id);
CREATE INDEX IF NOT EXISTS idx_patient_segments_segment ON public.patient_segments(client_id, segment);
CREATE INDEX IF NOT EXISTS idx_patient_segments_priority ON public.patient_segments(client_id, priority);

-- updated_at auto-trigger (use existing helper from migration 001)
DROP TRIGGER IF EXISTS patient_segments_updated_at ON public.patient_segments;
CREATE TRIGGER patient_segments_updated_at
  BEFORE UPDATE ON public.patient_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
ALTER TABLE public.patient_segments ENABLE ROW LEVEL SECURITY;

-- Client reads only own segments
CREATE POLICY "patient_segments_client_read_own" ON public.patient_segments
  FOR SELECT USING (client_id = auth.uid());

-- Experts/admins read any (uses non-recursive helper from migration 006)
CREATE POLICY "patient_segments_staff_read" ON public.patient_segments
  FOR SELECT USING (
    public.current_user_role() IN ('expert', 'admin', 'super_admin')
  );

-- Inserts/updates only via service role (routes use sr REST fetch)
-- no explicit INSERT/UPDATE policy → RLS blocks direct user writes
