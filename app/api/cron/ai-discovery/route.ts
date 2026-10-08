import { NextResponse, type NextRequest } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { discoverAllModels } from '@/lib/ai/providers/discovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/ai-discovery — daily model discovery (vercel.json): GET /models
 * with every enabled key of every enabled provider; new models are added as
 * 'discovered', the owner's models are not changed (lib/ai/providers/discovery.ts).
 * Requires `Authorization: Bearer $CRON_SECRET` (header only).
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'CRON_SECRET не настроен' : 'Unauthorized' }, { status: auth.status })
  }
  try {
    const results = await discoverAllModels()
    const failed = results.filter((r) => !r.ok)
    if (failed.length) console.warn('[cron/ai-discovery] keys without a model list:', failed.map((r) => `${r.providerKey}/${r.credentialLabel}`).join(', '))
    return NextResponse.json({
      ok: true,
      keys: results.length,
      failed: failed.length,
      added: results.reduce((s, r) => s + r.added, 0),
      bound: results.reduce((s, r) => s + r.bound, 0),
      results: results.map((r) => ({ provider: r.providerKey, key: r.credentialLabel, ok: r.ok, models: r.ids.length, added: r.added, error: r.error })),
    })
  } catch (err) {
    console.error('[cron/ai-discovery] failed', err instanceof Error ? err.message.split('\n')[0] : err)
    return NextResponse.json({ ok: false, error: 'Сбой обнаружения моделей' }, { status: 500 })
  }
}
