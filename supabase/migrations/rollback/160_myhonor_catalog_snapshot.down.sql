-- 160_myhonor_catalog_snapshot.down.sql — guarded ROLLBACK entry for migration 160.
-- NOT part of the forward migration sequence.
--
-- FORWARD-ONLY PRESERVATION: CREATE OR REPLACE updates a service RPC that may already exist; the pre-migration function body and privileges are not recorded here.
--
-- Operational rollback: roll back the portal application first and retain all
-- ecommerce/store tables, rows, RLS policies and restricted RPC grants. Restore
-- database definitions only from a verified pre-release schema/data snapshot,
-- or apply a reviewed additive corrective migration for that exact baseline.
-- This guard intentionally refuses an unproven destructive schema rollback.
-- No data or schema objects are removed, and no old write privilege is reopened.

DO $$
BEGIN
  RAISE EXCEPTION 'Migration 160 requires a verified baseline for schema rollback'
    USING ERRCODE = '55000',
          DETAIL = 'Automatic down migration is disabled to preserve existing ecommerce data and access controls.',
          HINT = 'Roll back the application; use a verified pre-release snapshot or a reviewed forward corrective migration.';
END;
$$;
