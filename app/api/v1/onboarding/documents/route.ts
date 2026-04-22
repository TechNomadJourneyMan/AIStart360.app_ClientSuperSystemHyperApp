export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/notifications'
import { orchestrate } from '@/lib/ai/orchestrator'

// GET /api/v1/onboarding/documents?user_id=xxx
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })

  const sb = createServerClient()
  const { data, error } = await sb
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data: data ?? [] })
}

// POST /api/v1/onboarding/documents — register document after upload
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id, company_id, file_name, file_url, file_size, mime_type, doc_type, period_quarter, period_year } = body

    if (!user_id || !file_name || !file_url || !doc_type) {
      return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
    }

    const sb = createServerClient()

    const { data: doc, error } = await sb
      .from('documents')
      .insert({
        user_id,
        company_id: company_id ?? null,
        file_name,
        file_url,
        file_size: file_size ?? null,
        mime_type: mime_type ?? null,
        doc_type,
        period_quarter: period_quarter ?? null,
        period_year: period_year ?? null,
        parse_status: 'queued',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Notify admins about file upload (fire-and-forget)
    notifyAdmins('file_uploaded', {
      fileName: file_name,
      docType: doc_type,
      fileSize: file_size,
      mimeType: mime_type,
    }, user_id)

    // Kick off the AI orchestrator — parse + classify + extract + consensus.
    // Non-blocking when AI_BACKBONE=inngest|n8n. Inline mode adds 5-30s
    // depending on extractor + doc size.
    let aiRunId: string | undefined
    if (doc?.id && company_id) {
      try {
        // Flip to processing immediately so UI reflects activity
        await sb.from('documents').update({ parse_status: 'processing' }).eq('id', doc.id)

        const res = await orchestrate({
          trigger: 'document_uploaded',
          userId: user_id,
          companyId: company_id,
          documentId: doc.id,
          triggerEntity: `documents.${doc.id}`,
        })
        aiRunId = res.runId
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[documents] orchestrator dispatch failed:', err)
        await sb.from('documents').update({ parse_status: 'failed' }).eq('id', doc.id)
      }
    }

    return NextResponse.json({ ok: true, data: doc, ai_run_id: aiRunId })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}
