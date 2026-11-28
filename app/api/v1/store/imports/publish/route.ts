export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { authorizeStore } from '@/lib/store/request'
import { MAX_STORE_FILE_BYTES, readStoreImportForm } from '@/lib/store/import/request-body'
import { parseStoreImport, StoreImportError } from '@/lib/store/import/parser'
import {
  buildStorePreviewDigest,
  buildStorePublishPayload,
  STORE_IMPORT_SCHEMA_VERSION,
  StorePublishValidationError,
} from '@/lib/store/import/publication'
import {
  publishStoreImport,
  StorePublishRepositoryError,
} from '@/lib/store/import/repository'

const ALLOWED_EXTENSIONS = new Set(['csv', 'xls', 'xlsx'])
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Origin',
  'X-Content-Type-Options': 'nosniff',
} as const

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
}

function error(status: number, code: string, message: string): NextResponse {
  return json({ ok: false, error: { code, message } }, status)
}

function requestIsSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

function formText(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function parseExpectedCount(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : null
}

function parserFailure(parseError: StoreImportError): NextResponse {
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  if (!requestIsSameOrigin(request)) {
    return error(403, 'invalid_origin', 'Источник запроса не разрешён')
  }
  const access = await authorizeStore(supabase, request.nextUrl.searchParams.get('companyId'))
  if (!access.ok) return error(access.error.status, access.error.code, access.error.message)
  const { userId } = access

  if (await isRateLimitedKey(userId, 'store:import-publish', {
    max: 4,
    windowMs: 10 * 60_000,
  })) {
    return error(429, 'rate_limited', 'Слишком много публикаций. Повторите позже.')
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
  if (!UUID_V4_PATTERN.test(idempotencyKey)) {
    return error(400, 'invalid_idempotency_key', 'Нужен корректный ключ публикации')
  }

  const companyId = access.company.id
  const body = await readStoreImportForm(request)
  if (!('form' in body)) return error(body.status, body.code, body.message)
  const { form } = body

  const upload = form.get('file')
  if (!(upload instanceof File)) {
    return error(400, 'file_required', 'Добавьте исходный файл')
  }
  if (upload.size === 0) return error(422, 'empty_file', 'Файл пуст')
  if (upload.size > MAX_STORE_FILE_BYTES) return error(413, 'file_too_large', 'Файл больше 4 МБ')
  if (upload.name.length > 255 || !ALLOWED_EXTENSIONS.has(extension(upload.name))) {
    return error(415, 'unsupported_file_type', 'Поддерживаются только XLS, XLSX и CSV')
  }

  const expectedSha256 = formText(form, 'expectedSha256')
  const expectedNormalizedSha256 = formText(form, 'expectedNormalizedSha256')
  const expectedKind = formText(form, 'expectedKind')
  const expectedAcceptedRows = parseExpectedCount(formText(form, 'expectedAcceptedRows'))
  const expectedQuarantinedRows = parseExpectedCount(formText(form, 'expectedQuarantinedRows'))
  const expectedSchemaVersion = Number(formText(form, 'expectedSchemaVersion'))
  if (
    !SHA256_PATTERN.test(expectedSha256)
    || !SHA256_PATTERN.test(expectedNormalizedSha256)
    || !['prices', 'inventory', 'sales', 'management_period'].includes(expectedKind)
    || expectedAcceptedRows === null
    || expectedQuarantinedRows === null
    || expectedSchemaVersion !== STORE_IMPORT_SCHEMA_VERSION
  ) {
    return error(400, 'invalid_preview_manifest', 'Предпросмотр нужно сформировать заново')
  }

  try {
    const buffer = Buffer.from(await upload.arrayBuffer())
    const preview = parseStoreImport(buffer, upload.name)
    if (
      preview.file.sha256 !== expectedSha256
      || buildStorePreviewDigest(preview) !== expectedNormalizedSha256
      || preview.detectedKinds.length !== 1
      || preview.detectedKinds[0] !== expectedKind
      || preview.summary.acceptedRows !== expectedAcceptedRows
      || preview.summary.quarantinedRows !== expectedQuarantinedRows
    ) {
      return error(409, 'preview_stale', 'Файл или результат проверки изменился. Сформируйте preview заново.')
    }

    const hasWarnings = preview.summary.quarantinedRows > 0
      || preview.issues.some((issue) => issue.severity === 'warning')
    if (hasWarnings && formText(form, 'confirmWarnings') !== 'true') {
      return error(422, 'warnings_confirmation_required', 'Подтвердите исключение предупреждений и карантина')
    }
    if (expectedKind !== 'management_period' && formText(form, 'confirmVariants') !== 'true') {
      return error(422, 'variants_confirmation_required', 'Подтвердите точное сопоставление вариантов по полному названию')
    }

    const payload = buildStorePublishPayload(preview, formText(form, 'effectiveDate') || null)
    // Persist a non-identifying audit label rather than a user-controlled file
    // name, which may itself contain customer or employee PII.
    const sourceFileLabel = `store-import-${preview.file.sha256.slice(0, 12)}.${extension(upload.name)}`
    const result = await publishStoreImport(createServiceClient(), {
      userId,
      companyId,
      sourceFileName: sourceFileLabel,
      sourceSizeBytes: upload.size,
      sourceSha256: preview.file.sha256,
      idempotencyKey,
      payload,
    })
    return json({
      ok: true,
      data: {
        ...result,
        changed: result.outcome === 'published',
        quarantinedRows: preview.summary.quarantinedRows,
        dashboardUrl: '/store',
      },
    }, result.outcome === 'published' ? 201 : 200)
  } catch (publishError) {
    console.error('[store/import-publish] failed', {
      userId,
      errorName: publishError instanceof Error ? publishError.name : 'unknown',
    })
    if (publishError instanceof StoreImportError) return parserFailure(publishError)
    if (publishError instanceof StorePublishValidationError) {
      const conflict = publishError.code === 'mixed_import_kinds'
        || publishError.code === 'snapshot_date_mismatch'
      return error(
        conflict ? 409 : 422,
        publishError.code,
        conflict
          ? 'Файл требует повторной проверки перед публикацией'
          : publishError.message,
      )
    }
    if (publishError instanceof StorePublishRepositoryError) {
      if (publishError.code === 'conflict') {
        return error(409, 'publish_conflict', 'Данные изменились. Сформируйте preview заново.')
      }
      if (publishError.code === 'invalid_payload') {
        return error(422, 'publication_rejected', 'База отклонила несогласованные данные')
      }
    }
    return error(500, 'store_publish_unavailable', 'Публикация не выполнена. Предыдущие данные не изменены.')
  }
}
