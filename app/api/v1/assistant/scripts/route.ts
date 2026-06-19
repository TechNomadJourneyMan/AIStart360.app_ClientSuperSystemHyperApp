export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { CHAT_SCRIPTS } from '@/lib/assistant/chat-scripts'
import { localeFromRequestCookie } from '@/lib/i18n/locale'

/**
 * GET /api/v1/assistant/scripts
 *
 * Catalog of the ready-made assistant questions (7.1–7.12) for the chat panel's
 * clickable list. Returns only the safe, presentational fields
 * (id, question, section, valueLine) grouped by section, in the portal locale
 * (cookie → default Russian) — the answer-script bodies (scriptOutline/outline_en)
 * are NEVER shipped to the client; they live server-side and are rendered through
 * POST /api/v1/assistant/chat. Auth-gated for consistency with the rest of the
 * assistant surface (no per-user data here).
 */
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const locale = localeFromRequestCookie(req)

  // Group by section, preserving the catalog order (7.1 → 7.12).
  const order: string[] = []
  const grouped: Record<
    string,
    Array<{ id: string; question: string; section: string; valueLine: string | null }>
  > = {}

  for (const s of CHAT_SCRIPTS) {
    if (!grouped[s.section]) {
      grouped[s.section] = []
      order.push(s.section)
    }
    grouped[s.section].push({
      id: s.id,
      question: locale === 'en' ? s.question_en : s.question,
      section: s.section,
      valueLine: (locale === 'en' ? s.valueLine_en : s.valueLine) ?? null,
    })
  }

  const groups = order.map((section) => ({ section, scripts: grouped[section] }))

  return NextResponse.json({ ok: true, groups })
}
