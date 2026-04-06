export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * GET /api/giga-admin/requests/:id/documents
 * Returns documents uploaded by the client associated with this request.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const request = await prisma.adminRequest.findUnique({ where: { id: params.id } })
    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    const payload = (request.payload ?? {}) as Record<string, string>
    const userId = payload.userId
    if (!userId) {
      return NextResponse.json({ ok: true, data: [] })
    }

    const sb = createServerClient()
    const { data, error } = await sb
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, data: data ?? [] })
  } catch (error) {
    console.error('[giga-admin/requests/:id/documents] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
