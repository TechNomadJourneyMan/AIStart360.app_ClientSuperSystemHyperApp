export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
//   - Dynamically imports `@/lib/documents/bind-fields` (which is being built in
//     parallel). If the import fails, the route returns the existing fields
//     unchanged with a `note` field — instead of erroring out.
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

  // 6. Dynamically import bind-fields. Module may not exist yet — degrade gracefully.
  let rebound: ParsedDataField[] = existingFields
  let bindModuleAvailable = true
  let bindError: string | null = null

  try {
    // The bind-fields module is built in parallel and may not be present yet.
    // We use an indirected specifier so `tsc` does not fail with TS2307 before
    // the module lands on disk. At runtime, the alias resolves normally when
    // the file exists; otherwise the dynamic import rejects and `.catch()`
    // routes us into the degrade branch below.
    const bindFieldsSpecifier = '@/lib/documents/bind-fields'
    const mod = await import(/* @vite-ignore */ bindFieldsSpecifier).catch((err) => {
      bindError = err instanceof Error ? err.message : 'import failed'
      return null
    })
    if (!mod || typeof (mod as { bindFieldsToMetrics?: unknown }).bindFieldsToMetrics !== 'function') {
      bindModuleAvailable = false
    } else {
      const fn = (mod as {
        bindFieldsToMetrics: (
          fields: ParsedDataField[],
          docType: string,
        ) =>
          | Promise<ParsedDataField[] | { fields: ParsedDataField[] }>
          | ParsedDataField[]
          | { fields: ParsedDataField[] }
      }).bindFieldsToMetrics
      const out = await fn(existingFields, doc.doc_type)
      // The binder may return either a bare array (legacy contract used by the
      // earlier rebind-route test) or `{ fields, stats }` (current contract).
      // Normalize so the persistence + diff logic below works uniformly.
      if (Array.isArray(out)) {
        rebound = out
      } else if (out && Array.isArray((out as { fields?: unknown }).fields)) {
        rebound = (out as { fields: ParsedDataField[] }).fields
      } else {
        rebound = existingFields
      }
    }
  } catch (err) {
    bindModuleAvailable = false
    bindError = err instanceof Error ? err.message : 'bind error'
  }

  if (!bindModuleAvailable) {
    return NextResponse.json({
      ok: true,
      data: { updated: 0, total: existingFields.length },
      note: 'bind-fields module not available yet',
      ...(bindError ? { detail: bindError } : {}),
    })
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
