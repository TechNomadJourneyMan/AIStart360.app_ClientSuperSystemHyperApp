export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/db'
import { isPrivilegedViewer } from '@/lib/expert-auth'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * GET /api/giga-admin/requests/[id]/survey
 * Returns onboarding survey answers and company data for a given AdminRequest.
 * Resolves userId via Prisma → Supabase admin_requests fallback → params.id (orphaned profile).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Read access: super_admin cookie OR Supabase session with expert/admin role
  const cookieRole = req.cookies.get('aistart360_role')?.value ?? null
  if (!(await isPrivilegedViewer(cookieRole))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServerClient()
  let userId: string | null = null

  // 1. Try Prisma
  try {
    const adminRequest = await prisma.adminRequest.findUnique({
      where: { id: params.id },
    })
    if (adminRequest) {
      const payload = (adminRequest.payload ?? {}) as Record<string, string>
      userId = payload.userId ?? null
    }
  } catch {
    // Prisma unavailable — fall through to Supabase
  }

  // 2. Supabase admin_requests fallback
  if (!userId) {
    const { data: sbRow } = await supabase
      .from('admin_requests')
      .select('payload')
      .eq('id', params.id)
      .maybeSingle()

    if (sbRow) {
      const payload = (sbRow.payload ?? {}) as Record<string, string>
      userId = payload.userId ?? null
    }
  }

  // 3. Last resort: params.id is itself the user UUID (orphaned profile shown as request)
  if (!userId) {
    userId = params.id
  }

  try {
    // Fetch survey answers
    const { data: surveyRows } = await supabase
      .from('survey_answers')
      .select('question_key, answer, step')
      .eq('user_id', userId)
      .order('step', { ascending: true })

    // Fetch company data
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    // Transform
    const answers: Record<string, unknown> = {}
    const completedSteps = new Set<number>()

    if (surveyRows) {
      for (const row of surveyRows) {
        const val = (row.answer as Record<string, unknown>)?.value ?? row.answer
        answers[row.question_key] = val
        completedSteps.add(row.step)
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        userId,
        answers,
        company,
        completedSteps: Array.from(completedSteps).sort(),
      },
    })
  } catch (error) {
    console.error('[giga-admin/requests/[id]/survey] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/giga-admin/requests/[id]/survey
 * Admin edits survey answers.
 * Body: { answers: { question_key: value, ... } }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sb = createServerClient()
    const body = await req.json() as { answers: Record<string, unknown> }

    if (!body.answers || Object.keys(body.answers).length === 0) {
      return NextResponse.json({ error: 'answers required' }, { status: 400 })
    }

    // Resolve userId
    let userId: string | null = null
    const { data: arRow } = await sb
      .from('admin_requests')
      .select('payload')
      .eq('id', params.id)
      .maybeSingle()

    if (arRow) {
      userId = (arRow.payload as Record<string, string>)?.userId ?? null
    } else {
      userId = params.id
    }

    if (!userId) {
      return NextResponse.json({ error: 'Cannot resolve userId' }, { status: 400 })
    }

    // Upsert each answer
    const rows = Object.entries(body.answers).map(([question_key, value]) => {
      const stepMatch = question_key.match(/^s(\d)_/)
      const step = stepMatch ? Number(stepMatch[1]) : 1
      return {
        user_id: userId!,
        question_key,
        step,
        answer: { value },
      }
    })

    const { error } = await sb
      .from('survey_answers')
      .upsert(rows, { onConflict: 'user_id,question_key' })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, updated: rows.length })
  } catch (error) {
    console.error('[giga-admin/requests/[id]/survey] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
