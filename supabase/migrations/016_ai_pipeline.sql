-- =============================================================================
-- Migration 016 — AI orchestration pipeline
-- =============================================================================
-- Adds unified AI-extraction layer: runs, raw entities, conflicts, Point B store.
-- Builds on existing:
--   • metrics (001)             — normalized KPI store, source in ('survey'|'document'|'manual'|'calculated')
--   • patient_segments (009)    — RFM segments
--   • growth_bundles (010)      — 9 clinic bundles
--   • revenue_losses (010)      — loss map
--   • documents (001)           — file registry (adds hash/classification cols here)
--
-- RLS: owners read own + staff (current_user_role helper from migration 006).
-- Writes only via service-role.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. documents — add AI classification + hash columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash        TEXT,
  ADD COLUMN IF NOT EXISTS classified_type     TEXT,
  ADD COLUMN IF NOT EXISTS classification_conf DECIMAL(4,3),
  ADD COLUMN IF NOT EXISTS extractor_version   TEXT,
  ADD COLUMN IF NOT EXISTS last_extracted_at   TIMESTAMPTZ;

-- Idempotency: same user + same bytes = one document
CREATE UNIQUE INDEX IF NOT EXISTS documents_content_hash_idx
  ON public.documents(user_id, content_hash)
  WHERE content_hash IS NOT NULL;

COMMENT ON COLUMN public.documents.content_hash       IS 'sha256 of raw file bytes — idempotency + extraction cache key';
COMMENT ON COLUMN public.documents.classified_type    IS 'AI-classified doc_type (Haiku classifier) when upload type = other';
COMMENT ON COLUMN public.documents.classification_conf IS 'Classifier confidence 0..1';
COMMENT ON COLUMN public.documents.extractor_version  IS 'Last extractor@version that processed this doc. Used for re-run on upgrade.';
COMMENT ON COLUMN public.documents.last_extracted_at  IS 'NOW() when last extraction ran successfully';


-- -----------------------------------------------------------------------------
-- 2. ai_runs — master record of each orchestrator run
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_runs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id       TEXT         REFERENCES public.companies(id) ON DELETE SET NULL,

  trigger          TEXT         NOT NULL
                   CHECK (trigger IN ('document_uploaded','survey_completed','manual_rerun','snapshot_changed')),
  trigger_entity   TEXT,                                     -- 'documents.{id}' | 'survey.step.3' | ...

  status           TEXT         NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','completed','failed','partial')),

  steps            JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- [{name,status,duration_ms,model,cost_usd,error?}]
  total_cost_usd   DECIMAL(8,4),
  error            TEXT,

  backbone         TEXT         NOT NULL CHECK (backbone IN ('inngest','n8n','inline')),
  external_run_id  TEXT,                                     -- inngest_run_id or n8n_execution_id

  started_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_runs_user_idx    ON public.ai_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_company_idx ON public.ai_runs(company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_status_idx  ON public.ai_runs(status) WHERE status IN ('running','failed');

COMMENT ON TABLE public.ai_runs IS 'Master record of every AI orchestrator invocation. Powers UI progress strip + audit trail.';


-- -----------------------------------------------------------------------------
-- 3. ai_extractions — raw entities extracted by LLM, pre-normalization
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_extractions (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID         REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  user_id           UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id        TEXT         REFERENCES public.companies(id) ON DELETE SET NULL,

  source_type       TEXT         NOT NULL CHECK (source_type IN ('document','survey','calculated')),
  source_doc_id     UUID         REFERENCES public.documents(id) ON DELETE CASCADE,
  source_field      TEXT,                                   -- 'xlsx.sheet2.cellC12' | 's2_revenue_2024'

  entity_type       TEXT         NOT NULL,                  -- 'metric.revenue' | 'segment.rfm_vip_retention' | 'asset.logo_url'
  value             JSONB        NOT NULL,
  unit              TEXT,                                   -- 'KZT' | '%' | 'days' | NULL
  period_year       INTEGER,
  period_quarter    TEXT         CHECK (period_quarter IS NULL OR period_quarter IN ('Q1','Q2','Q3','Q4')),

  confidence        DECIMAL(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  extractor_name    TEXT         NOT NULL,
  extractor_version TEXT         NOT NULL,
  raw_excerpt       TEXT,                                   -- evidence quote (first 200 chars)

  superseded_by     UUID         REFERENCES public.ai_extractions(id),   -- when newer/better extraction wins

  extracted_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_extractions_company_type_idx
  ON public.ai_extractions(company_id, entity_type, period_year, period_quarter);
CREATE INDEX IF NOT EXISTS ai_extractions_doc_idx
  ON public.ai_extractions(source_doc_id);
CREATE INDEX IF NOT EXISTS ai_extractions_user_idx
  ON public.ai_extractions(user_id, extracted_at DESC);
CREATE INDEX IF NOT EXISTS ai_extractions_active_idx
  ON public.ai_extractions(company_id, entity_type)
  WHERE superseded_by IS NULL;

COMMENT ON TABLE public.ai_extractions IS 'Append-only audit trail of LLM extractions. Normalized numbers flow into public.metrics afterwards.';
COMMENT ON COLUMN public.ai_extractions.superseded_by IS 'When a newer extraction wins consensus, losers point to winner here. Active = where superseded_by IS NULL.';


-- -----------------------------------------------------------------------------
-- 4. ai_conflicts — registered disagreements between sources (UI badge)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_conflicts (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     TEXT         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  entity_type    TEXT         NOT NULL,
  period_year    INTEGER,
  period_quarter TEXT         CHECK (period_quarter IS NULL OR period_quarter IN ('Q1','Q2','Q3','Q4')),

  resolution     TEXT         NOT NULL DEFAULT 'auto'
                 CHECK (resolution IN ('auto','manual','pending')),
  winner_id      UUID         REFERENCES public.ai_extractions(id),
  contenders     JSONB        NOT NULL,                   -- [{extraction_id, value, confidence, source_type, extractor_name}]

  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID         REFERENCES public.profiles(id),

  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_conflicts_company_idx ON public.ai_conflicts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_conflicts_pending_idx ON public.ai_conflicts(company_id) WHERE resolution = 'pending';

COMMENT ON TABLE public.ai_conflicts IS 'Multi-source disagreements. resolution=auto when consensus resolved cleanly; pending when gap > 20%.';


-- -----------------------------------------------------------------------------
-- 5. point_b_analysis — target state output (previously only returned inline)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.point_b_analysis (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnostic_id     UUID         NOT NULL REFERENCES public.diagnostics(id) ON DELETE CASCADE,

  horizon_months    INTEGER      DEFAULT 12,

  target_overall    DECIMAL(5,2),
  target_health     DECIMAL(5,2),
  target_stage      TEXT         CHECK (target_stage IS NULL OR target_stage IN ('seed','early','growth','scale','mature')),
  target_blocks     JSONB,                                   -- {finance:82, sales:75, ...}
  target_kpis       JSONB,                                   -- [{label,current,target,progress}]

  gap_analysis      JSONB,                                   -- [{title,gap,action,priority_level,icon,color}]
  roadmap           JSONB,                                   -- [{q,title,desc,icon,status}]
  ai_strategy       JSONB,                                   -- {strategic_bridge_summary,milestones[]}

  ai_status         TEXT         DEFAULT 'none'
                    CHECK (ai_status IN ('none','processing','completed','failed')),
  ai_error          TEXT,

  is_current        BOOLEAN      NOT NULL DEFAULT TRUE,
  calculated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS point_b_diag_idx    ON public.point_b_analysis(diagnostic_id);
CREATE INDEX IF NOT EXISTS point_b_current_idx ON public.point_b_analysis(diagnostic_id, is_current) WHERE is_current = TRUE;

COMMENT ON TABLE public.point_b_analysis IS 'Target state + gap analysis + 4-quarter roadmap + AI strategy. Mirrors diagnostics versioning pattern.';

-- Versioning trigger: new row → mark previous as not current
CREATE OR REPLACE FUNCTION public.set_point_b_current()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.point_b_analysis
  SET    is_current = FALSE
  WHERE  diagnostic_id = NEW.diagnostic_id
    AND  id           != NEW.id
    AND  is_current   = TRUE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS point_b_versioning ON public.point_b_analysis;
CREATE TRIGGER point_b_versioning
  AFTER INSERT ON public.point_b_analysis
  FOR EACH ROW EXECUTE FUNCTION public.set_point_b_current();


-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- ai_runs ---------------------------------------------------------------------
ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_runs_owner_read" ON public.ai_runs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "ai_runs_staff_read" ON public.ai_runs
  FOR SELECT USING (
    public.current_user_role() IN ('expert','admin','super_admin')
  );

-- Writes via service role only (no INSERT/UPDATE policy)


-- ai_extractions --------------------------------------------------------------
ALTER TABLE public.ai_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_extractions_owner_read" ON public.ai_extractions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "ai_extractions_staff_read" ON public.ai_extractions
  FOR SELECT USING (
    public.current_user_role() IN ('expert','admin','super_admin')
  );


-- ai_conflicts ----------------------------------------------------------------
ALTER TABLE public.ai_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_conflicts_owner_read" ON public.ai_conflicts
  FOR SELECT USING (
    company_id IN (
      SELECT c.id FROM public.companies c WHERE c.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_conflicts_staff_read" ON public.ai_conflicts
  FOR SELECT USING (
    public.current_user_role() IN ('expert','admin','super_admin')
  );

-- Client can RESOLVE own conflicts (update resolution + resolved_by)
CREATE POLICY "ai_conflicts_owner_resolve" ON public.ai_conflicts
  FOR UPDATE USING (
    company_id IN (SELECT c.id FROM public.companies c WHERE c.user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT c.id FROM public.companies c WHERE c.user_id = auth.uid())
  );


-- point_b_analysis ------------------------------------------------------------
ALTER TABLE public.point_b_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "point_b_owner_read" ON public.point_b_analysis
  FOR SELECT USING (
    diagnostic_id IN (
      SELECT d.id FROM public.diagnostics d WHERE d.user_id = auth.uid()
    )
  );

CREATE POLICY "point_b_staff_read" ON public.point_b_analysis
  FOR SELECT USING (
    public.current_user_role() IN ('expert','admin','super_admin')
  );


-- =============================================================================
-- Grants (service role bypasses RLS; named roles for documentation)
-- =============================================================================
GRANT SELECT ON public.ai_runs          TO authenticated;
GRANT SELECT ON public.ai_extractions   TO authenticated;
GRANT SELECT, UPDATE ON public.ai_conflicts TO authenticated;
GRANT SELECT ON public.point_b_analysis TO authenticated;
