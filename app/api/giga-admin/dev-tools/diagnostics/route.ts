export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga, STAFF_COOKIE_NAME } from '@/lib/admin/giga-actor'
import { STAFF_ROLE_LABELS, permissionsFor } from '@/lib/admin/rbac'
import { envChecks } from '@/lib/admin/system-health'
import { createServiceClient } from '@/lib/supabase-service'
import { getSiteUrl } from '@/lib/site-url'
import { getSetting } from '@/lib/settings/store'
import { MFA_COOKIE_NAME, verifyStepUp } from '@/lib/mfa/step-up'
import { IMP_COOKIE_NAME, readImpersonation } from '@/lib/impersonation/token'
import { VIEW_AS_COOKIE_NAME, readViewAs, resolveViewAs } from '@/lib/devtools/view-as'
import { buildInfo, DEVTOOLS_MIGRATION_FILE, migration120Status, type MigrationRow } from '@/lib/devtools/diagnostics'
import { testColumnState } from '@/lib/devtools/test-accounts-server'

/**
 * GET /api/giga-admin/dev-tools/diagnostics — сборка и окружение, моя сессия
 * (настоящая / действующая роль, второй фактор, «от имени»), открытые сессии
 * «от имени», журнал миграций. Значения секретов не возвращаются никогда.
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  const actor = guard.actor
  const sb = createServiceClient()

  const viewClaims = await readViewAs(req.cookies.get(VIEW_AS_COOKIE_NAME)?.value)
  const viewAs = resolveViewAs({ realRole: actor.role, actorId: actor.id, claims: viewClaims })
  const effectiveRole = viewAs ?? actor.role

  const imp = await readImpersonation(req.cookies.get(IMP_COOKIE_NAME)?.value)
  const nowIso = new Date().toISOString()

  const [security, keys, requireMfa, sessions, ledger, ledger120, column] = await Promise.all([
    sb.from('user_security').select('totp_enabled').eq('user_id', actor.id).maybeSingle(),
    sb.from('webauthn_credentials').select('user_id', { count: 'exact', head: true }).eq('user_id', actor.id),
    getSetting('staff_require_mfa').catch(() => null),
    sb.from('impersonation_sessions')
      .select('id, admin_id, admin_email, admin_role, target_user_id, mode, reason, started_at, expires_at')
      .is('ended_at', null).gt('expires_at', nowIso)
      .order('started_at', { ascending: false }).limit(50),
    sb.from('schema_migrations').select('file, applied_at, applied_by').order('applied_at', { ascending: false }).limit(10),
    sb.from('schema_migrations').select('file').eq('file', DEVTOOLS_MIGRATION_FILE).maybeSingle(),
    testColumnState(sb).catch(() => null),
  ])

  const sessionRows = (sessions.data ?? []) as Array<{ id: string; target_user_id: string; admin_id: string; admin_email: string | null; admin_role: string | null; mode: string; reason: string; started_at: string; expires_at: string }>
  const targetIds = Array.from(new Set(sessionRows.map((s) => s.target_user_id)))
  const { data: people } = targetIds.length
    ? await sb.from('profiles').select('id, email, full_name').in('id', targetIds)
    : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> }
  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  const ledgerHas120 = ledger120.error ? null : !!ledger120.data
  const columnReady = column ? column.ready : null

  return NextResponse.json({
    ok: true,
    checkedAt: nowIso,
    build: { ...buildInfo(), siteUrl: getSiteUrl() },
    env: envChecks(),
    session: {
      id: actor.id,
      email: actor.email ?? null,
      kind: actor.kind,
      realRole: actor.role,
      realRoleLabel: STAFF_ROLE_LABELS[actor.role],
      effectiveRole,
      effectiveRoleLabel: STAFF_ROLE_LABELS[effectiveRole],
      viewAsExpiresAt: viewAs && viewClaims ? new Date(viewClaims.exp * 1000).toISOString() : null,
      permissions: permissionsFor(effectiveRole),
      clientScope: actor.clientScope,
      mfa: {
        stepUpVerified: verifyStepUp(req.cookies.get(MFA_COOKIE_NAME)?.value, actor.id),
        totpEnabled: security.error ? null : (security.data as { totp_enabled?: boolean } | null)?.totp_enabled === true,
        passkeys: keys.error ? null : keys.count ?? 0,
        requiredForStaff: requireMfa,
      },
      staffCookie: !!req.cookies.get(STAFF_COOKIE_NAME)?.value,
      impersonation: imp.ok
        ? { active: true, sessionId: imp.claims.sid, mode: imp.claims.mode, target: imp.claims.tlabel, expiresAt: new Date(imp.claims.exp * 1000).toISOString() }
        : { active: false, reason: imp.reason === 'missing' ? null : imp.reason },
    },
    impersonation: {
      error: sessions.error ? 'Не удалось загрузить сессии «от имени»' : null,
      active: sessionRows.map((s) => ({ ...s, target: byId.get(s.target_user_id) ?? null })),
    },
    migrations: {
      error: ledger.error ? `Журнал schema_migrations недоступен: ${ledger.error.message}` : null,
      last: (ledger.data ?? []) as MigrationRow[],
      devtools: {
        file: DEVTOOLS_MIGRATION_FILE,
        inLedger: ledgerHas120,
        isTestColumn: columnReady,
        status: migration120Status(ledgerHas120, columnReady),
      },
    },
  })
}
