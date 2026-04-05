import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import { createClient } from '@supabase/supabase-js'

// GET /api/clients/:id
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      griReports: { orderBy: { calculatedAt: 'desc' }, take: 5 },
      reports: { orderBy: { uploadedAt: 'desc' }, take: 10 },
      projects: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseServiceKey && client.reports.length > 0) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Add signed URLs to reports
    const reportsWithUrls = await Promise.all(
      client.reports.map(async (report) => {
        const { data } = await supabase.storage
          .from('reports')
          .createSignedUrl(report.filePath, 3600)
        return { ...report, fileUrl: data?.signedUrl ?? '' }
      })
    )

    return NextResponse.json({ ...client, reports: reportsWithUrls })
  }

  return NextResponse.json(client)
}

// PATCH /api/clients/:id
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const body = await request.json()

  const client = await prisma.client.update({
    where: { id: params.id },
    data: body,
  })

  return NextResponse.json(client)
}

// DELETE /api/clients/:id — soft delete
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  await prisma.client.update({
    where: { id: params.id },
    data: { status: 'inactive' },
  })

  return NextResponse.json({ success: true })
}
