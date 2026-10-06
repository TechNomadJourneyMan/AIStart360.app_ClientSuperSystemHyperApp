/**
 * HTTP adapter for document finalize — shared by
 *   POST /api/v1/documents                (storage_path contract, new uploaders)
 *   POST /api/v1/onboarding/documents     (legacy: file_url of a Storage object;
 *                                          also accepts storage_path)
 *
 * Both run the same rules (lib/documents/finalize.ts). The legacy body is
 * translated to a storage location by parsing the Supabase Storage URL; the
 * signed URL itself is never stored.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/api-identity'
import { emitPlatformEventSafely } from '@/lib/events/platform'
import { trackEvent } from '@/lib/events/track'
import { notifyAdmins } from '@/lib/notifications'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServerClient } from '@/lib/supabase-server'
import { resolveTenant, tenantErrorMessage } from '@/lib/tenancy'
import { DOCUMENT_TYPES } from './doc-types'
import { finalizeUpload, type FinalizeOutcome } from './finalize'
import { findDuplicate, insertDocument } from './repository'
import { documentStorage, LEGACY_UPLOAD_BUCKETS, parseStorageUrl, UPLOAD_BUCKET } from './storage'

const quarter = z.enum(['Q1', 'Q2', 'Q3', 'Q4'])
const year = z.coerce.number().int()

const storagePathBody = z.object({
  storage_path: z.string().min(3).max(1024),
  bucket: z.string().min(1).max(100).optional(),
  file_name: z.string().min(1).max(1000),
  doc_type: z.enum(DOCUMENT_TYPES),
  company_id: z.string().min(1).max(100).nullish(),
  period: z.object({ quarter: quarter.nullish(), year: year.nullish() }).nullish(),
  period_quarter: quarter.nullish().or(z.literal('')),
  period_year: year.nullish(),
})

const legacyBody = z.object({
  file_url: z.string().min(1).max(4096),
  file_name: z.string().min(1).max(1000),
  doc_type: z.enum(DOCUMENT_TYPES),
  company_id: z.string().min(1).max(100).nullish(),
  period_quarter: quarter.nullish().or(z.literal('')),
  period_year: year.nullish(),
})

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status })

export type FinalizeMode = 'storage_path' | 'legacy'

export async function handleDocumentFinalize(req: Request, mode: FinalizeMode): Promise<NextResponse> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { ok: false, code: 'BAD_JSON', error: 'Некорректное тело запроса' })
  }

  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return json(401, { ok: false, code: 'UNAUTHENTICATED', error: 'Требуется вход в систему' })
  if (await isRateLimitedKey(user.id, 'documents-finalize', { max: 30, windowMs: 60_000 })) {
    return json(429, { ok: false, code: 'RATE_LIMITED', error: 'Слишком много загрузок. Попробуйте через минуту.' })
  }

  // Legacy clients may already send storage_path; prefer it when present.
  const hasPath = typeof (raw as { storage_path?: unknown })?.storage_path === 'string'
  let bucket: string
  let storagePath: string
  let fileName: string
  let docType: string
  let companyId: string | null
  let periodQuarter: string | null
  let periodYear: number | null
  let allowedBuckets: readonly string[]

  if (mode === 'storage_path' || hasPath) {
    const parsed = storagePathBody.safeParse(raw)
    if (!parsed.success) return json(400, { ok: false, code: 'BAD_REQUEST', error: badRequestMessage(parsed.error) })
    const b = parsed.data
    bucket = b.bucket ?? UPLOAD_BUCKET
    storagePath = b.storage_path
    fileName = b.file_name
    docType = b.doc_type
    companyId = b.company_id ?? null
    periodQuarter = b.period?.quarter ?? (b.period_quarter || null)
    periodYear = b.period?.year ?? b.period_year ?? null
    allowedBuckets = mode === 'legacy' ? LEGACY_UPLOAD_BUCKETS : [UPLOAD_BUCKET]
  } else {
    const parsed = legacyBody.safeParse(raw)
    if (!parsed.success) return json(400, { ok: false, code: 'BAD_REQUEST', error: badRequestMessage(parsed.error) })
    const b = parsed.data
    const loc = parseStorageUrl(b.file_url)
    if (!loc) {
      return json(400, { ok: false, code: 'BAD_FILE_URL', error: 'file_url должен указывать на файл в хранилище Supabase' })
    }
    bucket = loc.bucket
    storagePath = loc.path
    fileName = b.file_name
    docType = b.doc_type
    companyId = b.company_id ?? null
    periodQuarter = b.period_quarter || null
    periodYear = b.period_year ?? null
    allowedBuckets = LEGACY_UPLOAD_BUCKETS
  }

  const tenant = await resolveTenant({ companyId, access: 'read' })
  if (!tenant.ok) {
    const error = tenant.error === 'no_company'
      ? 'Сначала заполните данные компании — документы привязываются к компании.'
      : tenantErrorMessage(tenant.error)
    return json(tenant.status === 401 ? 401 : tenant.error === 'no_company' ? 409 : tenant.status, { ok: false, code: tenant.error.toUpperCase(), error })
  }
  if (tenant.tenant.role === 'viewer') {
    return json(403, { ok: false, code: 'FORBIDDEN', error: 'Роль «наблюдатель» не может загружать документы.' })
  }

  const outcome = await finalizeUpload(
    {
      userId: user.id,
      companyId: tenant.tenant.companyId,
      bucket,
      storagePath,
      fileName,
      docType,
      periodQuarter,
      periodYear,
      allowedBuckets,
    },
    {
      storage: documentStorage(),
      findDuplicate,
      insertDocument,
      emit: emitPlatformEventSafely,
    },
  )

  if (outcome.kind === 'created') {
    const doc = outcome.document
    void trackEvent({
      userId: user.id, name: 'DOCUMENT_UPLOADED', entityType: 'document', entityId: doc.id,
      metadata: { doc_type: doc.doc_type, mime_type: doc.sniffed_mime },
    })
    notifyAdmins('file_uploaded', {
      fileName: doc.file_name, docType: doc.doc_type, fileSize: doc.size_bytes, mimeType: doc.sniffed_mime,
    }, user.id)
  }
  return finalizeResponse(outcome)
}

export function finalizeResponse(outcome: FinalizeOutcome): NextResponse {
  switch (outcome.kind) {
    case 'created':
      return json(201, { ok: true, duplicate: false, data: outcome.document })
    case 'duplicate':
      return json(200, { ok: true, duplicate: true, data: outcome.document })
    case 'rejected':
      return json(422, { ok: false, rejected: true, code: outcome.code, error: outcome.reason, data: outcome.document })
    case 'invalid':
      return json(outcome.status, { ok: false, code: outcome.code, error: outcome.error })
  }
}

function badRequestMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  const field = issue?.path.join('.') || 'тело запроса'
  if (field === 'doc_type') return 'Неизвестный тип документа.'
  return `Некорректное поле: ${field}`
}
