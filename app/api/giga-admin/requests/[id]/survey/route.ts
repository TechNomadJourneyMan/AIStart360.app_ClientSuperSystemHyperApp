export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/db'
import { authorizeUserDataRead, resolveRequestUserId } from '@/lib/admin/user-data-access'
import { requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { canManageTarget } from '@/lib/admin/rbac'
import { adminEditSurvey, SurveyEditError } from '@/lib/admin/survey-admin'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/giga-admin/requests/[id]/survey
 * Returns onboarding survey answers and company data for a given AdminRequest.
 * Resolves userId via Prisma → Supabase admin_requests fallback → params.id (orphaned profile).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await authorizeUserDataRead(req, ['survey.view', 'users.sensitive'], async (sb) => {
    // Prisma admin_requests first (legacy), then the Supabase table / profile id.
    try {
      const adminRequest = await prisma.adminRequest.findUnique({ where: { id: params.id } })
      const fromPrisma = ((adminRequest?.payload ?? {}) as Record<string, string>).userId
      if (fromPrisma) return fromPrisma
    } catch {
      // Prisma unavailable — fall through to Supabase
    }
    return resolveRequestUserId(sb, params.id)
  })
  if ('response' in access) return access.response
  const supabase = access.sb
  const userId = access.userId
  if (!userId) return NextResponse.json({ ok: true, data: { answers: {}, company: null, completedSteps: [] } })

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
  const guard = await requireGiga(req, 'survey.edit')
  if (guard.response) return guard.response
  const actor = guard.actor

  try {
    // SERVICE client: the giga panel has no Supabase session (auth.uid() is
    // NULL), so an anon-client upsert into survey_answers is rejected/dropped
    // by RLS — the same silent-no-op class of bug as the approve incident.
    const sb = createServiceClient()
    const body = await req.json() as { answers: Record<string, unknown> }

    if (!body.answers || Object.keys(body.answers).length === 0) {
      return NextResponse.json({ error: 'answers required' }, { status: 400 })
    }

    const userId = await resolveRequestUserId(sb, params.id)
    if (!userId) {
      return NextResponse.json({ error: 'Cannot resolve userId' }, { status: 400 })
    }
    const target = await staffRoleOfUser(userId)
    if (!canManageTarget(actor.role, target.staffRole)) {
      return NextResponse.json({ error: 'Недостаточно прав для этого пользователя' }, { status: 403 })
    }

    // Old → new diff, history attribution and the mandatory audit entry live in
    // adminEditSurvey (shared with GIGA-CRM User 360).
    const result = await adminEditSurvey(actor, userId, body.answers as Record<string, unknown>, req)
    return NextResponse.json({ ok: true, updated: result.updated, deleted: result.deleted, ignored: result.ignored })
  } catch (error) {
    if (error instanceof SurveyEditError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[giga-admin/requests/[id]/survey] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
