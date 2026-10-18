export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { activeImpersonation } from '@/lib/impersonation/server'
import { getSetting } from '@/lib/settings/store'
import { selectPopups } from '@/lib/popups/select'
import { loadExpertMessageCandidates } from '@/lib/popups/store'
import { DEFAULT_POPUP_RULES } from '@/lib/popups/types'

/**
 * GET /api/v1/popups?route=/client/home — the pop-ups to show the signed-in
 * user right now (cabinet pop-up layer, spec §12.2): staff messages of HIS
 * conversation, already selected and ordered (lib/popups/select.ts). The user
 * comes from the session only.
 *
 * Empty list (never an error the page has to handle) when there is no
 * conversation yet, an admin is driving the cabinet «от имени», or the layer
 * is switched off (setting pb_popups_enabled). Reading writes nothing; what
 * the user did with a window is recorded by PATCH /api/v1/popups/:id.
 */
export async function GET(req: NextRequest) {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const empty = NextResponse.json({ ok: true, data: { threadId: null, popups: [] } })
  try {
    if (await activeImpersonation(user.id)) return empty
    let enabled = true
    let cardsPerDay = DEFAULT_POPUP_RULES.cardsPerDay
    try {
      enabled = await getSetting('pb_popups_enabled')
      cardsPerDay = await getSetting('pb_popup_cards_per_day')
    } catch { /* defaults */ }
    if (!enabled) return empty

    const raw = req.nextUrl.searchParams.get('route') ?? ''
    const route = raw.startsWith('/') && raw.length <= 300 ? raw : '/client'

    const now = new Date()
    const rules = { ...DEFAULT_POPUP_RULES, cardsPerDay }
    const loaded = await loadExpertMessageCandidates(createServiceClient(), user.id, now, rules.messageWindowDays)
    const popups = selectPopups(loaded.candidates, loaded.states, {
      now,
      // Recommendations and insights have no source yet (Point B phase 1+); only expert messages pass today.
      pro: false,
      impersonating: false,
      doNotDisturbUntil: null,
      route,
      shownToday: { cards: 0, modals: loaded.modalsShown24h },
    }, rules)
    return NextResponse.json({ ok: true, data: { threadId: loaded.threadId, popups } })
  } catch (err) {
    console.error('[v1/popups]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить окна' }, { status: 500 })
  }
}
