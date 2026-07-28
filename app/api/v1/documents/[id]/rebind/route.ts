export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bindFieldsToMetrics } from '@/lib/documents/bind-fields'
import type { ParsedDataField } from '@/lib/documents/extract'

// POST /api/v1/documents/[id]/rebind
// Re-runs metric binding on an already-parsed document without re-extracting.
// Useful when the binding logic improves — admin can re-bind historic docs.
//
// Auth:
//   - The caller must be authenticated.
//   - The caller must own the document, or have the 'admin' (or SUPER_ADMIN) role
//     in their `profiles` row.
//
// Preconditions:
//   - The document's `parse_status` must be 'parsed'. Otherwise 409.
//
// Behavior:
//   - Reads existing `parsed_data.fields[]`.
//   - Re-runs the deterministic field-to-metric binder.
//   - Persists `parsed_data = { ...existing, fields: rebound, rebound_at }`.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = await createClient()

  // 1. Auth
  const {
    data: { user },
    error: authError,
  } = await sb.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401 },
    )
  }

  // 2. Fetch document
  const { data: doc, error: fetchErr } = await sb
    .from('documents')
    .select('id, user_id, doc_type, parse_status, parsed_data')
    .eq('id', params.id)
    .single()

  if (fetchErr || !doc) {
    return NextResponse.json(
      { ok: false, error: fetchErr?.message ?? 'document not found' },
      { status: 404 },
    )
  }

  // 3. Owner-or-admin authorization
  if (doc.user_id !== user.id) {
    const { data: profile } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = (profile?.role ?? '').toString().toLowerCase()
    const isAdmin =
      role === 'admin' || role === 'super_admin' || role === 'superadmin'
    if (!isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'forbidden' },
        { status: 403 },
      )
    }
  }

  // 4. Status guard
  if (doc.parse_status !== 'parsed') {
    return NextResponse.json(
      { ok: false, error: 'document not parsed yet' },
      { status: 409 },
    )
  }

  // 5. Read existing fields
  const existing =
    (doc.parsed_data as { fields?: ParsedDataField[] } | null) ?? {}
  const existingFields: ParsedDataField[] = Array.isArray(existing.fields)
    ? existing.fields
    : []

  // 6. Rebind against the canonical metric registry.
  const { fields: rebound } = await bindFieldsToMetrics(
    existingFields,
    doc.doc_type,
  )

  // 7. Compute how many fields had their metric_id changed
  let updatedCount = 0
  for (let i = 0; i < rebound.length; i += 1) {
    const before = (existingFields[i] as unknown as { metric_id?: string | null } | undefined)?.metric_id ?? null
    const after = (rebound[i] as unknown as { metric_id?: string | null } | undefined)?.metric_id ?? null
    if (before !== after) updatedCount += 1
  }

  // 8. Persist
  const nowISO = new Date().toISOString()
  const newPayload = {
    ...existing,
    fields: rebound,
    rebound_at: nowISO,
  }

  const { error: updateErr } = await sb
    .from('documents')
    .update({ parsed_data: newPayload })
    .eq('id', doc.id)

  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: updateErr.message },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    data: { updated: updatedCount, total: rebound.length },
  })
}
