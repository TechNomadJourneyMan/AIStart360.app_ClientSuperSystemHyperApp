export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/survey-chat — the questionnaire AI chat of an
// ASSIGNED client for the expert cabinet (spec §8.8; PO 2026-10-23: the
// assigned expert reads the transcript). Read-only. Access: resolveExpert +
// guardExpertClient (user_assignments; admin — any client).
import { NextRequest, NextResponse } from 'next/server'
import { expertBlockResponse, guardExpertClient, resolveExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { loadSurveyChatTranscript } from '@/lib/survey/chat/transcript'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const denied = await guardExpertClient(auth.viewer, params.id)
  if (denied) return denied
  try {
    const conversations = await loadSurveyChatTranscript(createServiceClient(), params.id)
    return NextResponse.json({ ok: true, data: { conversations } })
  } catch (err) {
    console.error('[expert/survey-chat]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить беседу' }, { status: 500 })
  }
}
