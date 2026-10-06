/**
 * lib/documents/storage.ts — where document bytes live and how the server
 * reads them.
 *
 * Every server-side read of an uploaded object goes through `documentStorage()`
 * with a byte cap: the object is streamed and the download is aborted as soon
 * as it exceeds the cap, so a huge object can never be buffered into memory.
 * The production backend is Supabase Storage with the service role; tests and
 * alternative backends inject their own implementation with
 * `setDocumentStorage()` (dependency injection — product code paths are the
 * same).
 *
 * Path rules: uploads live in ONE private bucket (`client-documents`) under the
 * uploader's folder `<auth uid>/…` (storage RLS of migration 015 enforces the
 * same rule for the browser). Legacy rows may still point at the public
 * `documents` bucket; they are readable for processing but never accepted for
 * new uploads through the storage_path contract.
 */
import { isSupabaseStorageUrl } from '@/lib/upload-url'

export interface StorageLocation {
  bucket: string
  path: string
}

export type StorageErrorCode = 'NOT_FOUND' | 'TOO_LARGE' | 'UNAVAILABLE' | 'NOT_CONFIGURED'

export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

export interface DocumentStorage {
  /** Download at most `maxBytes`; throws StorageError TOO_LARGE beyond that. */
  download(loc: StorageLocation, opts: { maxBytes: number; timeoutMs?: number }): Promise<Buffer>
  /** Delete the object. Missing objects are not an error. */
  remove(loc: StorageLocation): Promise<void>
  /** Short-lived signed download URL, or null when it cannot be issued. */
  signedUrl(loc: StorageLocation, expiresInSeconds: number): Promise<string | null>
}

/** The private bucket new uploads must use. */
export const UPLOAD_BUCKET = 'client-documents'
/** Buckets accepted for legacy URL-based registrations (old uploaders). */
export const LEGACY_UPLOAD_BUCKETS: readonly string[] = ['client-documents', 'documents']

// ─── Path validation ────────────────────────────────────────────────────────

/** C0 control characters or DEL. */
export function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/** `s` without C0 control characters and DEL. */
export function stripControlChars(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c >= 0x20 && c !== 0x7f) out += s[i]
  }
  return out
}

export type PathCheck = { ok: true; location: StorageLocation } | { ok: false; reason: string }

/** The object must be in an allowed bucket and inside the uploader's own folder. */
export function checkUploadLocation(
  userId: string,
  bucket: string,
  path: string,
  allowedBuckets: readonly string[] = [UPLOAD_BUCKET],
): PathCheck {
  if (!allowedBuckets.includes(bucket)) return { ok: false, reason: 'Недопустимое хранилище файла.' }
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) {
    return { ok: false, reason: 'Некорректный путь к файлу.' }
  }
  if (hasControlChars(path) || path.includes('\\') || path.startsWith('/')) {
    return { ok: false, reason: 'Некорректный путь к файлу.' }
  }
  const segments = path.split('/')
  if (segments.length < 2 || segments.some((s) => s === '' || s === '.' || s === '..')) {
    return { ok: false, reason: 'Некорректный путь к файлу.' }
  }
  if (segments[0] !== userId) {
    return { ok: false, reason: 'Файл должен находиться в вашей папке хранилища.' }
  }
  return { ok: true, location: { bucket, path } }
}

/** `https://<project>/storage/v1/object/{public|sign|authenticated}/<bucket>/<path>` → location. */
export function parseStorageUrl(raw: string): StorageLocation | null {
  if (!isSupabaseStorageUrl(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const m = url.pathname.match(/^\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/)
  if (!m) return null
  try {
    const path = m[2].split('/').map((s) => decodeURIComponent(s)).join('/')
    return { bucket: decodeURIComponent(m[1]), path }
  } catch {
    return null
  }
}

/**
 * Where a documents row's bytes are. New rows: storage_bucket/storage_path.
 * Legacy rows: a Supabase Storage URL in file_url, or a bare path (the medical
 * intake stores paths of the `documents` bucket).
 */
export function locationForDocument(row: {
  storage_bucket?: string | null
  storage_path?: string | null
  file_url?: string | null
}): StorageLocation | null {
  if (row.storage_bucket && row.storage_path) return { bucket: row.storage_bucket, path: row.storage_path }
  const url = row.file_url ?? ''
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return parseStorageUrl(url)
  if (url.startsWith('/') || url.includes('..')) return null
  return { bucket: 'documents', path: url }
}

/** A processing-time guard: the object must sit in the owner's folder. */
export function isInOwnerFolder(loc: StorageLocation, ownerUserId: string): boolean {
  return loc.path.split('/')[0] === ownerUserId
}

// ─── Supabase backend ───────────────────────────────────────────────────────

function serviceConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new StorageError('NOT_CONFIGURED', 'хранилище не настроено (SUPABASE_SERVICE_ROLE_KEY)')
  return { url: url.replace(/\/+$/, ''), key }
}

function objectUrl(base: string, loc: StorageLocation): string {
  const path = loc.path.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/${encodeURIComponent(loc.bucket)}/${path}`
}

/** Read a response body, aborting once it exceeds `maxBytes`. */
export async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new StorageError('TOO_LARGE', 'файл превышает допустимый размер')
  }
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new StorageError('TOO_LARGE', 'файл превышает допустимый размер')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

export const supabaseDocumentStorage: DocumentStorage = {
  async download(loc, { maxBytes, timeoutMs = 60_000 }) {
    const { url, key } = serviceConfig()
    let res: Response
    try {
      res = await fetch(objectUrl(url, loc), {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new StorageError('UNAVAILABLE', 'хранилище недоступно')
    }
    if (res.status === 400 || res.status === 404) {
      await res.body?.cancel().catch(() => {})
      throw new StorageError('NOT_FOUND', 'файл не найден в хранилище')
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new StorageError('UNAVAILABLE', `хранилище ответило HTTP ${res.status}`)
    }
    try {
      return await readCapped(res, maxBytes)
    } catch (err) {
      if (err instanceof StorageError) throw err
      throw new StorageError('UNAVAILABLE', 'загрузка файла прервана')
    }
  },

  async remove(loc) {
    const { url, key } = serviceConfig()
    const res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(loc.bucket)}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [loc.path] }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null)
    if (!res || (!res.ok && res.status !== 404)) {
      throw new StorageError('UNAVAILABLE', 'не удалось удалить файл из хранилища')
    }
  },

  async signedUrl(loc, expiresInSeconds) {
    const { url, key } = serviceConfig()
    const res = await fetch(`${url}/storage/v1/object/sign/${encodeURIComponent(loc.bucket)}/${loc.path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!res?.ok) return null
    const json = (await res.json().catch(() => null)) as { signedURL?: string; signedUrl?: string } | null
    const signed = json?.signedURL ?? json?.signedUrl
    if (!signed) return null
    return signed.startsWith('http') ? signed : `${url}/storage/v1${signed}`
  },
}

// ─── Injection point ────────────────────────────────────────────────────────

let active: DocumentStorage | null = null

export function documentStorage(): DocumentStorage {
  return active ?? supabaseDocumentStorage
}

/** Swap the backend (tests, local runs without Supabase). `null` restores Supabase. */
export function setDocumentStorage(storage: DocumentStorage | null): void {
  active = storage
}
