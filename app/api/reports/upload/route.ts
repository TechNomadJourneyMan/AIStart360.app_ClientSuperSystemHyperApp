import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALLOWED_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const MAX_SIZE = 50 * 1024 * 1024 // 50MB

export async function POST(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const formData = await request.formData()
  const file     = formData.get('file') as File
  const clientId = formData.get('clientId') as string
  const category = formData.get('category') as string

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

  // Get public URL (signed, 24h)
  const { data: urlData } = await supabase.storage.from('reports').createSignedUrl(filePath, 86400)

  // Save to DB
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'

  const report = await prisma.report.create({
    data: {
      clientId,
      uploadedBy: session!.user!.id!,
      name:     file.name.replace(`.${ext}`, ''),
      category: category || 'Custom',
      type:     ext,
      fileUrl:  urlData?.signedUrl ?? '',
      fileSize: file.size,
      filePath,
    },
  })

  return NextResponse.json(report, { status: 201 })
}
