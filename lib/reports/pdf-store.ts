/**
 * lib/reports/pdf-store.ts — the PDF of a report version, rendered once per
 * stage and kept in private Supabase Storage (bucket 'report-pdfs', migration
 * 103; service role only — there are no storage.objects policies for it).
 *
 * Stages
 *   review  every unpublished version (in_review, legacy ready / draft):
 *           «Версия N · дата» + watermark «На проверке эксперта»
 *   final   a version that was published (published_at set): the same
 *           document without the watermark
 * The object path encodes the stage (`<company>/<version id>/review-vN.pdf`,
 * `…/vN.pdf`), so report_versions.pdf_storage_path always tells which stage is
 * stored; publishing renders the final stage once and replaces the path.
 *
 * Rendering reads only report_versions.content (frozen), so a re-render is the
 * same document. When Storage is not configured or fails, the PDF is rendered
 * in memory and served anyway — the caller is never blocked by Storage; the
 * failure is logged without URLs or keys.
 */
import { prisma } from '@/lib/db'
import { BUSINESS_TIME_ZONE } from '@/lib/format/period'
import type { ReportContent, ReportStatus } from './types'
import { renderReportVersionPdf, REVIEW_WATERMARK } from './version-pdf'

export const REPORT_PDF_BUCKET = 'report-pdfs'
const MAX_PDF_BYTES = 20 * 1024 * 1024

export type PdfStage = 'review' | 'final'

export interface VersionForPdf {
  id: string
  company_id: string
  version: number
  status: ReportStatus | string
  created_at: string | Date
  published_at: string | Date | null
  content: ReportContent
  pdf_storage_path: string | null
}

export interface ReportPdfStorage {
  configured(): boolean
  /** Throws on failure. */
  upload(path: string, bytes: Buffer): Promise<void>
  /** null when the object does not exist or cannot be read. */
  download(path: string): Promise<Buffer | null>
}

function serviceConfig(): { url: string; key: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/$/, '')
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  return url && key ? { url, key } : null
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** Supabase Storage REST (same endpoints as lib/documents/storage.ts). */
export const supabaseReportPdfStorage: ReportPdfStorage = {
  configured: () => serviceConfig() !== null,
  async upload(path, bytes) {
    const cfg = serviceConfig()
    if (!cfg) throw new Error('storage not configured')
    const res = await fetch(`${cfg.url}/storage/v1/object/${REPORT_PDF_BUCKET}/${encodePath(path)}`, {
      method: 'POST',
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true', 'cache-control': 'no-store' },
      body: new Uint8Array(bytes),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`storage upload HTTP ${res.status}`)
    }
  },
  async download(path) {
    const cfg = serviceConfig()
    if (!cfg) return null
    try {
      const res = await fetch(`${cfg.url}/storage/v1/object/${REPORT_PDF_BUCKET}/${encodePath(path)}`, {
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        return null
      }
      const buf = Buffer.from(await res.arrayBuffer())
      return buf.length > 0 && buf.length <= MAX_PDF_BYTES && buf.subarray(0, 5).toString('latin1') === '%PDF-' ? buf : null
    } catch {
      return null
    }
  },
}

let active: ReportPdfStorage | null = null

export function reportPdfStorage(): ReportPdfStorage {
  return active ?? supabaseReportPdfStorage
}

/** Swap the backend (tests). `null` restores Supabase. */
export function setReportPdfStorage(storage: ReportPdfStorage | null): void {
  active = storage
}

export function pdfStageFor(v: Pick<VersionForPdf, 'status' | 'published_at'>): PdfStage {
  return v.status === 'published' || v.published_at ? 'final' : 'review'
}

export function pdfObjectPath(v: Pick<VersionForPdf, 'company_id' | 'id' | 'version'>, stage: PdfStage): string {
  const company = String(v.company_id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
  return `${company}/${v.id}/${stage === 'review' ? 'review-' : ''}v${v.version}.pdf`
}

export function renderVersionPdf(v: VersionForPdf, stage: PdfStage = pdfStageFor(v)): Promise<Buffer> {
  return renderReportVersionPdf(v.content, {
    version: { number: v.version, createdAt: v.created_at },
    watermark: stage === 'review' ? REVIEW_WATERMARK : null,
  })
}

export interface VersionPdf {
  bytes: Buffer
  stage: PdfStage
  /** The bytes came from / were saved to Storage at `path`. */
  stored: boolean
  path: string | null
}

/**
 * The PDF of the version for its current stage: the stored copy when it is
 * the right stage, else render it once (and store it unless `store: false`).
 */
export async function versionPdf(v: VersionForPdf, opts: { stage?: PdfStage; store?: boolean } = {}): Promise<VersionPdf> {
  const stage = opts.stage ?? pdfStageFor(v)
  const path = pdfObjectPath(v, stage)
  const storage = reportPdfStorage()
  const usable = storage.configured()
  if (usable && v.pdf_storage_path === path) {
    const stored = await storage.download(path)
    if (stored) return { bytes: stored, stage, stored: true, path }
  }
  const bytes = await renderVersionPdf(v, stage)
  if (!usable || opts.store === false) return { bytes, stage, stored: false, path: null }
  try {
    await storage.upload(path, bytes)
    await prisma.$executeRaw`
      UPDATE public.report_versions SET pdf_storage_path = ${path}, pdf_rendered_at = now()
      WHERE id = ${v.id}::uuid AND pdf_storage_path IS DISTINCT FROM ${path}`
    return { bytes, stage, stored: true, path }
  } catch (err) {
    console.error('[reports/pdf-store] PDF not stored:', err instanceof Error ? err.message.split('\n')[0] : 'error')
    return { bytes, stage, stored: false, path: null }
  }
}

/** ASCII file name for attachments: aistart360-point_a-v3-2026-10-06.pdf (date in Asia/Almaty). */
export function versionPdfFilename(v: Pick<VersionForPdf, 'version' | 'created_at'> & { report_type?: string }, stage: PdfStage): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v.created_at))
  const type = (v.report_type ?? 'point_a').replace(/[^a-z_]/g, '')
  return `aistart360-${type}-v${v.version}-${day}${stage === 'review' ? '-review' : ''}.pdf`
}
