export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { readEntitlements } from '@/lib/access/server'
import { canRunFullGri } from '@/lib/access/entitlements'
import { getAccessGatesEnabled } from '@/lib/settings/system-settings'

/**
 * GET /api/v1/access/me — права текущего пользователя (Фаза 6, Пакет VIII).
 *
 * Единая точка для клиентских гейтов (кнопка PDF, старт полного GRI, AI-чат,
 * бенчмарки): { gatesEnabled, entitlements, griRunsUsed, canRunFullGri }.
 * Когда gatesEnabled=false (системный тумблер access_gates выключен — fail-safe
 * дефолт) клиент ничего не ограничивает. Личность — из cookie-сессии.
 */
export async function GET() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const [gatesEnabled, ent] = await Promise.all([
      getAccessGatesEnabled(),
      readEntitlements(sb, user.id),
    ])

    let griRunsUsed = 0
    try {
      const { count } = await sb
        .from('gri_assessments')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      griRunsUsed = count ?? 0
    } catch {
      griRunsUsed = 0
    }

    return NextResponse.json({
      ok: true,
      gatesEnabled,
      entitlements: {
        tier: ent.tier,
        pdf_export: ent.pdf_export,
        ai_chat: ent.ai_chat,
        benchmarks: ent.benchmarks,
      },
      griRunsUsed,
      canRunFullGri: !gatesEnabled || canRunFullGri(ent, griRunsUsed),
    })
  } catch (error) {
    console.error('[access/me] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
