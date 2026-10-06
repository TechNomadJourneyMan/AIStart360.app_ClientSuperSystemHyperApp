export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireExpert } from '@/lib/expert-auth'
import { listPublishedReportsForExpert, REPORT_TYPE_LABELS, type ExpertReportItem } from '@/lib/reports/expert-list'
import { BUSINESS_TIME_ZONE } from '@/lib/format/period'
import { REPORT_TYPES, type ReportType } from '@/lib/reports/types'
import { listReportVersions } from '@/lib/reports/versions'
import { versionStamp } from '@/lib/reports/version-stamp'
import { ExpertReviewQueue, type ExpertReviewItem } from '@/components/expert/ExpertReviewQueue'

export const metadata: Metadata = { title: 'Отчёты · Expert Portal' }

/**
 * Expert reports:
 *   • «На проверке» — versions the report agent built after an AI diagnostic
 *     (status 'in_review', migration 103): PDF of exactly that version and the
 *     decision — «Подтвердить и опубликовать» (the client sees it at once) or
 *     «Нужны правки» (comment → the agent rebuilds). components/expert/
 *     ExpertReviewQueue.tsx → POST /api/expert/reports/:id/review.
 *   • Published versions the expert may read — lib/reports/expert-list.ts
 *     (PDF: GET /api/v1/reports/:id/pdf, same access check).
 */

async function loadReviewQueue(): Promise<{ ok: true; items: ExpertReviewItem[] } | { ok: false }> {
  try {
    const rows = await listReportVersions({ status: 'in_review', limit: 100 })
    return {
      ok: true,
      items: rows.filter((v) => v.status === 'in_review').map((v) => ({
        id: v.id,
        company_id: v.company_id,
        company_name: v.company_name,
        title: v.title,
        stamp: versionStamp(v.version, v.created_at),
        findings: v.findings,
        recommendations: v.recommendations,
      })),
    }
  } catch {
    return { ok: false }
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { timeZone: BUSINESS_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' })
}

function Notice({ icon, title, text, tone = 'muted' }: { icon: string; title: string; text: string; tone?: 'muted' | 'error' }) {
  return (
    <div
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] text-center py-16 px-8"
      role={tone === 'error' ? 'alert' : undefined}
    >
      <span
        className={`material-symbols-outlined text-4xl block mb-3 ${tone === 'error' ? 'text-error/60' : 'text-on-surface-variant/20'}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-on-surface mb-1">{title}</p>
      <p className="text-xs text-on-surface-variant max-w-sm mx-auto leading-relaxed">{text}</p>
    </div>
  )
}

function ReportsTable({ items }: { items: ExpertReportItem[] }) {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/[0.04]">
            {['Отчёт', 'Клиент', 'Тип', 'Опубликован', 'Уверенность', ''].map((h) => (
              <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-5 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10">
                    <span className="material-symbols-outlined text-base text-primary" aria-hidden="true">description</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface">{r.title}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant">версия {r.version}</p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-3.5 text-sm text-on-surface-variant">{r.company_name ?? '—'}</td>
              <td className="px-5 py-3.5">
                <span className="text-xs font-mono bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-md whitespace-nowrap">
                  {REPORT_TYPE_LABELS[r.report_type]}
                </span>
              </td>
              <td className="px-5 py-3.5 text-sm text-on-surface-variant whitespace-nowrap">{formatDate(r.published_at)}</td>
              <td className="px-5 py-3.5 text-sm font-mono text-on-surface-variant">
                {r.confidence !== null ? `${Math.round(r.confidence * 100)}%` : '—'}
              </td>
              <td className="px-5 py-3.5">
                <a
                  href={`/api/v1/reports/${r.id}/pdf`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                  aria-label={`Скачать PDF: ${r.title}, версия ${r.version}`}
                >
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">download</span>
                  PDF
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function ExpertReportsPage({ searchParams }: { searchParams?: { type?: string; review?: string } }) {
  const viewer = await requireExpert()
  const result = viewer
    ? await listPublishedReportsForExpert(await createClient(), viewer)
    : ({ ok: false, reason: 'forbidden' } as const)
  // Only after the expert gate (role, approval, 2FA): versions waiting for review are never shown otherwise.
  const queue = viewer ? await loadReviewQueue() : null
  const focusId = typeof searchParams?.review === 'string' ? searchParams.review : null

  const items = result.ok ? result.items : []
  const present = REPORT_TYPES.filter((t) => items.some((r) => r.report_type === t))
  const selected = (REPORT_TYPES as readonly string[]).includes(searchParams?.type ?? '')
    ? (searchParams?.type as ReportType)
    : null
  const filtered = selected ? items.filter((r) => r.report_type === selected) : items

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Expert Portal</p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Отчёты</h1>
        <p className="text-on-surface-variant mt-2 text-sm">
          Отчёты собирает ИИ-диагностика. Новая версия приходит вам на проверку: «Подтвердить» сразу публикует её клиенту.
        </p>
      </section>

      {queue && (
        <section aria-labelledby="review-heading">
          <h2 id="review-heading" className="font-headline text-lg font-bold text-on-surface mb-1">На проверке</h2>
          <p className="text-xs text-on-surface-variant mb-4">
            Клиент не видит эти версии, пока вы не подтвердите. PDF — с номером версии, датой и пометкой «На проверке эксперта».
          </p>
          {!queue.ok && <Notice icon="error" title="Не удалось загрузить отчёты на проверке" text="Попробуйте обновить страницу." tone="error" />}
          {queue.ok && queue.items.length === 0 && (
            <Notice icon="task_alt" title="Нет отчётов на проверке" text="Когда диагностика соберёт новую версию отчёта, она появится здесь и в боте экспертов." />
          )}
          {queue.ok && queue.items.length > 0 && <ExpertReviewQueue items={queue.items} focusId={focusId} />}
        </section>
      )}

      <section>
        {result.ok && items.length > 0 && (
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <h2 className="font-headline text-lg font-bold text-on-surface">Опубликованные отчёты</h2>
            {present.length > 1 && (
              <nav className="flex gap-2 flex-wrap" aria-label="Фильтр по типу отчёта">
                {[null, ...present].map((t) => {
                  const active = t === selected
                  return (
                    <Link
                      key={t ?? 'all'}
                      href={t ? `/expert/reports?type=${t}` : '/expert/reports'}
                      aria-current={active ? 'page' : undefined}
                      className={`text-xs font-mono px-3 py-1.5 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                        active ? 'bg-primary/10 text-primary border-primary/20' : 'text-on-surface-variant border-white/[0.06] hover:border-white/[0.12] hover:text-on-surface'
                      }`}
                    >
                      {t ? REPORT_TYPE_LABELS[t] : 'Все'}
                    </Link>
                  )
                })}
              </nav>
            )}
          </div>
        )}

        {!result.ok && result.reason === 'forbidden' && (
          <Notice icon="lock" title="Нет доступа" text="Раздел доступен экспертам и администраторам платформы." tone="error" />
        )}
        {!result.ok && result.reason === 'db' && (
          <Notice icon="error" title="Не удалось загрузить отчёты" text="Попробуйте обновить страницу." tone="error" />
        )}
        {result.ok && items.length === 0 && (
          <Notice
            icon="description"
            title="Отчёты появятся после публикации"
            text="Здесь будут версии отчётов клиентов после подтверждения экспертом."
          />
        )}
        {result.ok && items.length > 0 && (
          filtered.length > 0
            ? <ReportsTable items={filtered} />
            : <Notice icon="filter_alt_off" title="Отчётов этого типа нет" text="Выберите другой тип или «Все»." />
        )}
      </section>
    </div>
  )
}
