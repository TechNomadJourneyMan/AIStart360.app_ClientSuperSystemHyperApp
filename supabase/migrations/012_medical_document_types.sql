-- Extend documents.doc_type CHECK to include medical-vertical document types
-- (patient_base is the new one; the others are kept for general medical files).

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
      'financial_report',  -- existing legacy value in prod
      -- Medical
      'patient_base',      -- YCLIENTS / CRM export of patient list
      'pricelist',         -- Clinic price catalogue
      'services_catalog',  -- List of services with IDs/codes
      'packages',          -- Package / check-up offerings
      'scripts',           -- Call-center / admin scripts
      'brand_rules'        -- Brand / communication guidelines
    )
  );
