import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import { createClient } from '@supabase/supabase-js'

// Staff roles may access any report. Everyone else needs an ownership link.
const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST']

type ReportWithClient = NonNullable<Awaited<ReturnType<typeof loadReport>>>

function loadReport(id: string) {
  return prisma.report.findUnique({
    where: { id },
    include: { client: { select: { managerId: true } } },
  })
}

/**
 * Authorize a caller against a report. Allowed when the caller is staff, the
 * report's uploader, or the manager of the report's client. Returns false
 * otherwise — callers should respond 404 to avoid id enumeration.
 */
function canAccessReport(report: ReportWithClient, userId: string, role: string): boolean {
  if (STAFF_ROLES.includes(role)) return true
  if (report.uploadedBy === userId) return true
  if (report.client?.managerId === userId) return true
  return false
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAuth()
  if (error) return error

  const report = await loadReport(params.id)

  // 404 (not 403) both for missing reports and unauthorized access, so the
  // existence of another tenant's report cannot be probed via id enumeration.
  const userId = (session!.user as any).id as string
  const role = (session!.user as any).role as string
  if (!report || !canAccessReport(report, userId, role)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data, error: signedUrlError } = await supabase.storage
    .from('reports')
    .createSignedUrl(report.filePath, 3600) // 1 hour

  if (signedUrlError) {
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 })
  }

  // Drop the join-only `client` field so the response shape is unchanged.
  const { client: _client, ...reportFields } = report
  return NextResponse.json({ ...reportFields, fileUrl: data.signedUrl })
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAuth()
  if (error) return error

  const report = await loadReport(params.id)

  // 404 (not 403) for both missing and unauthorized, to avoid id enumeration.
  const userId = (session!.user as any).id as string
  const role = (session!.user as any).role as string
  if (!report || !canAccessReport(report, userId, role)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  await supabase.storage.from('reports').remove([report.filePath])
  await prisma.report.delete({ where: { id: params.id } })

  return NextResponse.json({ success: true })
}
