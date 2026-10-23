export const dynamic = 'force-dynamic'

// GET /api/giga-admin/users/:id/survey-chat — the client's questionnaire AI
// chat for staff (spec §8.8, §10): read-only transcript with the cards and
// their outcome, field-helper turns and escalations. Access: survey.view
// (or users.sensitive) + the client scope of the actor. Staff never write it.
import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { loadSurveyChatTranscript } from '@/lib/survey/chat/transcript'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['survey.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  try {
    const conversations = await loadSurveyChatTranscript(createServiceClient(), params.id)
    return NextResponse.json({ ok: true, data: { conversations } })
  } catch (err) {
    console.error('[giga/survey-chat]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить беседу' }, { status: 500 })
  }
}
