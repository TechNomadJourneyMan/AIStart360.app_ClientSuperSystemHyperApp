-- 033_app_share_payments_leads.sql
-- Adds the 4 Prisma-owned application tables introduced with the competitive P0
-- features (Free Mini-GRI lead capture, shareable report links, payment stubs).
-- DDL is copied verbatim from Prisma's canonical `migrate diff --from-empty`
-- output so the column names / types / defaults match the generated client
-- exactly (TIMESTAMP(3), TEXT[] arrays, Postgres enum types in `public`).
--
-- Purely ADDITIVE and IDEMPOTENT: guarded enum creation, CREATE TABLE IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, guarded FK. Touches no existing table.

-- ─── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SharedReportType') THEN
    CREATE TYPE "SharedReportType" AS ENUM ('survey', 'gri', 'point_a', 'point_b');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AcquiringProvider') THEN
    CREATE TYPE "AcquiringProvider" AS ENUM ('stripe', 'cloudpayments', 'kaspi', 'halyk', 'mir');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionTier') THEN
    CREATE TYPE "SubscriptionTier" AS ENUM ('pilot', 'pro', 'enterprise');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentStatus') THEN
    CREATE TYPE "PaymentStatus" AS ENUM ('stub', 'pending', 'succeeded', 'failed');
  END IF;
END $$;

-- ─── Tables ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "mini_gri_leads" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "answers" JSONB NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "block_scores" JSONB NOT NULL,
    "source" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mini_gri_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shared_reports" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" "SharedReportType" NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT,
    "audienceRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shared_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'pilot',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "provider" "AcquiringProvider",
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payment_transactions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "AcquiringProvider" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "planKey" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'stub',
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "mini_gri_leads_email_idx" ON "mini_gri_leads"("email");
CREATE INDEX IF NOT EXISTS "mini_gri_leads_createdAt_idx" ON "mini_gri_leads"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "shared_reports_token_key" ON "shared_reports"("token");
CREATE INDEX IF NOT EXISTS "shared_reports_token_idx" ON "shared_reports"("token");
CREATE INDEX IF NOT EXISTS "shared_reports_companyId_idx" ON "shared_reports"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_orgId_key" ON "subscriptions"("orgId");
CREATE INDEX IF NOT EXISTS "payment_transactions_orgId_idx" ON "payment_transactions"("orgId");

-- ─── Foreign key (guarded — only if organizations exists and FK absent) ───────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_orgId_fkey') THEN
    ALTER TABLE "subscriptions"
      ADD CONSTRAINT "subscriptions_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
