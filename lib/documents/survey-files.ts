/**
 * lib/documents/survey-files.ts — files referenced from questionnaire answers
 * (step 6 «Скрипты»: s6n_script_*), and links to stored objects that never
 * expose a public Storage URL.
 *
 * Stored answer values:
 *   - NEW: `<bucket>/<path>` — a storage path, never a URL
 *     (`client-documents/<uid>/<uuid>.pdf`, uploaded through the document
 *     pipeline, lib/documents/client-upload.ts);
 *   - LEGACY: a public URL of the former public bucket `documents`
 *     (`https://<project>.supabase.co/storage/v1/object/public/documents/<uid>/<field>/<ts>.pdf`).
 *     Migration 133 makes that bucket private, so the URL itself stops working;
 *     the path is parsed out of it and served through the access-checked route.
 *
 * Every link goes through GET /api/v1/files/documents?bucket=…&path=… — the
 * server checks access (owner / staff with scope / company reader) and
 * redirects to a short-lived signed URL.
 *
 * Browser-safe: no server imports.
 */
import { isSupabaseStorageUrl } from '@/lib/upload-url'

/** The formerly public bucket (legacy uploads: step 6 scripts, medical intake). */
export const LEGACY_DOCUMENTS_BUCKET = 'documents'

/** Buckets the file route serves. Never `cms-media` (public by design) or report/import buckets. */
export const FILE_ROUTE_BUCKETS = ['documents', 'client-documents'] as const
export type FileRouteBucket = (typeof FILE_ROUTE_BUCKETS)[number]

export const FILE_ROUTE_PATH = '/api/v1/files/documents'

/** Questionnaire keys whose answer is a file. */
export const SURVEY_FILE_KEYS = ['s6n_script_first_contact', 's6n_script_meeting', 's6n_script_proposal'] as const

export function isSurveyFileKey(key: string): boolean {
  return (SURVEY_FILE_KEYS as readonly string[]).includes(key)
}

export interface FileRef {
  bucket: FileRouteBucket
  path: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isFileRouteBucket(v: unknown): v is FileRouteBucket {
  return typeof v === 'string' && (FILE_ROUTE_BUCKETS as readonly string[]).includes(v)
}

/** A relative object path without traversal, control characters or empty segments. */
export function isSafeObjectPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) return false
  if (path.startsWith('/') || path.includes('\\')) return false
  for (let i = 0; i < path.length; i += 1) {
    const c = path.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return path.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
}

/** The owner of an object: its first folder when that is a user id; null for root-level objects. */
export function ownerFolderOf(path: string): string | null {
  const segments = path.split('/')
  if (segments.length < 2) return null
  return UUID_RE.test(segments[0]) ? segments[0].toLowerCase() : null
}

/**
 * `https://<our project>/storage/v1/object/{public|sign|authenticated}/<bucket>/<path>` → ref,
 * for the buckets the file route serves. URL-encoded names (spaces, parentheses, Cyrillic) are decoded.
 */
export function parseLegacyStorageUrl(raw: unknown): FileRef | null {
  if (!isSupabaseStorageUrl(raw)) return null
  let url: URL
  try {
    url = new URL(raw as string)
  } catch {
    return null
  }
  const m = url.pathname.match(/^\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/)
  if (!m) return null
  let bucket: string
  let path: string
  try {
    bucket = decodeURIComponent(m[1])
    path = m[2].split('/').map((s) => decodeURIComponent(s)).join('/')
  } catch {
    return null
  }
  if (!isFileRouteBucket(bucket) || !isSafeObjectPath(path)) return null
  return { bucket, path }
}

/** The answer value written for a new upload: `<bucket>/<path>`. */
export function encodeFileRef(ref: FileRef): string {
  return `${ref.bucket}/${ref.path}`
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    return (value as { value: unknown }).value
  }
  return value
}

/** A file reference stored in an answer (new `<bucket>/<path>` or a legacy Storage URL), else null. */
export function surveyFileRef(value: unknown): FileRef | null {
  const v = unwrap(value)
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return parseLegacyStorageUrl(s)
  const slash = s.indexOf('/')
  if (slash <= 0) return null
  const bucket = s.slice(0, slash)
  const path = s.slice(slash + 1)
  if (!isFileRouteBucket(bucket) || !isSafeObjectPath(path) || !ownerFolderOf(path)) return null
  return { bucket, path }
}

/** Same-origin link to the access-checked route (it redirects to a short-lived signed URL). */
export function fileHref(ref: FileRef): string {
  const q = new URLSearchParams({ bucket: ref.bucket, path: ref.path })
  return `${FILE_ROUTE_PATH}?${q.toString()}`
}

/** Absolute link to the route on the portal (exports: Google Sheets) — never a Storage URL. */
export function absoluteFileHref(ref: FileRef, origin: string): string {
  return `${origin.replace(/\/+$/, '')}${fileHref(ref)}`
}

/** The object's file name (last path segment). */
export function fileRefName(ref: FileRef): string {
  return ref.path.split('/').pop() || ref.path
}

/** Plain-text label of a file answer (exports, PDF, shared report, AI contexts). */
export function surveyFileLabel(value: unknown): string | null {
  const ref = surveyFileRef(value)
  return ref ? `Файл: ${fileRefName(ref)}` : null
}
