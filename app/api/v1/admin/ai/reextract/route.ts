/**
 * POST /api/v1/admin/ai/reextract
 * Body: { company_id?: string, document_id?: string, trigger?: 'manual_rerun' }
 *
 * Admin-triggered re-extraction. Two modes:
 *   - `document_id` provided → rerun that single document through the
 *     pipeline (parse + classify + extract + consensus).
 *   - `company_id` provided → rerun survey pipeline for that company.
 *     Documents are NOT re-extracted (bypass by calling this endpoint
 *     per document if needed).
 *
 * Useful when:
 *   - An extractor version bumped — rerun bumped documents.
 *   - A company's data looks stale — trigger a fresh consensus pass.
 *   - Testing new prompts — specify a sample document.
 *
 * Admin-only (admin / super_admin).
 */

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'
import { orchestrate, type OrchestrationTrigger } from '@/lib/ai/orchestrator'

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let body: { company_id?: string; document_id?: string; trigger?: OrchestrationTrigger }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  if (!body.document_id && !body.company_id) {
    return NextResponse.json(
      { ok: false, error: 'document_id or company_id required' },
      { status: 400 }
    )
  }

  // Resolve company + owner user from whichever id is given
  let userId: string | undefined
  let companyId: string | undefined

  if (body.document_id) {
    const { data: doc } = await sb
      .from('documents')
      .select('user_id, company_id')
      .eq('id', body.document_id)
      .maybeSingle()
    if (!doc) return NextResponse.json({ ok: false, error: 'document not found' }, { status: 404 })
    userId = doc.user_id
    companyId = doc.company_id ?? undefined
  } else if (body.company_id) {
    const { data: company } = await sb
      .from('companies')
      .select('id, user_id')
      .eq('id', body.company_id)
      .maybeSingle()
    if (!company) return NextResponse.json({ ok: false, error: 'company not found' }, { status: 404 })
    userId = company.user_id
    companyId = company.id
  }

  if (!userId || !companyId) {
    return NextResponse.json({ ok: false, error: 'could not resolve user+company' }, { status: 400 })
  }

  try {
    const res = await orchestrate({
      trigger: body.trigger ?? (body.document_id ? 'document_uploaded' : 'manual_rerun'),
      userId,
      companyId,
      documentId: body.document_id,
      triggerEntity: body.document_id
        ? `documents.${body.document_id}`
        : `admin.reextract.${companyId}`,
    })
    return NextResponse.json({ ok: true, data: res })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
