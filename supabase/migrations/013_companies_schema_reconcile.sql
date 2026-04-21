-- Reconcile prod `companies` table with migration 001 schema.
-- Root cause: migration 001 declared companies with user_id + industry +
-- business_model + stage + contact_*, but prod was already populated by
-- Prisma with a narrower schema (id, name, domain, status, notes, timestamps).
-- `CREATE TABLE IF NOT EXISTS` in 001 became a no-op, leaving prod missing
-- the columns our onboarding endpoints write to.
--
-- This migration is additive and safe: it only adds columns and defaults
-- that do not conflict with Prisma's existing data. No existing row affected.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS user_id        UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS industry       TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS business_model TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS stage          TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_name   TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_phone  TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_email  TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS size           TEXT;

-- One company per user (allow Prisma rows with NULL user_id to coexist)
CREATE UNIQUE INDEX IF NOT EXISTS companies_user_id_uidx
  ON public.companies(user_id)
  WHERE user_id IS NOT NULL;

-- Prisma originally made these NOT NULL without defaults. Our REST INSERTs
-- don't specify them — add sensible defaults so onboarding endpoint works.
ALTER TABLE public.companies ALTER COLUMN id        SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.companies ALTER COLUMN "updatedAt" SET DEFAULT NOW();
-- `status` already defaults to 'lead' (CompanyStatus enum), `createdAt` to CURRENT_TIMESTAMP.
