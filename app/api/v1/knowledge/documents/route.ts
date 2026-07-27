import { createServerClient } from '@/lib/supabase-server'
import { inngest } from '@/lib/inngest'
import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { DomainError, errorResponse } from '@/lib/sales-monitoring/errors'
import {
  contentHash,
  registerKnowledgeDocument,
} from '@/lib/sales-monitoring/knowledge-ingestion'

export const runtime = 'nodejs'
export const maxDuration = 60

const allowedExtensions = new Set(['pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt'])

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    const organizationId = String(form.get('organizationId') ?? '')
    if (!(file instanceof File)) throw new DomainError('FILE_REQUIRED', 'Выберите документ', 400)
    if (!organizationId) throw new DomainError('ORGANIZATION_REQUIRED', 'Организация обязательна', 400)
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!allowedExtensions.has(extension)) {
      throw new DomainError('FILE_TYPE_INVALID', 'Поддерживаются PDF, DOCX, XLSX, CSV и TXT', 422)
    }
    if (file.size > 50 * 1024 * 1024) throw new DomainError('FILE_TOO_LARGE', 'Максимальный размер — 50 МБ', 422)

    const access = await requireSalesPermission(organizationId, 'knowledge:write')
    const buffer = Buffer.from(await file.arrayBuffer())
    const hash = contentHash(buffer)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${organizationId}/${hash}-${safeName}`
    const supabase = createServerClient()
    const upload = await supabase.storage
      .from('knowledge-documents')
      .upload(storagePath, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
    if (upload.error && !/already exists/i.test(upload.error.message)) {
      throw new DomainError('STORAGE_UPLOAD_FAILED', upload.error.message, 502)
    }
    const data = await registerKnowledgeDocument({
      organizationId,
      fileName: file.name,
      mimeType: file.type,
      storagePath,
      contentHash: hash,
      access,
    })
    if (!data.duplicate) {
      await inngest.send({
        name: 'knowledge/document.uploaded',
        data: { documentId: data.id, organizationId },
      })
    }
    return Response.json({ data }, { status: data.duplicate ? 200 : 202 })
  } catch (error) {
    return errorResponse(error)
  }
}
