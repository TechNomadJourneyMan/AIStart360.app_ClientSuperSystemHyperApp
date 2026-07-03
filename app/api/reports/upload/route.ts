import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, isStaffRole } from '@/lib/api-utils'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const MAX_SIZE = 50 * 1024 * 1024 // 50MB

export async function POST(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const formData = await request.formData()
  const file     = formData.get('file') as File
  const clientId = formData.get('clientId') as string
  const category = formData.get('category') as string

  // SECURITY (audit 2026-07-02): `clientId` is client-supplied. Authorize it
  // against the caller BEFORE writing anything — the caller must be staff whose
  // organization owns the target client. Without this, any session could attach
  // a file to another tenant's client (cross-tenant IDOR write → the target
  // org's staff would then see/download it). 404 on missing/cross-tenant so
  // client ids can't be probed by enumeration.
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const role = (session!.user as { role?: string }).role
  const orgId = (session!.user as { orgId?: string }).orgId
  const target = await prisma.client.findUnique({ where: { id: clientId }, select: { orgId: true } })
  if (!target || !isStaffRole(role) || !orgId || target.orgId !== orgId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Валидация
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 })
  }

  // Upload to Supabase Storage
  const fileBuffer = await file.arrayBuffer()
  const fileName   = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const filePath   = `reports/${clientId}/${fileName}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('reports')
    .upload(filePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: 'Upload failed', details: uploadError.message }, { status: 500 })
  }

  // Save to DB
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'

  const report = await prisma.report.create({
    data: {
      clientId,
      uploadedBy: session!.user!.id!,
      name:     file.name.replace(`.${ext}`, ''),
      category: category || 'Custom',
      type:     ext,
      fileUrl:  '', // Now unused, we use filePath to generate signed URLs
      fileSize: file.size,
      filePath,
    },
  })

  return NextResponse.json(report, { status: 201 })
}
