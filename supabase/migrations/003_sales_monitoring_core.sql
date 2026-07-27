-- Sales monitoring + management accounting + grounded RAG
-- Canonical migration. Apply through Supabase migrations; do not run ad-hoc.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gist;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sales-imports', 'sales-imports', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('knowledge-documents', 'knowledge-documents', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Access model
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_role_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN (
                    'owner', 'director', 'admin', 'sales_head', 'sales_manager',
                    'finance_manager', 'accountant', 'analyst', 'auditor'
                  )),
  region_ids      uuid[],
  channel_ids     uuid[],
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, role, valid_from)
);

CREATE INDEX user_role_assignments_user_org_idx
  ON public.user_role_assignments(user_id, organization_id);

CREATE OR REPLACE FUNCTION public.has_organization_access(target_organization_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments ura
    WHERE ura.organization_id = target_organization_id
      AND ura.user_id = auth.uid()
      AND ura.valid_from <= now()
      AND (ura.valid_to IS NULL OR ura.valid_to > now())
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('super_admin', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------

CREATE TABLE public.sales_regions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE public.sales_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE public.cost_centers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES public.cost_centers(id),
  code            text NOT NULL,
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'department',
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE public.products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  category        text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_variants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id),
  sku             text NOT NULL,
  barcode         text,
  size            text,
  color           text,
  availability    text NOT NULL DEFAULT 'available'
                    CHECK (availability IN ('available', 'unavailable', 'unknown')),
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku)
);

CREATE UNIQUE INDEX product_variants_barcode_unique
  ON public.product_variants(organization_id, barcode)
  WHERE barcode IS NOT NULL;

CREATE TABLE public.product_cost_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  amount             numeric(20,2) NOT NULL CHECK (amount >= 0),
  currency           char(3) NOT NULL DEFAULT 'KZT',
  base_amount        numeric(20,2) NOT NULL CHECK (base_amount >= 0),
  valid_from         timestamptz NOT NULL,
  valid_to           timestamptz,
  reason             text NOT NULL,
  source             text,
  supplier           text,
  batch_number       text,
  attachment_path    text,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

ALTER TABLE public.product_cost_versions
  ADD CONSTRAINT product_cost_versions_no_overlap
  EXCLUDE USING gist (
    product_variant_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  );

CREATE TABLE public.product_price_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  amount              numeric(20,2) NOT NULL CHECK (amount >= 0),
  currency            char(3) NOT NULL DEFAULT 'KZT',
  valid_from          timestamptz NOT NULL,
  valid_to            timestamptz,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

ALTER TABLE public.product_price_versions
  ADD CONSTRAINT product_price_versions_no_overlap
  EXCLUDE USING gist (
    product_variant_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  );

CREATE TABLE public.expense_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  pnl_line        text,
  cash_flow_line  text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE public.accounting_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closing', 'closed')),
  closed_by       text,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  UNIQUE (organization_id, starts_on, ends_on)
);

CREATE TABLE public.organization_sales_settings (
  organization_id        text PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  base_currency          char(3) NOT NULL DEFAULT 'KZT',
  negative_margin_policy text NOT NULL DEFAULT 'comment_required'
                          CHECK (negative_margin_policy IN (
                            'warning', 'comment_required', 'approval_required', 'blocked'
                          )),
  product_request_sla_hours integer NOT NULL DEFAULT 24 CHECK (product_request_sla_hours > 0),
  updated_by             text NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Sales and approvals
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.sale_number_seq;

CREATE TABLE public.sales (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number              text NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN (
                          'draft', 'waiting_for_product', 'pending_approval',
                          'posted', 'reversed', 'annulled'
                        )),
  sold_at              timestamptz NOT NULL,
  manager_id           text NOT NULL,
  manager_name_snapshot text,
  region_id            uuid REFERENCES public.sales_regions(id),
  region_name_snapshot text,
  channel_id           uuid REFERENCES public.sales_channels(id),
  channel_name_snapshot text,
  currency             char(3) NOT NULL DEFAULT 'KZT',
  revenue_total        numeric(20,2) NOT NULL DEFAULT 0,
  cost_total           numeric(20,2) NOT NULL DEFAULT 0,
  gross_profit_total   numeric(20,2) NOT NULL DEFAULT 0,
  discount_total       numeric(20,2) NOT NULL DEFAULT 0,
  bonus_total          numeric(20,2) NOT NULL DEFAULT 0,
  negative_margin_reason text,
  negative_margin_comment text,
  source               text NOT NULL DEFAULT 'manual',
  source_ref           text,
  original_sale_id     uuid REFERENCES public.sales(id),
  reversed_by_sale_id  uuid REFERENCES public.sales(id),
  version              integer NOT NULL DEFAULT 1,
  created_by           text NOT NULL,
  posted_by            text,
  posted_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE INDEX sales_org_date_status_idx
  ON public.sales(organization_id, sold_at DESC, status);

CREATE TABLE public.sale_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id               uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  organization_id       text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_variant_id    uuid NOT NULL REFERENCES public.product_variants(id),
  product_name_snapshot text NOT NULL,
  sku_snapshot          text NOT NULL,
  size_snapshot         text,
  color_snapshot        text,
  quantity              numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit_price             numeric(20,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount       numeric(20,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  revenue_amount        numeric(20,2) NOT NULL,
  unit_cost_snapshot    numeric(20,2) NOT NULL CHECK (unit_cost_snapshot >= 0),
  cost_amount           numeric(20,2) NOT NULL,
  gross_profit_amount   numeric(20,2) NOT NULL,
  bonus_rate_snapshot   numeric(9,6) NOT NULL DEFAULT 0,
  bonus_amount          numeric(20,2) NOT NULL DEFAULT 0,
  cost_version_id       uuid NOT NULL REFERENCES public.product_cost_versions(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id         uuid REFERENCES public.sales(id),
  requested_by    text NOT NULL,
  status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'in_review', 'resolved', 'rejected')),
  sku             text,
  barcode         text,
  name            text,
  size            text,
  color           text,
  photo_paths     text[] NOT NULL DEFAULT '{}',
  comment         text,
  resolved_variant_id uuid REFERENCES public.product_variants(id),
  sla_deadline    timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.operation_approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason_code     text NOT NULL,
  comment         text,
  requested_by    text NOT NULL,
  decided_by      text,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Expenses, plans and ledger
-- ---------------------------------------------------------------------------

CREATE TABLE public.expenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'posted', 'reversed')),
  operation_type    text NOT NULL CHECK (operation_type IN (
                      'operating_expense', 'write_off', 'owner_payment', 'tax',
                      'capital_expense', 'internal_transfer', 'adjustment', 'depreciation'
                    )),
  document_date     date NOT NULL,
  payment_date      date,
  category_id       uuid NOT NULL REFERENCES public.expense_categories(id),
  cost_center_id    uuid REFERENCES public.cost_centers(id),
  amount            numeric(20,2) NOT NULL CHECK (amount > 0),
  currency          char(3) NOT NULL DEFAULT 'KZT',
  base_amount       numeric(20,2) NOT NULL CHECK (base_amount > 0),
  supplier          text,
  document_number   text,
  comment           text,
  attachment_paths  text[] NOT NULL DEFAULT '{}',
  affects_pnl       boolean NOT NULL,
  affects_cash_flow boolean NOT NULL,
  source            text NOT NULL DEFAULT 'manual',
  source_ref        text,
  original_expense_id uuid REFERENCES public.expenses(id),
  reversed_by_expense_id uuid REFERENCES public.expenses(id),
  version           integer NOT NULL DEFAULT 1,
  created_by        text NOT NULL,
  posted_by         text,
  posted_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.expense_allocation_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  basis           text NOT NULL CHECK (basis IN (
                    'revenue', 'gross_profit', 'sales_count', 'employee_count',
                    'store_area', 'fixed_percentage', 'manual', 'none'
                  )),
  valid_from      date NOT NULL,
  valid_to        date,
  coefficients    jsonb NOT NULL,
  reason          text NOT NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE public.expense_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id      uuid NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
  rule_id         uuid REFERENCES public.expense_allocation_rules(id),
  cost_center_id  uuid REFERENCES public.cost_centers(id),
  allocated_amount numeric(20,2) NOT NULL,
  coefficient     numeric(12,8) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sales_plan_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'superseded')),
  version_number  integer NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'KZT',
  created_by      text NOT NULL,
  published_by    text,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (organization_id, period_start, period_end, version_number)
);

CREATE UNIQUE INDEX sales_plan_one_published_idx
  ON public.sales_plan_versions(organization_id, period_start, period_end)
  WHERE status = 'published';

CREATE TABLE public.sales_plan_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id uuid NOT NULL REFERENCES public.sales_plan_versions(id) ON DELETE CASCADE,
  region_id       uuid REFERENCES public.sales_regions(id),
  channel_id      uuid REFERENCES public.sales_channels(id),
  product_id      uuid REFERENCES public.products(id),
  manager_id      text,
  revenue_target  numeric(20,2) NOT NULL DEFAULT 0,
  gross_profit_target numeric(20,2) NOT NULL DEFAULT 0,
  quantity_target numeric(18,3) NOT NULL DEFAULT 0,
  average_price_target numeric(20,2),
  average_cost_target numeric(20,2),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.management_ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type     text NOT NULL,
  source_id       uuid NOT NULL,
  source_line_id  uuid,
  entry_date      date NOT NULL,
  account         text NOT NULL,
  amount          numeric(20,2) NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'KZT',
  pnl_line        text,
  cash_flow_line  text,
  region_id       uuid REFERENCES public.sales_regions(id),
  channel_id      uuid REFERENCES public.sales_channels(id),
  cost_center_id  uuid REFERENCES public.cost_centers(id),
  product_id      uuid REFERENCES public.products(id),
  manager_id      text,
  reversal_of_id  uuid REFERENCES public.management_ledger_entries(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX management_ledger_analytics_idx
  ON public.management_ledger_entries(organization_id, entry_date, account);

-- ---------------------------------------------------------------------------
-- Reliability, audit, imports and realtime
-- ---------------------------------------------------------------------------

CREATE TABLE public.idempotency_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id        text NOT NULL,
  operation       text NOT NULL,
  idempotency_key text NOT NULL,
  status          text NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (organization_id, actor_id, operation, idempotency_key)
);

CREATE TABLE public.financial_audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id        text NOT NULL,
  actor_role      text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  action          text NOT NULL,
  reason          text,
  before_value    jsonb,
  after_value     jsonb,
  ip_address      inet,
  user_agent      text,
  approval_id     uuid REFERENCES public.operation_approvals(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX financial_audit_org_entity_idx
  ON public.financial_audit_events(organization_id, entity_type, entity_id, created_at DESC);

CREATE TABLE public.outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  event_version   integer NOT NULL DEFAULT 1,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  actor_id        text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);

CREATE INDEX outbox_pending_idx
  ON public.outbox_events(occurred_at)
  WHERE dispatched_at IS NULL;

CREATE TABLE public.analytics_update_signals (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.import_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('sales', 'expenses', 'plans', 'master_data')),
  status          text NOT NULL DEFAULT 'uploaded'
                    CHECK (status IN ('uploaded', 'validating', 'ready', 'importing', 'completed', 'failed')),
  file_name       text NOT NULL,
  file_hash       text NOT NULL,
  storage_path    text,
  mapping         jsonb NOT NULL DEFAULT '{}',
  summary         jsonb NOT NULL DEFAULT '{}',
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, file_hash)
);

CREATE TABLE public.import_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id   uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  sheet_name      text,
  source_row      integer NOT NULL,
  raw_data        jsonb NOT NULL,
  normalized_data jsonb,
  fingerprint     text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'valid', 'warning', 'error', 'imported')),
  errors          jsonb NOT NULL DEFAULT '[]',
  entity_type     text,
  entity_id       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_rows_job_status_idx
  ON public.import_rows(import_job_id, status);

-- ---------------------------------------------------------------------------
-- Knowledge base and action drafts
-- ---------------------------------------------------------------------------

CREATE TABLE public.knowledge_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  document_type   text NOT NULL,
  storage_path    text,
  content_hash    text NOT NULL,
  version_number  integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'parsing', 'indexing', 'ready', 'failed', 'archived')),
  access_scope    jsonb NOT NULL DEFAULT '{}',
  metadata        jsonb NOT NULL DEFAULT '{}',
  error_message   text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, content_hash, version_number)
);

CREATE TABLE public.knowledge_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  chunk_index     integer NOT NULL,
  content         text NOT NULL,
  content_tsv     tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding       vector(1536),
  source_locator  jsonb NOT NULL DEFAULT '{}',
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX knowledge_chunks_fts_idx ON public.knowledge_chunks USING gin(content_tsv);
CREATE INDEX knowledge_chunks_vector_idx ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE public.assistant_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  title           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.assistant_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         text NOT NULL,
  citations       jsonb NOT NULL DEFAULT '[]',
  retrieval_trace jsonb NOT NULL DEFAULT '{}',
  model_id        text,
  prompt_version  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.assistant_action_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.assistant_conversations(id) ON DELETE SET NULL,
  created_by      text NOT NULL,
  action_type     text NOT NULL CHECK (action_type IN (
                    'create_sale', 'create_expense', 'create_plan',
                    'reverse_sale', 'reverse_expense', 'create_product_request'
                  )),
  payload         jsonb NOT NULL,
  preview         jsonb NOT NULL,
  checksum        text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled', 'failed')),
  expires_at      timestamptz NOT NULL,
  confirmed_at    timestamptz,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_organization_id text,
  query_text text,
  query_embedding vector(1536),
  match_count integer DEFAULT 8
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  content text,
  source_locator jsonb,
  score double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH vector_hits AS (
    SELECT kc.id, row_number() OVER (ORDER BY kc.embedding <=> query_embedding) AS rank
    FROM public.knowledge_chunks kc
    JOIN public.knowledge_documents kd ON kd.id = kc.document_id
    WHERE kc.organization_id = query_organization_id
      AND public.has_organization_access(query_organization_id)
      AND kd.status = 'ready'
      AND kc.embedding IS NOT NULL
    ORDER BY kc.embedding <=> query_embedding
    LIMIT match_count * 4
  ),
  text_hits AS (
    SELECT kc.id, row_number() OVER (
      ORDER BY ts_rank_cd(kc.content_tsv, websearch_to_tsquery('simple', query_text)) DESC
    ) AS rank
    FROM public.knowledge_chunks kc
    JOIN public.knowledge_documents kd ON kd.id = kc.document_id
    WHERE kc.organization_id = query_organization_id
      AND public.has_organization_access(query_organization_id)
      AND kd.status = 'ready'
      AND kc.content_tsv @@ websearch_to_tsquery('simple', query_text)
    LIMIT match_count * 4
  )
  SELECT kc.id, kc.document_id, kc.content, kc.source_locator,
         COALESCE(1.0 / (60 + vh.rank), 0) + COALESCE(1.0 / (60 + th.rank), 0) AS score
  FROM public.knowledge_chunks kc
  LEFT JOIN vector_hits vh ON vh.id = kc.id
  LEFT JOIN text_hits th ON th.id = kc.id
  WHERE vh.id IS NOT NULL OR th.id IS NOT NULL
  ORDER BY score DESC
  LIMIT match_count;
$$;

-- updated_at triggers
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_regions', 'sales_channels', 'cost_centers', 'products',
    'product_variants', 'expense_categories', 'sales', 'product_requests',
    'expenses', 'sales_plan_versions', 'import_jobs', 'knowledge_documents',
    'assistant_conversations'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      table_name, table_name
    );
  END LOOP;
END;
$$;

-- RLS: direct browser access is read-only and tenant filtered. Writes use server APIs.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_regions', 'sales_channels', 'cost_centers', 'products',
    'product_variants', 'product_cost_versions', 'product_price_versions',
    'expense_categories', 'accounting_periods', 'organization_sales_settings',
    'sales', 'sale_items',
    'product_requests', 'operation_approvals', 'expenses',
    'expense_allocation_rules', 'sales_plan_versions', 'management_ledger_entries',
    'financial_audit_events', 'analytics_update_signals', 'import_jobs',
    'knowledge_documents', 'knowledge_chunks', 'assistant_conversations',
    'assistant_action_drafts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.has_organization_access(organization_id))',
      table_name || '_tenant_select', table_name
    );
  END LOOP;
END;
$$;

-- Child tables inherit tenant access through their parent records.
ALTER TABLE public.expense_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_allocations_tenant_select
  ON public.expense_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id
        AND public.has_organization_access(e.organization_id)
    )
  );

ALTER TABLE public.sales_plan_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_plan_lines_tenant_select
  ON public.sales_plan_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_plan_versions p
      WHERE p.id = plan_version_id
        AND public.has_organization_access(p.organization_id)
    )
  );

ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_rows_tenant_select
  ON public.import_rows FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.import_jobs j
      WHERE j.id = import_job_id
        AND public.has_organization_access(j.organization_id)
    )
  );

ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_messages_tenant_select
  ON public.assistant_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.assistant_conversations c
      WHERE c.id = conversation_id
        AND c.user_id = auth.uid()::text
        AND public.has_organization_access(c.organization_id)
    )
  );

ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_role_assignments_select_own
  ON public.user_role_assignments
  FOR SELECT
  USING (user_id = auth.uid() OR public.has_organization_access(organization_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'analytics_update_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.analytics_update_signals;
  END IF;
END;
$$;
