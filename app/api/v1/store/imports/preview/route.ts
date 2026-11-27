export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { MAX_STORE_FILE_BYTES, readStoreImportForm } from '@/lib/store/import/request-body'
import { parseStoreImport, StoreImportError } from '@/lib/store/import/parser'
import { toStoreImportPreviewTransport } from '@/lib/store/import/preview-transport'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { authorizeStore } from '@/lib/store/request'

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const access = await authorizeStore(supabase, request.nextUrl.searchParams.get('companyId'))
  if (!access.ok) return error(access.error.status, access.error.code, access.error.message)
  const { userId } = access

  if (await isRateLimitedKey(userId, 'store:import-preview', {
    max: 8,
    windowMs: 10 * 60_000,
  })) {
    return error(429, 'rate_limited', 'Слишком много попыток. Повторите позже.')
  }

  const body = await readStoreImportForm(request)
  if (!('form' in body)) return error(body.status, body.code, body.message)
  const { form } = body

  const upload = form.get('file')
  if (!(upload instanceof File)) {
    return error(400, 'file_required', 'Добавьте файл в поле file')
  }
  if (upload.size === 0) {
    return error(422, 'empty_file', 'Файл пуст')
  }
  if (upload.size > MAX_STORE_FILE_BYTES) {
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
      userId,
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
