import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { escalateOverdueAccessRequests } from '@/lib/access/request-notices'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/access-requests — срок ответа на заявку на оплату (R4, N4B-1;
 * решение PO 2026-11-16: 4 ч, одно напоминание-эскалация при просрочке).
 * Каждые 15 минут (lib/cron/schedule.ts): открытая заявка на платный доступ
 * старше request_sla_hours → одно напоминание Admin и Super Admin (лента ГИГА +
 * Telegram, если привязан); повтор не шлёт второе. Ночью (тихие часы
 * уведомлений) проход ждёт утра. Логика — lib/access/request-notices.ts.
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' }, { status: auth.status })
  }
  try {
    const report = await escalateOverdueAccessRequests(createServiceClient(), new Date())
    return NextResponse.json({ ok: true, ...report })
  } catch (e) {
    console.error('[cron/access-requests]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
