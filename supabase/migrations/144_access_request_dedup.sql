-- 144_access_request_dedup.sql
--
-- R2-A (Round 2): one OPEN request for paid access per client.
--
-- The paywall (components/access/Paywall.tsx) and the old menus send
-- POST /api/v1/upgrade-request; lib/access/upgrade-requests.ts first looks for
-- an open request of the user and, if there is one, only adds the section to
-- its payload.features — a repeat click never creates a second row. This index
-- closes the remaining race (two requests in the same instant): the second
-- INSERT fails with 23505 and the code merges into the winner.
--
-- Scope of the index: only rows written by the new code (source = 'paywall')
-- while the request is still being handled. Older rows (source 'upgrade_modal',
-- written before Round 2 without any de-duplication) are NOT covered, so the
-- index builds even if such duplicates exist; the application check treats
-- them as open requests too. Closed requests (approved / rejected / archived)
-- do not block a new one.
--
-- admin_requests is a Prisma-owned table (quoted camelCase columns); Prisma does
-- not know this expression index. If `prisma db push` is ever run against the
-- database it may drop it — re-apply this file afterwards (the application
-- check still prevents duplicates outside the race window).
--
-- Idempotent. Rollback: supabase/migrations/rollback/144_access_request_dedup.down.sql
-- Apply: node scripts/apply-migration.js supabase/migrations/144_access_request_dedup.sql

SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS admin_requests_open_paywall_per_user
  ON public.admin_requests ((payload ->> 'userId'))
  WHERE type = 'access'
    AND source = 'paywall'
    AND status IN ('new', 'in_review', 'waiting_for_info', 'escalated');

COMMENT ON INDEX public.admin_requests_open_paywall_per_user IS
  'R2-A: one open paid-access request (source paywall) per client — see lib/access/upgrade-requests.ts';
