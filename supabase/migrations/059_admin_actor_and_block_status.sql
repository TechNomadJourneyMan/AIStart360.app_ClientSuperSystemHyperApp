-- ============================================================================
-- 059: Admin actor attribution + persistent user blocking (ТЗ Этап 0/1, R4/R6)
--
-- 1) audit_logs.performedBy: drop the FK to the Prisma "users" table.
--    The giga panel (shared-password break-glass) and personal super_admin
--    Supabase sessions both write actor identifiers that are NOT Prisma user
--    ids ('giga:super_admin' or a profiles UUID). With the FK in place every
--    such insert violated the constraint and — because logAudit() is
--    fire-and-forget — was silently dropped: giga-panel actions left NO audit
--    trail at all. performedBy becomes a plain actor identifier; the
--    /api/admin/audit reader joins to users manually when the id matches.
--
-- 2) profiles.status: add 'blocked' and 'archived' to the CHECK.
--    Until now "blocking" a user only deleted their (dead) NextAuth sessions —
--    nothing prevented a fresh login (R4). The block route now persists
--    status='blocked' (enforced by middleware + login flow + rbac demotion,
--    which already treats 'blocked' as CLIENT-only) and bans the GoTrue user.
--    'archived' backs the soft-delete lifecycle from the ТЗ (§5.2).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1) Audit actor: performedBy is an identifier, not a Prisma FK.
ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS "audit_logs_performedBy_fkey";

COMMENT ON COLUMN public.audit_logs."performedBy" IS
  'Actor identifier: profiles UUID (personal admin session), Prisma users.id (legacy /api/admin routes), or the literal ''giga:super_admin'' (break-glass shared password). Not a FK — actors live in multiple identity tables.';

-- 2) Persistent block/archive statuses.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN (
    'pending_approval',
    'approved',
    'rejected',
    'requires_clarification',
    'blocked',
    'archived'
  ));

COMMENT ON COLUMN public.profiles.status IS
  'pending_approval → requires_clarification → approved | rejected; blocked = access revoked by admin (persists across logins); archived = soft-deleted.';
