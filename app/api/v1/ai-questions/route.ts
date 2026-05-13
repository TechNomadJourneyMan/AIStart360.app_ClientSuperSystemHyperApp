export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/ai-questions
 *
 * Reads ai_questions array stored under profiles.branding.ai_questions
 * for the authenticated user. Returns empty array if none generated yet.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export interface AiQuestion {
  id: string
  category: string
  question: string
  context: string  // why we ask this — short ru sentence
  status: 'pending' | 'answered'
  answer?: string | null
  generated_at: string
  answered_at?: string | null
}

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

  const { url, key } = srBase()
  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}&select=branding`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return NextResponse.json({ ok: true, questions: [] })

  const rows = (await res.json()) as Array<{ branding: { ai_questions?: AiQuestion[] } | null }>
  const questions = rows[0]?.branding?.ai_questions ?? []
  return NextResponse.json({ ok: true, questions })
}
