export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { resolveAccess } from '@/lib/access/decision'
import { canRunFullGri } from '@/lib/access/entitlements'

/**
 * GET /api/v1/access/me — права текущего пользователя.
 *
 * Тот же ответ, что дают серверные гейты (lib/access/decision.ts): UI (меню,
 * замки, пейволл, кнопки PDF / AI-чат / бенчмарки) не решает сам.
 *   { gatesEnabled, staff, entitlements (own rights: tariff + override),
 *     sections: { point_a, point_b, market, gri_full } (the decision),
 *     griRunsUsed, griRunsLimit, canRunFullGri }
 * `sections[x] === false` — раздел закрыт: страница показывает пейволл, API отвечает 402.
 * Когда gatesEnabled=false (тумблер access_gates выключен) всё открыто.
 * Личность — из cookie-сессии.
 */
export async function GET() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const access = await resolveAccess(sb, user.id)
    const ent = access.ent

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
      gatesEnabled: access.gatesEnabled,
      staff: access.staff,
      // The account's own rights (tariff + override), whatever the switch says.
      entitlements: {
        tier: ent.tier,
        pdf_export: ent.pdf_export,
        ai_chat: ent.ai_chat,
        benchmarks: ent.benchmarks,
        point_b: ent.point_b,
        point_a: ent.point_a,
        market: ent.market,
        gri_full: ent.gri_full,
      },
      // The decision the API enforces (switch, rights, staff): false → paywall / 402.
      sections: access.sections,
      griRunsUsed,
      griRunsLimit: Number.isFinite(ent.gri_full_limit) ? ent.gri_full_limit : null,
      canRunFullGri: !access.gatesEnabled || access.staff || canRunFullGri(ent, griRunsUsed),
    })
  } catch (error) {
    console.error('[access/me] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
