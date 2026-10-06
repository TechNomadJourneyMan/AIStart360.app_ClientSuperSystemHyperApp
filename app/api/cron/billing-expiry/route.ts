import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { BillingError, expireDuePlans } from '@/lib/payments/billing'

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
 * Auth: Vercel Cron присылает `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' }, { status: auth.status })
  }
  try {
    const report = await expireDuePlans()
    return NextResponse.json({ ok: true, ...report })
  } catch (e) {
    if (e instanceof BillingError && e.code === 'migration_106_required') {
      return NextResponse.json({ ok: false, error: 'migration_106_required' }, { status: 503 })
    }
    console.error('[cron/billing-expiry]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
