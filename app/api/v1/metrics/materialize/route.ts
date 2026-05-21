// ============================================================
// app/api/v1/metrics/materialize/route.ts
// POST (or GET) /api/v1/metrics/materialize
//
// Runs the registry resolver for the authenticated user's
// company, then upserts every resolvable value into
// `public.metrics`. The /metrics page calls this once on first
// mount (if every catalog item is null) so 126 «—» cards turn
// into real numbers without a manual recompute click.
//
// No body required. Auth is via the Supabase server client
// (RLS-respecting; `metrics` insert is governed by the company-
// scoped RLS policy installed in migration 016).
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  gatherResolverContext,
  materializeAll,
} from '@/lib/metrics/materialize'

export const dynamic = 'force-dynamic'

interface OkBody {
  ok: true
  data: {
    written: number
    total: number
    skipped: number
    errors: Array<{ metricId: string; error: string }>
  }
}

interface ErrBody {
  ok: false
  error: string
}

async function run(): Promise<NextResponse<OkBody | ErrBody>> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: 'Не авторизован' } satisfies ErrBody,
      { status: 401 },
    )
  }

  const { data: companyRow, error: companyError } = await supabase
    .from('companies')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (companyError) {
    return NextResponse.json(
      { ok: false, error: companyError.message } satisfies ErrBody,
      { status: 500 },
    )
  }

  if (!companyRow) {
    // Soft signal — client can render empty state without error.
    return NextResponse.json(
      { ok: false, error: 'no_company' } satisfies ErrBody,
      { status: 200 },
    )
  }

  const companyId = companyRow.id as string

  try {
    const ctx = await gatherResolverContext(supabase, {
      userId: user.id,
      companyId,
    })
    const { result } = await materializeAll(supabase, ctx)
    return NextResponse.json(
      {
        ok: true,
        data: {
          written: result.written,
          total: result.total,
          skipped: result.skipped,
          errors: result.errors,
        },
      } satisfies OkBody,
      { status: 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    return NextResponse.json(
      { ok: false, error: message } satisfies ErrBody,
      { status: 500 },
    )
  }
}

export async function POST() {
  return run()
}

// Some clients prefer GET for simple idempotent triggers.
export async function GET() {
  return run()
}
