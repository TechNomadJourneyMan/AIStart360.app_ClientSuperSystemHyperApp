export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { gatePaidSection } from '@/lib/access/gate'

/**
 * GET /api/v1/diagnostics/point-b/ai-status?diagnostic_id=xxx
 * The Point B AI status of the session user's diagnostic. R3 (S3): the AI strategy is a staff draft — the client
 * always gets { ai_status: 'none', ai_strategy: null } (the route stays for the old polling code).
 */
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  // Round 2 (R2-A): point_b is a paid section — 402 upgrade_required for an account without it (staff exempt).
  const upgrade = await gatePaidSection(sb, user.id, 'point_b')
  if (upgrade) return upgrade

  // R3 (S3, решение PO): the AI strategy of Точка Б is a draft for staff — the client never sees it. The poll of
  // the old «Подробности» view always hears «нет ИИ-стратегии»; nothing is read.
  void req
  return NextResponse.json({ ok: true, data: { ai_status: 'none', ai_strategy: null } })
}
