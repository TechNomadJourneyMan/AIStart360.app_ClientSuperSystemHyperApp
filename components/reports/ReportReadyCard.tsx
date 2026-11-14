/**
 * ReportReadyCard — «Ваш отчёт готов» on /client/home (R-025).
 *
 * Shown only when the client's company has a published report version (an
 * expert checked and published it); no version → nothing at all. Server-safe:
 * no hooks, no 'use client' — the home page renders it with the data it reads
 * through the caller's session (RLS: a tenant sees only published versions).
 *
 * The full report (findings, share link to this version) lives on Point A
 * (#reports, components/reports/PublishedReports); the PDF is
 * GET /api/v1/reports/:id/pdf.
 */
import Link from 'next/link'
import { versionStamp } from '@/lib/reports/version-stamp'

export interface ReadyReport {
  id: string
  version: number
  title: string
  published_at: string | null
  created_at: string | null
}

/** Where «Открыть отчёт» leads: the report section of Point A in the client cabinet. */
export const REPORT_SECTION_HREF = '/client/point-a#reports'

const time = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isFinite(t) ? t : -Infinity
}

/**
 * The latest published version from report_versions rows (already filtered to
 * status 'published' by the query, but a row without a publication date or an
 * id never counts). Null when there is none.
 */
export function pickPublishedReport(rows: ReadonlyArray<Record<string, unknown>> | null | undefined): ReadyReport | null {
  let best: ReadyReport | null = null
  for (const r of rows ?? []) {
    if (r == null || r.id == null || !r.published_at) continue
    if (r.status != null && r.status !== 'published') continue
    const candidate: ReadyReport = {
      id: String(r.id),
      version: Number(r.version) || 1,
      title: String(r.title ?? 'Отчёт по Точке А'),
      published_at: String(r.published_at),
      created_at: r.created_at == null ? null : String(r.created_at),
    }
    if (!best || time(candidate.published_at) > time(best.published_at)) best = candidate
  }
  return best
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function ReportReadyCard({ report }: { report: ReadyReport }) {
  const stamp = versionStamp(report.version, report.created_at ?? report.published_at ?? new Date(0))
  return (
    <section
      aria-labelledby="report-ready-title"
      className="relative overflow-hidden rounded-3xl border border-primary/20 bg-primary/[0.04] p-5 sm:p-6"
    >
      <div aria-hidden className="pointer-events-none absolute -left-20 -top-20 h-48 w-48 rounded-full bg-primary/[0.08] blur-[80px]" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
            <span className="material-symbols-outlined text-2xl text-primary" aria-hidden>task_alt</span>
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-primary/70">Отчёт специалиста</p>
            <h2 id="report-ready-title" className="mt-0.5 font-headline text-lg font-bold text-on-surface">Ваш отчёт готов</h2>
            <p className="mt-0.5 line-clamp-2 break-words text-sm text-on-surface-variant">
              {report.title} · <span className="font-mono text-on-surface">{stamp}</span> · опубликован {fmtDate(report.published_at)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          <Link
            href={REPORT_SECTION_HREF}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-base" aria-hidden>description</span>
            Открыть отчёт
          </Link>
          <a
            href={`/api/v1/reports/${encodeURIComponent(report.id)}/pdf`}
            download
            aria-label={`Скачать PDF: ${stamp}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:border-white/20 hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-base" aria-hidden>download</span>
            Скачать PDF
          </a>
        </div>
      </div>
    </section>
  )
}
