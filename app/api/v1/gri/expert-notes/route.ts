export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const GRI_BLOCKS = ['product', 'trust', 'bizmodel', 'cash', 'ops', 'team', 'founder'] as const
type GriBlock = typeof GRI_BLOCKS[number]

function isValidBlock(block: string): block is GriBlock {
  return GRI_BLOCKS.includes(block as GriBlock)
}

// GET /api/v1/gri/expert-notes?user_id=xxx
// Returns all expert notes for a given user's GRI blocks
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })
  }

  const sb = createServerClient()

  const { data, error } = await sb
    .from('survey_answers')
    .select('question_key, answer, answered_at')
    .eq('user_id', userId)
    .eq('step', 0)
    .like('question_key', 'gri_expert_%')
    .order('answered_at', { ascending: true })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Transform to { block: note } map
  const notes: Record<string, { note: string; updated_at: string }> = {}
  for (const row of (data ?? [])) {
    const block = row.question_key.replace('gri_expert_', '')
    const value = (row.answer as { value: unknown })?.value
    notes[block] = {
      note: typeof value === 'string' ? value : '',
      updated_at: row.answered_at,
    }
  }

  return NextResponse.json({ ok: true, data: { notes } })
}

// POST /api/v1/gri/expert-notes
// Body: { user_id, block, note }
// Upserts expert note for a specific GRI block
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id, block, note } = body

    if (!user_id || !block || typeof note !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'user_id, block, and note (string) are required' },
        { status: 400 }
      )
    }

    if (!isValidBlock(block)) {
      return NextResponse.json(
        { ok: false, error: `Invalid block. Must be one of: ${GRI_BLOCKS.join(', ')}` },
        { status: 400 }
      )
    }

    const sb = createServerClient()

    const question_key = `gri_expert_${block}`

    const { error } = await sb
      .from('survey_answers')
      .upsert(
        {
          user_id,
          company_id: null,
          step: 0,
          question_key,
          answer: { value: note },
        },
        { onConflict: 'user_id,question_key' }
      )

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      data: {
        user_id,
        block,
        question_key,
        note,
        saved_at: new Date().toISOString(),
      }
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}
