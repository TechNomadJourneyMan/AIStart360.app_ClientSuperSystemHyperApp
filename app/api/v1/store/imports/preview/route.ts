export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'
import { parseStoreImport, StoreImportError } from '@/lib/store/import/parser'
import { toStoreImportPreviewTransport } from '@/lib/store/import/preview-transport'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { hasStoreMfaStepUp, resolveStoreAccess } from '@/lib/store/access'

// Keep the complete multipart request below Vercel Functions' hard 4.5 MB
// payload ceiling. Larger Phase 2 files must use a direct private Blob upload.
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024
const ALLOWED_EXTENSIONS = new Set(['csv', 'xls', 'xlsx'])
const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
} as const

function json(body: unknown, status = 200, headers: HeadersInit = {}): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...RESPONSE_HEADERS, ...headers },
  })
}

function error(status: number, code: string, message: string): NextResponse {
  return json({ ok: false, error: { code, message } }, status)
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

function requestIsTooLarge(request: NextRequest): boolean {
  const header = request.headers.get('content-length')
  if (!header || !/^\d+$/.test(header)) return false
  const length = Number(header)
  return Number.isSafeInteger(length)
    && length > MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return error(401, 'unauthorized', 'Необходима авторизация')
  }
  if (!hasStoreMfaStepUp(user, request.cookies.get(MFA_COOKIE_NAME)?.value)) {
    return error(403, 'mfa_step_up_required', 'Подтвердите вход вторым фактором')
  }

  const access = await resolveStoreAccess(supabase, user.id)
  if (access === 'forbidden') {
    return error(403, 'forbidden', 'Магазин недоступен для этой учётной записи')
  }
  if (access === 'unavailable') {
    return error(500, 'store_access_unavailable', 'Не удалось проверить доступ')
  }

  if (await isRateLimitedKey(user.id, 'store:import-preview', {
    max: 8,
    windowMs: 10 * 60_000,
  })) {
    return error(429, 'rate_limited', 'Слишком много попыток. Повторите позже.')
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!/^multipart\/form-data\s*;[^\r\n]*boundary=/i.test(contentType)) {
    return error(415, 'unsupported_media_type', 'Ожидается multipart/form-data')
  }
  if (requestIsTooLarge(request)) {
    return error(413, 'file_too_large', 'Файл больше 4 МБ')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return error(400, 'invalid_multipart', 'Не удалось прочитать форму загрузки')
  }

  const upload = form.get('file')
  if (!(upload instanceof File)) {
    return error(400, 'file_required', 'Добавьте файл в поле file')
  }
  if (upload.size === 0) {
    return error(422, 'empty_file', 'Файл пуст')
  }
  if (upload.size > MAX_FILE_BYTES) {
    return error(413, 'file_too_large', 'Файл больше 4 МБ')
  }
  if (upload.name.length > 255 || !ALLOWED_EXTENSIONS.has(fileExtension(upload.name))) {
    return error(415, 'unsupported_file_type', 'Поддерживаются только XLS, XLSX и CSV')
  }

  try {
    const buffer = Buffer.from(await upload.arrayBuffer())
    const preview = parseStoreImport(buffer, upload.name)
    return json({ ok: true, data: toStoreImportPreviewTransport(preview) })
  } catch (parseError) {
    // Never reflect parser/library details or sheet content into the response.
    console.error('[store/import-preview] parse failed', {
      userId: user.id,
      fileExtension: fileExtension(upload.name),
      fileSizeBytes: upload.size,
      errorName: parseError instanceof Error ? parseError.name : 'unknown',
    })
    if (parseError instanceof StoreImportError) {
      if (parseError.code === 'unsupported_file_type') {
        return error(415, 'unsupported_file_type', 'Поддерживаются только XLS, XLSX и CSV')
      }
      if (
        parseError.code === 'file_too_large'
        || parseError.code === 'row_limit_exceeded'
        || parseError.code === 'column_limit_exceeded'
        || parseError.code === 'archive_limit_exceeded'
      ) {
        return error(413, 'spreadsheet_limit_exceeded', 'Таблица превышает безопасный лимит разбора')
      }
      return error(422, 'file_unreadable', 'Не удалось безопасно распознать таблицу')
    }
    return error(500, 'store_import_preview_unavailable', 'Не удалось проверить файл. Данные не сохранены')
  }
}
