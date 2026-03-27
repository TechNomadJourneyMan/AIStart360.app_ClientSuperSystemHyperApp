import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

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

    // Trigger n8n webhook for document parsing (fire-and-forget)
    const n8nUrl = process.env.N8N_WEBHOOK_URL
    if (n8nUrl && doc) {
      fetch(n8nUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.N8N_API_KEY ? { 'X-Api-Key': process.env.N8N_API_KEY } : {}),
        },
        body: JSON.stringify({
          document_id: doc.id,
          user_id,
          file_url,
          doc_type,
          period: { year: period_year, quarter: period_quarter },
        }),
      }).catch(() => {
        // Non-blocking — log but don't fail
        console.warn('[documents] n8n webhook failed for doc', doc.id)
      })

      // Update status to processing
      await sb
        .from('documents')
        .update({ parse_status: 'processing' })
        .eq('id', doc.id)
    }

    return NextResponse.json({ ok: true, data: doc })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}
