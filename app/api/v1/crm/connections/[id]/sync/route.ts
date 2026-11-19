export const dynamic = 'force-dynamic'
// Синк читает до 2000 контактов и 2000 сделок из внешней CRM — даём больше времени.
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { BUSY_MESSAGE, syncCrmConnection, type SyncConnection } from '@/lib/crm/sync'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { emitCrmSyncFailed } from '@/lib/crm/sync-events'
import { resolveTenant } from '@/lib/tenancy'
import { deadlineRemainingMs, withDeadline } from '@/lib/runtime/deadline'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The sync's own budget: it writes its status well before the route's 60 s deadline. */
const SYNC_BUDGET_MS = 45_000
/** Kept between the sync's end and the route deadline (the answer, the event). */
const ROUTE_MARGIN_MS = 5_000
/** Manual syncs per user: each one reads up to 4000 CRM records. */
const RATE = { max: 6, windowMs: 10 * 60_000 }

/**
 * POST — синхронизировать СВОЁ подключение сейчас (lib/crm/sync.ts — тот же код, что у
 * автосинхронизации): контакты → клиенты без дублей, суммы сделок → средний чек, статус
 * success / partial / error с понятным сообщением. RLS скоупит и подключение, и клиентов.
 * 200 — success или partial (data.status, data.message); 502 — error (CRM не ответила, ключ не
 * подошёл…), сообщение в error; 409 — подключение отключено или его синхронизация уже идёт (lease,
 * общий с автосинхронизацией); 429 — больше 6 ручных синхронизаций за 10 минут.
 */
async function handlePost(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }

  if (await isRateLimitedKey(user.id, 'crm-connection-sync', RATE)) {
    return NextResponse.json({ ok: false, error: 'Слишком часто: синхронизацию можно запускать до 6 раз за 10 минут — попробуйте позже.' }, { status: 429 })
  }

  const { data: conn } = await sb
    .from('crm_provider_connections')
    .select('id, user_id, provider, base_url, access_token, is_active')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!conn) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  if (!conn.is_active) {
    return NextResponse.json({ ok: false, error: 'Подключение отключено — подключите CRM заново.' }, { status: 409 })
  }

  const left = deadlineRemainingMs()
  const budget = Math.max(5_000, Math.min(SYNC_BUDGET_MS, left === null ? SYNC_BUDGET_MS : left - ROUTE_MARGIN_MS))
  const report = await syncCrmConnection(sb, conn as SyncConnection, { deadlineAt: Date.now() + budget })
  if (report.status === 'busy') {
    return NextResponse.json({ ok: false, error: BUSY_MESSAGE, code: 'sync_in_progress' }, { status: 409 })
  }

  if (report.status === 'error') {
    const tenant = await resolveTenant().catch(() => null)
    emitCrmSyncFailed(conn as SyncConnection, report.message, { companyId: tenant && tenant.ok ? tenant.tenant.companyId : null })
    return NextResponse.json({ ok: false, error: report.message, data: report }, { status: 502 })
  }
  return NextResponse.json({ ok: true, data: report })
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After 60 s the client
 * gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline spent. ROUTE_DEADLINE_MS_CRM_CONNECTION_SYNC overrides it;
 * ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const POST = withDeadline(handlePost, { label: 'crm-connection-sync', ms: 60_000 })
