import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { emitCrmSyncFailed } from '@/lib/crm/sync-events'
import { runCrmAutoSync } from '@/lib/crm/sync-cron'
import { createServiceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/crm-sync — автосинхронизация CRM (lib/crm/sync-cron.ts) дважды в час, в :17 и :47,
 * кроме ночного окна пересчётов (lib/cron/schedule.ts). Подключения Bitrix24 / amoCRM, которые
 * не синхронизировались 6 ч (или ни разу), — не больше двух одновременно, весь проход ≤ 44 с.
 * Тот же код, что у кнопки «Синхронизировать» (lib/crm/sync.ts): без дублей, ничего не удаляет.
 * Ответ 200 и при ошибках отдельных подключений (у каждого свой last_sync_status / last_sync_error);
 * 500 — только если не удалось прочитать список подключений.
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' }, { status: auth.status })
  }
  try {
    const result = await runCrmAutoSync({
      sb: createServiceClient(),
      onError: (conn, message) => emitCrmSyncFailed(conn, message),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron/crm-sync]', e instanceof Error ? e.message : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
