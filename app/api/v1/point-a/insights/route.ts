export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = ['ai', 'expert', 'client', 'admin'] as const
const ANSWERED_STATUS = ['confirmed', 'rejected'] as const

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
}

async function resolveCompanyId(
  sb: ReturnType<typeof createServerClient>,
  userId: string
): Promise<string | null> {
  const { data } = await sb
    .from('companies')
    .select('id')
    .eq('user_id', userId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

// ---------------------------------------------------------------------------
// GET /api/v1/point-a/insights?limit=20&type=ai
// ---------------------------------------------------------------------------

const getQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  type: z.enum(ALLOWED_TYPES).optional(),
})

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) return unauthorized()
  const userId = userData.user.id

  const parsedQuery = getQuerySchema.safeParse({
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
    type: req.nextUrl.searchParams.get('type') ?? undefined,
  })
  if (!parsedQuery.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid query parameters' },
      { status: 400 }
    )
  }
  const { limit, type } = parsedQuery.data

  // Fetch items (filtered by type if provided).
  let itemsQuery = sb
    .from('point_a_insights')
    .select(
      'id, user_id, company_id, type, category, question_text, author_name, ' +
        'answer_text, answer_author_name, answer_author_role, answered_at, ' +
        'status, source_meta, created_at, updated_at'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (type) itemsQuery = itemsQuery.eq('type', type)

  const { data: items, error: itemsErr } = await itemsQuery
  if (itemsErr) {
    return NextResponse.json(
      { ok: false, error: 'Failed to load insights' },
      { status: 500 }
    )
  }

  // Counts come from a separate small query so type-filter doesn't skew them.
  const { data: countRows, error: countErr } = await sb
    .from('point_a_insights')
    .select('type, status, answer_text')
    .eq('user_id', userId)

  if (countErr) {
    return NextResponse.json(
      { ok: false, error: 'Failed to load insight counts' },
      { status: 500 }
    )
  }

  const counts = {
    all: countRows?.length ?? 0,
    ai: 0,
    expert: 0,
    client: 0,
    admin: 0,
    pending: 0,
    unanswered: 0,
  }

  for (const row of countRows ?? []) {
    const t = (row as { type?: string }).type
    if (t === 'ai') counts.ai++
    else if (t === 'expert') counts.expert++
    else if (t === 'client') counts.client++
    else if (t === 'admin') counts.admin++

    const status = (row as { status?: string }).status
    if (status === 'pending_ai' || status === 'pending_confirmation') counts.pending++

    const answer = (row as { answer_text?: string | null }).answer_text
    if (!answer || answer.trim() === '') counts.unanswered++
  }

  return NextResponse.json({
    ok: true,
    data: { items: items ?? [], counts },
  })
}

// ---------------------------------------------------------------------------
// POST /api/v1/point-a/insights
// Body: { question_text, category, type }
// ---------------------------------------------------------------------------

const postBodySchema = z.object({
  question_text: z.string().min(4).max(2000),
  category: z.string().min(1).max(64),
  type: z.enum(ALLOWED_TYPES),
  author_name: z.string().max(120).optional(),
  status: z
    .enum(['pending_ai', 'pending_confirmation', 'awaiting_answer'])
    .optional()
    .default('awaiting_answer'),
})

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) return unauthorized()
  const userId = userData.user.id

  const rawBody = await req.json().catch(() => null)
  const parsed = postBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request body' },
      { status: 400 }
    )
  }
  const body = parsed.data

  const companyId = await resolveCompanyId(sb, userId)

  const insertRow = {
    user_id: userId,
    company_id: companyId,
    type: body.type,
    category: body.category,
    question_text: body.question_text,
    author_name: body.author_name ?? null,
    status: body.status,
  }

  const { data: inserted, error: insertErr } = await sb
    .from('point_a_insights')
    .insert(insertRow)
    .select(
      'id, user_id, company_id, type, category, question_text, author_name, ' +
        'answer_text, answer_author_name, answer_author_role, answered_at, ' +
        'status, source_meta, created_at, updated_at'
    )
    .single()

  if (insertErr || !inserted) {
    return NextResponse.json(
      { ok: false, error: 'Failed to create insight' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, data: inserted }, { status: 201 })
}

// `ANSWERED_STATUS` is module-local. Next 14 forbids non-route exports on
// `route.ts` files — duplicate the constant in /[id]/route.ts if needed.
void ANSWERED_STATUS
