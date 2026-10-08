import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runAgentsDigest } from '@/lib/agents/digest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/agents-digest — ежедневная сводка ИИ-агентов в бот
 * администраторов. Расписание — vercel.json: 04:00 UTC = 09:00 Алматы.
 * Выключается настройкой «Ежедневная сводка агентов в бот»
 * (agents_daily_digest). Логика — lib/agents/digest.ts; повторный вызов в
 * тот же день ничего не отправляет повторно (ключ дня).
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}` (сравнение
 * за постоянное время; без секрета — 503).
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'CRON_SECRET не настроен' : 'Unauthorized' }, { status: auth.status })
  }
  try {
    const out = await runAgentsDigest(new Date())
    return NextResponse.json({
      ok: true,
      data: out.status === 'sent'
        ? { status: out.status, date: out.date, duplicate: out.result.duplicate, delivered: out.result.deliveries.filter((d) => d.status === 'sent').length }
        : out,
    })
  } catch (err) {
    console.error('[cron/agents-digest] failed', err instanceof Error ? err.message.split('\n')[0] : err)
    return NextResponse.json({ ok: false, error: 'agents digest failed' }, { status: 500 })
  }
}
