import { createServerClient } from '@/lib/supabase-server'
import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse, DomainError } from '@/lib/sales-monitoring/errors'
import { createImportJob } from '@/lib/sales-monitoring/import-service'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    const organizationId = String(form.get('organizationId') ?? '')
    const kind = String(form.get('kind') ?? 'sales')
    if (!(file instanceof File)) throw new DomainError('FILE_REQUIRED', 'Выберите файл', 400)
    if (!organizationId) throw new DomainError('ORGANIZATION_REQUIRED', 'Организация обязательна', 400)
    if (!['sales', 'expenses', 'plans', 'master_data'].includes(kind)) {
      throw new DomainError('IMPORT_KIND_INVALID', 'Неизвестный тип импорта', 422)
    }
    if (file.size > 50 * 1024 * 1024) throw new DomainError('FILE_TOO_LARGE', 'Максимальный размер — 50 МБ', 422)
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      throw new DomainError('FILE_TYPE_INVALID', 'Поддерживаются XLSX, XLS и CSV', 422)
    }
    const access = await requireSalesPermission(organizationId, 'imports:write')
    const buffer = Buffer.from(await file.arrayBuffer())
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${organizationId}/${Date.now()}-${safeName}`
    const supabase = createServerClient()
    const upload = await supabase.storage
      .from('sales-imports')
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream' })
    const storedPath = upload.error ? undefined : upload.data.path
    const data = await createImportJob({
      organizationId,
      kind: kind as 'sales' | 'expenses' | 'plans' | 'master_data',
      fileName: file.name,
      storagePath: storedPath,
      buffer,
      access,
    })
    return Response.json({ data }, { status: data.duplicate ? 200 : 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
