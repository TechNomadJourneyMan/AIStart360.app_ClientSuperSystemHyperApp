/**
 * lib/documents/file-route.ts — the handler of GET /api/v1/files/documents
 * (app/api/v1/files/documents/route.ts), separate from the route file so tests
 * can call it with in-memory access lookups.
 *
 * Opens a stored file without ever exposing a public Storage URL: the access
 * check (./file-access.ts — owner, staff in scope, company reader) runs on the
 * server, then the caller is redirected (302) to a signed URL that lives 10
 * minutes (`format=json` returns it instead). `bucket` defaults to the formerly
 * public `documents` bucket (legacy questionnaire answers).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { decideFileAccess, FILE_SIGNED_URL_TTL_SECONDS, type FileAccessDeps } from './file-access'
import { isFileRouteBucket, type FileRef } from './survey-files'
import { documentStorage, StorageError } from './storage'

const NO_STORE = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }

function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE })
}

export async function handleFileRequest(req: NextRequest, deps: FileAccessDeps): Promise<NextResponse> {
  const params = req.nextUrl.searchParams
  const bucket = params.get('bucket') ?? 'documents'
  const path = params.get('path') ?? ''
  if (!isFileRouteBucket(bucket)) return fail(400, 'Недопустимое хранилище файла')

  const ref: FileRef = { bucket, path }
  let decision: Awaited<ReturnType<typeof decideFileAccess>>
  try {
    decision = await decideFileAccess(ref, deps)
  } catch (err) {
    console.error('[files/documents] access check failed', err instanceof Error ? err.message : err)
    return fail(503, 'Не удалось проверить доступ к файлу. Повторите попытку.')
  }
  if (!decision.ok) return fail(decision.status, decision.error)

  let signed: string | null
  try {
    signed = await documentStorage().signedUrl(ref, FILE_SIGNED_URL_TTL_SECONDS)
  } catch (err) {
    if (err instanceof StorageError && err.code === 'NOT_CONFIGURED') return fail(503, 'Хранилище файлов не настроено')
    signed = null
  }
  if (!signed) return fail(404, 'Файл не найден')

  if (params.get('format') === 'json') {
    return NextResponse.json({ ok: true, url: signed, expires_in: FILE_SIGNED_URL_TTL_SECONDS }, { headers: NO_STORE })
  }
  const res = NextResponse.redirect(signed, 302)
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v)
  return res
}
