// ============================================================
// GET /api/v1/point-a/filters
//
// Discovery endpoint for the Top Sales Table filter bar.
// Walks the caller's parsed sales-report documents and returns
// the distinct product / manager identifiers found in them.
//
// Response:
//   { ok: true, data: { products: {id,name}[], managers: {id,name}[] } }
//
// Auth-gated by Supabase. Cache: Next 14 revalidate=60.
// Never throws — empty arrays on no-data.
// ============================================================

export const revalidate = 60

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { discoverFilters, type FilterOption } from '@/lib/point-a/v3/top-table'

interface FiltersResponse {
  ok: true
  data: {
    products: FilterOption[]
    managers: FilterOption[]
    computed_at: string
  }
}

interface FiltersFail {
  ok: false
  error: string
}

function unauthorized() {
  return NextResponse.json<FiltersFail>(
    { ok: false, error: 'Unauthorized' },
    { status: 401 },
  )
}

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return unauthorized()

  try {
    const filters = await discoverFilters(supabase, user.id)
    const body: FiltersResponse = {
      ok: true,
      data: {
        products: filters.products,
        managers: filters.managers,
        computed_at: new Date().toISOString(),
      },
    }
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json<FiltersFail>(
      { ok: false, error: `filters failed: ${message}` },
      { status: 500 },
    )
  }
}
