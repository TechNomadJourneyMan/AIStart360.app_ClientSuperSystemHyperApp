-- 034_fix_subscription_fk_and_widget_config.sql
-- Two audit fixes (additive / non-destructive, idempotent):
--
-- 1. Drop subscriptions_orgId_fkey. `subscriptions.orgId` is a free-form tenant
--    key (companies.id / auth user id), NOT an organizations.id. The FK added in
--    033 made every trial checkout upsert fail and silently no-op. (Mirrors
--    payment_transactions.orgId, which has no FK.)
--
-- 2. Add profiles.widget_config (jsonb) so the giga-admin "widget visibility"
--    POST actually persists (it previously returned success but saved nothing).

ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_orgId_fkey";

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "widget_config" JSONB;
