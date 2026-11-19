import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { BillingError, expireDuePlans } from '@/lib/payments/billing'
import { sendExpiryWarnings, sendMissedEndNotices, type ExpiryWarningsReport } from '@/lib/payments/expiry-notices'
import { maintenanceSkipReason } from '@/lib/automation/maintenance-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/billing-expiry — переводит на бесплатный доступ клиентов, у
 * которых закончился пробный или оплаченный период (W8).
 *
 * Каждое снижение идёт через billing-сервис (subscriptions + profiles.tier
 * одной транзакцией) и пишется в журнал действий от имени
 * 'system:billing-expiry' ДО изменения. Идемпотентно: сниженная подписка
 * получает status 'canceled' и больше не попадает в выборку; строка
 * перепроверяется под блокировкой, так что продление, сделанное
 * администратором в ту же секунду, не теряется.
 *
 * R4 (N4B-10, решение PO 2026-11-16): клиент, чей тариф снижен, сразу получает
 * «Платный доступ закончился»; после снижения — предупреждения тем, у кого срок
 * кончается в ближайшие 7 суток (за 7 дней и за сутки), лента + письмо,
 * идемпотентно (lib/payments/expiry-notices.ts). Сбой предупреждений не
 * отменяет снижение: ответ `warnings: null`, следующий прогон повторит.
 *
 * Auth: Vercel Cron присылает `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' }, { status: auth.status })
  }
  try {
    // N5-3 (the class of R-026) + review of wave 1A: maintenance never stops the downgrade — an ended
    // trial / Pro must not keep profiles.tier 'pro' for as long as the cabinet is closed (or the
    // switch cannot be read). Only the client notices wait: no «доступ закончился» right after the
    // downgrade, no d7 / d1; the first run after maintenance sends the d7 / d1 still due (their
    // windows are days long) and catches up the «ended» notices (sendMissedEndNotices, same keys).
    const skip = await maintenanceSkipReason('billing-expiry')
    const report = await expireDuePlans({ notify: !skip })
    if (skip) return NextResponse.json({ ok: true, ...report, warnings: null, ended: null, noticesSkippedReason: skip })
    let warnings: ExpiryWarningsReport | null = null
    try {
      warnings = await sendExpiryWarnings()
    } catch (e) {
      console.error('[cron/billing-expiry] warnings failed:', e instanceof Error ? e.message : e)
    }
    let ended: ExpiryWarningsReport | null = null
    try {
      ended = await sendMissedEndNotices()
    } catch (e) {
      console.error('[cron/billing-expiry] ended catch-up failed:', e instanceof Error ? e.message : e)
    }
    return NextResponse.json({ ok: true, ...report, warnings, ended })
  } catch (e) {
    if (e instanceof BillingError && e.code === 'migration_106_required') {
      return NextResponse.json({ ok: false, error: 'migration_106_required' }, { status: 503 })
    }
    console.error('[cron/billing-expiry]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
