'use client'

/**
 * PublishedReports — the client's published report on the Point A page.
 *
 * Data: GET /api/v1/reports (published versions of the caller's company, RLS)
 * and GET /api/v1/reports/:id for the frozen snapshot; the PDF is
 * GET /api/v1/reports/:id/pdf. Only versions a specialist published appear
 * here — drafts and model output that nobody checked never do. Every finding
 * and recommendation carries its provenance badge (ProvenanceBadge) with the
 * confidence and the producer.
 *
 * Split: <PublishedReports/> (fetching) and <ReportDetails/> /
 * <ReportSummaryCard/> (stateless views).
 */
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { ProvenanceBadge } from '@/components/common/ProvenanceBadge'
import { producerLabel, SEVERITY_LABELS, type ReportContent, type ReportSeverity } from '@/lib/reports/types'
import type { ClientReport, ClientReportSummary } from '@/lib/reports/client-access'

const CARD = 'rounded-2xl border border-white/[0.04] bg-surface-container p-4 sm:p-5'
const EYEBROW = 'text-xs font-mono text-primary/70 uppercase tracking-[0.2em]'
const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 rounded-xl bg-primary text-on-primary text-xs font-semibold px-3.5 py-2 transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40'
const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-xl border border-white/10 text-on-surface-variant text-xs font-medium px-3.5 py-2 transition-colors hover:text-on-surface hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-primary/40'

function Icon({ name, className }: { name: string; className?: string }) {
  return <span className={cn('material-symbols-outlined', className)} aria-hidden="true">{name}</span>
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'text-error border-error/30 bg-error/10',
  high: 'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10',
}

// ─── Views ──────────────────────────────────────────────────────────────────

export function ReportSummaryCard({ report, open, onToggle }: { report: ClientReportSummary; open: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-headline text-base font-bold text-on-surface">{report.title}</p>
        <p className="mt-1 text-xs text-on-surface-variant">
          Версия {report.version} · опубликован {fmtDate(report.published_at)} · расчёт от {fmtDate(report.calculated_at)}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">
          Выводов: <span className="font-mono text-on-surface">{report.findings}</span> · рекомендаций:{' '}
          <span className="font-mono text-on-surface">{report.recommendations}</span> · полнота данных:{' '}
          <span className="font-mono text-on-surface">{pct(report.confidence)}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={`/api/v1/reports/${report.id}/pdf`} className={BTN_PRIMARY} download>
          <Icon name="download" className="text-[16px]" /> Скачать PDF
        </a>
        <button type="button" onClick={onToggle} aria-expanded={open} className={BTN_GHOST}>
          <Icon name={open ? 'expand_less' : 'expand_more'} className="text-[16px]" /> {open ? 'Скрыть' : 'Открыть отчёт'}
        </button>
      </div>
    </div>
  )
}

export function ReportDetails({ content }: { content: ReportContent }) {
  const titles = new Map(content.findings.map((f) => [f.id, f.title]))
  return (
    <div className="mt-5 space-y-6 border-t border-white/[0.06] pt-5">
      {content.narrative && (
        <section aria-label="Резюме">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-bold text-on-surface">Резюме</h3>
            <ProvenanceBadge type="AI_HYPOTHESIS" source={content.narrative.model} />
          </div>
          <p className="text-sm leading-relaxed text-on-surface-variant">{content.narrative.summary}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-on-surface-variant">
            {content.narrative.key_points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </section>
      )}

      <section aria-label="Выводы диагностики">
        <h3 className="mb-3 text-sm font-bold text-on-surface">Выводы диагностики</h3>
        {content.findings.length === 0 ? (
          <p className="text-sm text-on-surface-variant">В этой версии выводов нет.</p>
        ) : (
          <ul className="space-y-2.5">
            {content.findings.map((f) => (
              <li key={f.id} className="rounded-xl border border-white/[0.05] bg-surface-container-low p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ProvenanceBadge type={f.provenance_type} confidence={f.confidence} source={producerLabel(f.source)} />
                  <span className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-on-surface-variant border-white/10', SEVERITY_CLASS[f.severity])}>
                    {SEVERITY_LABELS[f.severity as ReportSeverity] ?? f.severity}
                  </span>
                  <span className="text-[11px] text-on-surface-variant">{f.area_label}</span>
                </div>
                <p className="mt-1.5 text-sm font-medium text-on-surface">{f.title}</p>
                {f.body && <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{f.body}</p>}
                <p className="mt-1 text-[11px] text-on-surface-variant/70">
                  Источник: {producerLabel(f.source)}{f.evidence.length ? ` · оснований: ${f.evidence.length}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Рекомендации">
        <h3 className="mb-3 text-sm font-bold text-on-surface">Рекомендации</h3>
        {content.recommendations.length === 0 ? (
          <p className="text-sm text-on-surface-variant">В этой версии рекомендаций нет.</p>
        ) : (
          <ul className="space-y-2.5">
            {content.recommendations.map((r) => (
              <li key={r.id} className="rounded-xl border border-white/[0.05] bg-surface-container-low p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ProvenanceBadge type={r.provenance_type} confidence={r.confidence} source={producerLabel(r.source)} />
                  <span className="text-[11px] text-on-surface-variant">
                    приоритет {r.priority}{r.horizon_days ? ` · ${r.horizon_days} дней` : ''} · {r.area_label}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium text-on-surface">{r.title}</p>
                {r.body && <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{r.body}</p>}
                {r.expected_impact && <p className="mt-1 text-xs text-primary/80">Ожидаемый эффект: {r.expected_impact}</p>}
                {r.finding_ids.length > 0 && (
                  <p className="mt-1 text-[11px] text-on-surface-variant/70">
                    Закрывает: {r.finding_ids.map((id) => titles.get(id)).filter(Boolean).join('; ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Источники данных">
        <h3 className="mb-2 text-sm font-bold text-on-surface">Источники данных</h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {content.sources.map((s) => (
            <div key={s.kind} className="flex justify-between gap-3 border-b border-white/[0.04] pb-1">
              <dt className="text-on-surface-variant">{s.label}</dt>
              <dd className="text-right font-mono text-on-surface">{s.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] text-on-surface-variant/70">Отчёт сформирован {fmtDate(content.generated_at)}. Данные зафиксированы на эту дату и не меняются.</p>
      </section>
    </div>
  )
}

// ─── Container ──────────────────────────────────────────────────────────────

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'no_company' }
  | { kind: 'ready'; items: ClientReportSummary[] }

export default function PublishedReports() {
  const [list, setList] = useState<ListState>({ kind: 'loading' })
  const [openId, setOpenId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, ClientReport | { error: string }>>({})

  const load = useCallback(async () => {
    setList({ kind: 'loading' })
    try {
      const res = await fetch('/api/v1/reports', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (res.status === 404 && body?.error === 'no_company') return setList({ kind: 'no_company' })
      if (!res.ok || !body?.ok) return setList({ kind: 'error', message: body?.error ?? `Ошибка сервера (${res.status})` })
      setList({ kind: 'ready', items: body.data.items as ClientReportSummary[] })
    } catch {
      setList({ kind: 'error', message: 'Нет связи с сервером' })
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggle = async (id: string) => {
    if (openId === id) return setOpenId(null)
    setOpenId(id)
    if (details[id] && !('error' in details[id])) return
    try {
      const res = await fetch(`/api/v1/reports/${id}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      setDetails((d) => ({ ...d, [id]: res.ok && body?.ok ? (body.data as ClientReport) : { error: body?.error ?? `Ошибка сервера (${res.status})` } }))
    } catch {
      setDetails((d) => ({ ...d, [id]: { error: 'Нет связи с сервером' } }))
    }
  }

  if (list.kind === 'no_company') return null

  return (
    <section id="reports" aria-label="Отчёт по Точке А" className={CARD}>
      <p className={cn(EYEBROW, 'mb-2')}>Отчёт специалиста</p>
      <h2 className="font-headline text-lg font-bold text-on-surface">Отчёт по Точке А</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-on-surface-variant">
        Версия диагностики, которую проверил специалист AIStart360. У каждого вывода — пометка происхождения: факт, расчёт,
        вывод по правилам, гипотеза ИИ (только проверенные) или рекомендация.
      </p>

      <div className="mt-4">
        {list.kind === 'loading' && <div className="h-16 animate-pulse rounded-xl bg-surface-container-high/60" aria-label="Загрузка отчёта" />}
        {list.kind === 'error' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-xs text-error">
            <span>Не удалось загрузить отчёт: {list.message}</span>
            <button type="button" onClick={() => void load()} className={BTN_GHOST}>Повторить</button>
          </div>
        )}
        {list.kind === 'ready' && list.items.length === 0 && (
          <p className="rounded-xl border border-white/[0.05] bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            Отчёт ещё не опубликован. Когда специалист проверит результаты диагностики, здесь появится отчёт и PDF для скачивания.
          </p>
        )}
        {list.kind === 'ready' && list.items.map((r) => {
          const d = details[r.id]
          return (
            <div key={r.id} className="rounded-xl border border-white/[0.05] bg-surface-container-low p-4">
              <ReportSummaryCard report={r} open={openId === r.id} onToggle={() => void toggle(r.id)} />
              {openId === r.id && !d && <div className="mt-4 h-24 animate-pulse rounded-xl bg-surface-container-high/60" />}
              {openId === r.id && d && 'error' in d && <p role="alert" className="mt-4 text-xs text-error">Не удалось открыть отчёт: {d.error}</p>}
              {openId === r.id && d && !('error' in d) && <ReportDetails content={d.content} />}
            </div>
          )
        })}
      </div>
    </section>
  )
}
