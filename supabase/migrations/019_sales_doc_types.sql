-- Extend documents.doc_type CHECK to allow sales_report and client_base.
-- These are the canonical document types the v3 Point A engine reads.

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_doc_type_check CHECK (
    doc_type IN (
      -- Generic (kept)
      'pl_report',
      'balance_sheet',
      'marketing_report',
      'ops_report',
      'crm_export',
      'audit',
      'other',
      'financial_report',  -- existing legacy value
      -- v3 Point A
      'sales_report',      -- raw sales transactions
      'client_base',       -- customer registry with first/last purchase
      -- Medical (kept)
      'patient_base',
      'pricelist',
      'services_catalog',
      'packages',
      'scripts',
      'brand_rules'
    )
  );
