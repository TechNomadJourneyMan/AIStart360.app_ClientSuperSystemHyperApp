/**
 * lib/documents/client-upload.ts — the browser side of the document upload
 * contract (shared by every client uploader).
 *
 *   1. upload the file to the PRIVATE bucket `client-documents` at
 *      `<auth uid>/<uuid>.<ext>` (storage RLS: own folder only);
 *   2. POST /api/v1/documents { storage_path, bucket, file_name, doc_type,
 *      period?, company_id? } — the server checks, dedupes, registers and
 *      starts processing on its own (no /process call after upload).
 *
 * Results are a typed union; every failure carries a Russian message for the
 * UI. Network / Supabase access is injectable for tests.
 *
 * Browser-safe: must not import server modules (preflight.ts pulls node:zlib).
 */
import { createClient } from '@/lib/supabase/client'
import { isDocumentType, type DocumentTypeValue } from './doc-types'
import { DUPLICATE_MESSAGE, type ClientDocument } from './status-view'

export type { ClientDocument } from './status-view'

/** The private bucket new uploads must use (server: lib/documents/storage.ts UPLOAD_BUCKET). */
export const CLIENT_DOCUMENT_BUCKET = 'client-documents'

/** Client-side size cap — the server default (DEFAULT_DOCUMENT_MAX_BYTES, 25 MB). */
export const CLIENT_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024
export const CLIENT_DOCUMENT_MAX_LABEL = '25 МБ'

/** Extensions the server preflight accepts (lib/documents/preflight.ts EXTENSION_KIND). */
export const CLIENT_DOCUMENT_EXTENSIONS = [
  'pdf', 'docx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'pptx', 'png', 'jpg', 'jpeg',
] as const

/** `accept` attribute for <input type="file">. */
export const CLIENT_DOCUMENT_ACCEPT = CLIENT_DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(',')

/** Human list of formats for UI hints. */
export const CLIENT_DOCUMENT_FORMATS_LABEL = 'PDF, DOCX, XLSX, XLS, CSV, TXT, PPTX, PNG, JPG'

const FORMAT_HINTS: Record<string, string> = {
  doc: 'Формат .doc (Word 97–2003) не поддерживается — сохраните документ как DOCX или PDF.',
  ppt: 'Формат .ppt не поддерживается — сохраните презентацию как PPTX или PDF.',
  xlsm: 'Книги Excel с макросами (.xlsm) не принимаются — сохраните как XLSX.',
  docm: 'Документы Word с макросами (.docm) не принимаются — сохраните как DOCX.',
  pptm: 'Презентации с макросами (.pptm) не принимаются — сохраните как PPTX.',
}

export function fileExtensionOf(name: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export type FileCheck = { ok: true; ext: string } | { ok: false; error: string }

/** Size and format check before anything is sent. */
export function checkClientFile(file: { name: string; size: number }): FileCheck {
  if (!file || file.size <= 0) return { ok: false, error: 'Файл пуст.' }
  if (file.size > CLIENT_DOCUMENT_MAX_BYTES) {
    return { ok: false, error: `Файл больше ${CLIENT_DOCUMENT_MAX_LABEL}. Загрузите файл меньшего размера или разделите его на части.` }
  }
  const ext = fileExtensionOf(file.name)
  if (!(CLIENT_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      error: FORMAT_HINTS[ext] ?? `Формат${ext ? ` .${ext}` : ''} не поддерживается. Загрузите ${CLIENT_DOCUMENT_FORMATS_LABEL}.`,
    }
  }
  return { ok: true, ext }
}

// ─── Injectable access ──────────────────────────────────────────────────────

interface StorageResult<T> {
  data: T | null
  error: { message: string; statusCode?: string | number; status?: number } | null
}

/** The slice of the Supabase browser client this module uses. */
export interface UploadSupabaseLike {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
  }
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: File | Blob,
        opts?: { contentType?: string; upsert?: boolean; cacheControl?: string },
      ): Promise<StorageResult<{ path: string }>>
      remove(paths: string[]): Promise<StorageResult<unknown>>
      createSignedUrl(path: string, expiresIn: number): Promise<StorageResult<{ signedUrl: string }>>
    }
  }
}

export interface ClientDeps {
  supabase?: UploadSupabaseLike
  fetch?: typeof fetch
  uuid?: () => string
}

function supabaseOf(deps: ClientDeps): UploadSupabaseLike {
  return deps.supabase ?? createClient()
}

function fetchOf(deps: ClientDeps): typeof fetch {
  return deps.fetch ?? ((input, init) => fetch(input, init))
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const CYRILLIC = /[а-яё]/i

/** The server's message when it is user-facing Russian, else a Russian fallback by status. */
export function httpErrorMessage(status: number | null, serverError: unknown, fallback?: string): string {
  if (status === 401) return 'Сессия истекла — войдите в систему снова.'
  if (typeof serverError === 'string' && CYRILLIC.test(serverError)) return serverError
  switch (status) {
    case null: return 'Нет связи с сервером. Проверьте подключение и повторите.'
    case 400: return fallback ?? 'Некорректный запрос.'
    case 403: return 'Недостаточно прав для этого действия.'
    case 404: return 'Документ не найден.'
    case 409: return fallback ?? 'Действие сейчас недоступно для этого документа.'
    case 429: return 'Слишком много запросов. Попробуйте через минуту.'
    case 503: return 'Сервис временно недоступен. Повторите попытку.'
    default: return fallback ?? `Ошибка сервера (HTTP ${status}).`
  }
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    // Not JSON (proxy error page, empty body) — the caller reports the HTTP status.
    return null
  }
}

function storageErrorMessage(err: { message?: string; statusCode?: string | number; status?: number } | null | undefined): string {
  const msg = err?.message ?? ''
  const code = String(err?.statusCode ?? err?.status ?? '')
  if (code === '413' || /maximum allowed size|too large/i.test(msg)) {
    return 'Файл слишком большой для хранилища.'
  }
  if (/failed to fetch|networkerror|network|load failed/i.test(msg)) {
    return 'Нет связи с хранилищем. Проверьте подключение и повторите.'
  }
  if (code === '403' || code === '401' || /row-level security|unauthorized|jwt/i.test(msg)) {
    return 'Нет доступа к хранилищу документов. Войдите в систему снова и повторите.'
  }
  if (/bucket not found/i.test(msg)) return 'Хранилище документов не настроено. Сообщите администратору.'
  return msg ? `Не удалось загрузить файл в хранилище: ${msg}` : 'Не удалось загрузить файл в хранилище.'
}

// ─── Upload ─────────────────────────────────────────────────────────────────

export interface UploadOptions {
  docType: DocumentTypeValue | string
  period?: { quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null; year?: number | null } | null
  companyId?: string | null
  /** Real phases of the flow (for the UI line, not a percentage). */
  onPhase?: (phase: 'storage' | 'register') => void
}

export type UploadFailureStage = 'validation' | 'auth' | 'storage' | 'register'

export type UploadOutcome =
  | { kind: 'created'; document: ClientDocument }
  | { kind: 'duplicate'; document: ClientDocument; message: string }
  | { kind: 'rejected'; document: ClientDocument | null; code: string; error: string }
  | { kind: 'failed'; stage: UploadFailureStage; status: number | null; code: string; error: string }

const REGISTER_FALLBACK: Record<number, string> = {
  400: 'Некорректные данные файла. Проверьте тип документа и период.',
  404: 'Файл не найден в хранилище. Загрузите его заново.',
  409: 'Сначала заполните данные компании — документы привязываются к компании.',
}

function asDocument(value: unknown): ClientDocument | null {
  if (!value || typeof value !== 'object') return null
  const doc = value as ClientDocument
  return typeof doc.id === 'string' ? doc : null
}

export async function uploadClientDocument(
  file: File,
  opts: UploadOptions,
  deps: ClientDeps = {},
): Promise<UploadOutcome> {
  const check = checkClientFile(file)
  if (!check.ok) return { kind: 'failed', stage: 'validation', status: null, code: 'INVALID_FILE', error: check.error }
  if (!isDocumentType(opts.docType)) {
    return { kind: 'failed', stage: 'validation', status: null, code: 'BAD_DOC_TYPE', error: 'Выберите тип документа.' }
  }

  const sb = supabaseOf(deps)
  const doFetch = fetchOf(deps)

  let userId: string | null = null
  try {
    const { data } = await sb.auth.getUser()
    userId = data.user?.id ?? null
  } catch (err) {
    console.warn('[documents/upload] getUser failed', err instanceof Error ? err.message : err)
  }
  if (!userId) {
    return { kind: 'failed', stage: 'auth', status: 401, code: 'UNAUTHENTICATED', error: 'Войдите в систему, чтобы загрузить документ.' }
  }

  const storagePath = `${userId}/${(deps.uuid ?? randomId)()}.${check.ext}`
  const bucket = sb.storage.from(CLIENT_DOCUMENT_BUCKET)

  opts.onPhase?.('storage')
  try {
    const { error } = await bucket.upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
      cacheControl: '3600',
    })
    if (error) {
      return { kind: 'failed', stage: 'storage', status: null, code: 'STORAGE_UPLOAD', error: storageErrorMessage(error) }
    }
  } catch (err) {
    return {
      kind: 'failed', stage: 'storage', status: null, code: 'STORAGE_UPLOAD',
      error: storageErrorMessage({ message: err instanceof Error ? err.message : String(err) }),
    }
  }

  opts.onPhase?.('register')
  const period = opts.period && (opts.period.quarter || opts.period.year)
    ? {
        ...(opts.period.quarter ? { quarter: opts.period.quarter } : {}),
        ...(opts.period.year ? { year: opts.period.year } : {}),
      }
    : undefined
  const body = {
    storage_path: storagePath,
    bucket: CLIENT_DOCUMENT_BUCKET,
    file_name: file.name,
    doc_type: opts.docType,
    ...(period ? { period } : {}),
    ...(opts.companyId ? { company_id: opts.companyId } : {}),
  }

  let res: Response
  try {
    res = await doFetch('/api/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
  } catch (err) {
    // Unknown whether the server registered it — keep the object (a retry dedupes by content).
    console.warn('[documents/upload] finalize request failed', err instanceof Error ? err.message : err)
    return {
      kind: 'failed', stage: 'register', status: null, code: 'NETWORK',
      error: 'Нет связи с сервером: файл загружен, но не зарегистрирован. Повторите загрузку.',
    }
  }

  const json = await readJson(res)
  const document = asDocument(json?.data)

  if (res.ok && json?.ok === true && document) {
    return json.duplicate === true
      ? { kind: 'duplicate', document, message: DUPLICATE_MESSAGE }
      : { kind: 'created', document }
  }
  if (res.status === 422 && json?.rejected === true) {
    return {
      kind: 'rejected',
      document,
      code: typeof json.code === 'string' ? json.code : 'REJECTED',
      error: httpErrorMessage(422, json.error, 'Файл не прошёл проверку и отклонён.'),
    }
  }

  // The server did not keep the object for these answers (bad body, no
  // company, viewer role, rate limit, auth): remove our orphan, best-effort.
  if (res.status >= 400 && res.status < 500 && res.status !== 404) {
    try {
      const { error } = await bucket.remove([storagePath])
      if (error) console.warn('[documents/upload] orphan object not removed', error.message)
    } catch (err) {
      console.warn('[documents/upload] orphan object not removed', err instanceof Error ? err.message : err)
    }
  }

  return {
    kind: 'failed',
    stage: 'register',
    status: res.status,
    code: typeof json?.code === 'string' ? json.code : res.ok ? 'BAD_RESPONSE' : `HTTP_${res.status}`,
    error: res.ok
      ? 'Сервер вернул неожиданный ответ. Обновите страницу и проверьте список документов.'
      : httpErrorMessage(res.status, json?.error, REGISTER_FALLBACK[res.status]),
  }
}

// ─── List / reprocess / delete / open ───────────────────────────────────────

export type ListOutcome =
  | { ok: true; documents: ClientDocument[] }
  | { ok: false; status: number | null; error: string }

/** GET /api/v1/onboarding/documents — the caller's own documents (session user). */
export async function fetchClientDocuments(deps: ClientDeps = {}): Promise<ListOutcome> {
  let res: Response
  try {
    res = await fetchOf(deps)('/api/v1/onboarding/documents', { credentials: 'include', cache: 'no-store' })
  } catch {
    return { ok: false, status: null, error: httpErrorMessage(null, null) }
  }
  const json = await readJson(res)
  if (res.ok && json?.ok === true && Array.isArray(json.data)) {
    return { ok: true, documents: (json.data as unknown[]).map(asDocument).filter((d): d is ClientDocument => d !== null) }
  }
  return { ok: false, status: res.status, error: httpErrorMessage(res.status, json?.error, 'Не удалось загрузить список документов.') }
}

export type ReprocessOutcome =
  | { ok: true; taskId: string | null; alreadyQueued: boolean; document: ClientDocument | null }
  | { ok: false; status: number | null; code: string; error: string }

/** POST /api/v1/onboarding/documents/[id]/process → 202 (queued or already queued). */
export async function reprocessClientDocument(id: string, deps: ClientDeps = {}): Promise<ReprocessOutcome> {
  let res: Response
  try {
    res = await fetchOf(deps)(`/api/v1/onboarding/documents/${encodeURIComponent(id)}/process`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    return { ok: false, status: null, code: 'NETWORK', error: httpErrorMessage(null, null) }
  }
  const json = await readJson(res)
  if (res.ok && json?.ok === true) {
    return {
      ok: true,
      taskId: typeof json.task_id === 'string' ? json.task_id : null,
      alreadyQueued: json.already_queued === true,
      document: asDocument(json.data),
    }
  }
  return {
    ok: false,
    status: res.status,
    code: typeof json?.code === 'string' ? json.code : `HTTP_${res.status}`,
    error: httpErrorMessage(res.status, json?.error, 'Не удалось запустить обработку.'),
  }
}

export type DeleteOutcome = { ok: true } | { ok: false; status: number | null; error: string }

/** DELETE /api/v1/onboarding/documents/[id] — the document, its object and derived data. */
export async function deleteClientDocument(id: string, deps: ClientDeps = {}): Promise<DeleteOutcome> {
  let res: Response
  try {
    res = await fetchOf(deps)(`/api/v1/onboarding/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch {
    return { ok: false, status: null, error: httpErrorMessage(null, null) }
  }
  const json = await readJson(res)
  if (res.ok && json?.ok === true) return { ok: true }
  return { ok: false, status: res.status, error: httpErrorMessage(res.status, json?.error, 'Не удалось удалить документ.') }
}

function signedUrlErrorMessage(raw: string): string {
  if (/failed to fetch|networkerror|network|load failed/i.test(raw)) {
    return 'Нет связи с хранилищем. Проверьте подключение и повторите.'
  }
  if (/not found/i.test(raw)) return 'Файл не найден в хранилище.'
  return `Не удалось получить ссылку на файл${raw ? ` (${raw})` : ''}.`
}

export type DownloadUrlOutcome = { ok: true; url: string } | { ok: false; error: string }

/**
 * Legacy rows store a Supabase Storage URL in file_url — some of them a
 * year-long SIGNED url (a bearer token kept in the database). Parse the
 * bucket/path out of it so a fresh short-lived link can be signed instead.
 */
function legacyStorageLocation(raw: string): { bucket: string; path: string; signed: boolean } | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const m = url.pathname.match(/\/storage\/v1\/object\/(public|sign|authenticated)\/([^/]+)\/(.+)$/)
  if (!m) return null
  try {
    return {
      bucket: decodeURIComponent(m[2]),
      path: m[3].split('/').map((s) => decodeURIComponent(s)).join('/'),
      signed: m[1] !== 'public',
    }
  } catch {
    return null
  }
}

async function signedUrl(bucket: string, path: string, deps: ClientDeps): Promise<DownloadUrlOutcome | null> {
  try {
    const { data, error } = await supabaseOf(deps).storage.from(bucket).createSignedUrl(path, 3600)
    if (data?.signedUrl) return { ok: true, url: data.signedUrl }
    if (error) return { ok: false, error: signedUrlErrorMessage(error.message) }
  } catch (err) {
    return { ok: false, error: signedUrlErrorMessage(err instanceof Error ? err.message : String(err)) }
  }
  return null
}

/**
 * A short-lived link to the caller's own document. New rows: a signed URL of
 * storage_bucket/storage_path (storage RLS lets the owner sign their folder).
 * Legacy rows with a Supabase Storage URL: a fresh 1-hour link for the parsed
 * bucket/path — the stored long-lived signed URL is never handed out again (a
 * public-bucket URL, readable anyway, is the fallback when signing is refused).
 * Other legacy http(s) URLs (non-Supabase hosts): as stored.
 */
export async function documentDownloadUrl(
  doc: Pick<ClientDocument, 'storage_bucket' | 'storage_path' | 'file_url'>,
  deps: ClientDeps = {},
): Promise<DownloadUrlOutcome> {
  if (doc.storage_bucket && doc.storage_path) {
    const fresh = await signedUrl(doc.storage_bucket, doc.storage_path, deps)
    if (fresh) return fresh
  }
  if (doc.file_url && /^https?:\/\//i.test(doc.file_url)) {
    const legacy = legacyStorageLocation(doc.file_url)
    if (!legacy) return { ok: true, url: doc.file_url }
    const fresh = await signedUrl(legacy.bucket, legacy.path, deps)
    if (fresh?.ok) return fresh
    if (!legacy.signed) return { ok: true, url: doc.file_url }
    return fresh ?? { ok: false, error: 'Файл недоступен для просмотра.' }
  }
  return { ok: false, error: 'Файл недоступен для просмотра.' }
}
