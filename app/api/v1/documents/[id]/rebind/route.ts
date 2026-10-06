export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ParsedDataField } from '@/lib/documents/extract'
import { saveParsedData } from '@/lib/documents/repository'
import { bindFieldsToMetrics } from '@/lib/documents/bind-fields'

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
//   - Re-runs the deterministic binder (lib/documents/bind-fields.ts). A static
//     import: a variable specifier with the `@/` alias is not resolvable in the
//     Next.js bundle, so the old dynamic import always failed in production.
//   - Persists `parsed_data = { ...existing, fields: rebound, rebound_at }`
//     through the server connection (service privileges) after authz.
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
    if (fetchErr && fetchErr.code !== 'PGRST116') console.error('[documents/rebind] load failed', fetchErr.code, fetchErr.message)
    return NextResponse.json({ ok: false, error: 'document not found' }, { status: 404 })
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

  // 6. Re-run the deterministic binder (no model call: useAI is off).
  let rebound: ParsedDataField[]
  try {
    rebound = (await bindFieldsToMetrics(existingFields, doc.doc_type)).fields
  } catch (err) {
    console.error('[documents/rebind] bind failed', doc.id, err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось перепривязать поля' }, { status: 500 })
  }

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

  // Written through the server connection after the authz above: the 089
  // guard blocks parsed_data for PostgREST callers, and staff have no UPDATE
  // policy on other users' rows (the old user-scoped update silently changed
  // 0 rows and still answered ok:true).
  try {
    const saved = await saveParsedData(doc.id, newPayload)
    if (!saved) {
      return NextResponse.json({ ok: false, error: 'document not found' }, { status: 404 })
    }
  } catch (err) {
    console.error('[documents/rebind] save failed', doc.id, err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'save failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: { updated: updatedCount, total: rebound.length },
  })
}
