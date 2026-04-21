'use client'

// Clinic dashboard for the medical vertical — shows RFM segments, 9 bundles
// by priority, revenue-loss map, and download buttons for PDF + XLSX.
// Falls back to a "run audit" CTA if audit hasn't been executed yet.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import { ExpertCommentsSection } from '@/components/client/ExpertCommentsSection'
import { SEGMENT_LABELS, type PatientSegmentId } from '@/lib/rfm-segmentation'
import type { BundleKey } from '@/lib/clinic-bundles'
import type { LossKey, LossSeverity } from '@/lib/revenue-audit'

interface AuditResponse {
  ok: boolean
  totals: {
    total_patients: number
    total_ltv_kzt: number
    avg_check_kzt: number
    active_last_90d: number
    sleeping_180d_plus: number
    dead_leads: number
  }
  segments: Array<{
    segment: PatientSegmentId
    label: string
    count: number
    total_ltv_kzt: number
    avg_ltv_kzt: number
    avg_recency_days: number
    priority: number
  }>
  bundles: Array<{
    key: BundleKey
    label: string
    target_patient_count: number
    estimated_conversion: number
    estimated_revenue_kzt: number
    priority: number
    complexity: 'easy' | 'medium' | 'hard'
    effect_timeline: string
    trigger_description: string
    script_preview: string
    target_segments: PatientSegmentId[]
  }>
  audit: {
    total_loss_kzt: number
    narrative: string
    losses: Array<{
      key: LossKey
      label: string
      estimated_loss_kzt: number
      severity: LossSeverity
      source_data: string
      linked_bundle_key: BundleKey | null
    }>
  }
}

export default function MedicalDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadExisting = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Trigger audit endpoint — will use latest file automatically;
      // if no file exists yet, it returns 404 and we show "upload first".
      const res = await fetch('/api/medical/audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.status === 404) {
        setData(null)
      } else if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      } else {
        const body = (await res.json()) as AuditResponse
        setData(body)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { router.replace('/login'); return }
      if (!cancelled) await loadExisting()
    })()
    return () => { cancelled = true }
  }, [router, loadExisting])

  const bundleTotal = useMemo(
    () => (data?.bundles ?? []).reduce((s, b) => s + b.estimated_revenue_kzt, 0),
    [data],
  )

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">
              AI-усиление для клиник
            </p>
            <h1 className="text-xl font-headline font-bold text-on-surface mt-0.5">
              Кабинет клиники
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/settings/business-type"
              className="text-xs text-on-surface-variant hover:text-primary"
            >
              Настройки
            </Link>
            <button
              onClick={() => { setRunning(true); loadExisting() }}
              disabled={loading || running}
              className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[14px] ${loading || running ? 'animate-spin' : ''}`}>
                refresh
              </span>
              {running ? 'Считаем...' : 'Пересчитать'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {loading && !data && <LoadingSkeleton />}

        {!loading && !data && <EmptyState error={error} />}

        {data && (
          <>
            <KpiStrip totals={data.totals} totalLoss={data.audit.total_loss_kzt} />
            <DownloadActions />
            <SegmentsBlock segments={data.segments} />
            <LossesBlock losses={data.audit.losses} total={data.audit.total_loss_kzt} narrative={data.audit.narrative} />
            <BundlesBlock bundles={data.bundles} total={bundleTotal} />
            <ExpertCommentsSection />
          </>
        )}
      </main>
    </div>
  )
}

// ── KPI strip ────────────────────────────────────────────────────────────────

function KpiStrip({ totals, totalLoss }: { totals: AuditResponse['totals']; totalLoss: number }) {
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi label="Пациентов в базе" value={totals.total_patients.toLocaleString('ru-RU')} icon="group" />
      <Kpi label="Суммарный LTV" value={`${(totals.total_ltv_kzt / 1_000_000).toFixed(1)}M ₸`} icon="payments" />
      <Kpi label="Средний чек" value={`${totals.avg_check_kzt.toLocaleString('ru-RU')} ₸`} icon="monitoring" />
      <Kpi
        label="Оценка потерь/мес"
        value={`${(totalLoss / 1_000_000).toFixed(1)}M ₸`}
        icon="warning"
        tone="error"
      />
    </section>
  )
}

function Kpi({ label, value, icon, tone = 'default' }: { label: string; value: string; icon: string; tone?: 'default' | 'error' }) {
  const toneClass = tone === 'error' ? 'text-error' : 'text-on-surface'
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">{label}</span>
        <span className={`material-symbols-outlined text-base ${toneClass}`}>{icon}</span>
      </div>
      <p className={`text-2xl font-mono font-bold ${toneClass}`}>{value}</p>
    </div>
  )
}

// ── Download actions ────────────────────────────────────────────────────────

function DownloadActions() {
  return (
    <section className="flex flex-col md:flex-row gap-3">
      <DownloadCard
        title="Скачать PDF-стратегию"
        description="8-страничный документ с аудитом базы, картой потерь, 9 связками и планом на 30/60/90 дней"
        icon="picture_as_pdf"
        href="/api/medical/strategy/pdf"
      />
      <DownloadCard
        title="Скачать XLSX для обзвона"
        description="4 листа: обзор, список приоритизированных пациентов, скрипты по сегментам, инструкция оператору"
        icon="table_view"
        href="/api/medical/strategy/xlsx"
      />
    </section>
  )
}

function DownloadCard({ title, description, icon, href }: { title: string; description: string; icon: string; href: string }) {
  return (
    <a
      href={href}
      download
      className="flex-1 rounded-2xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-all p-5 flex items-start gap-4"
    >
      <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-primary text-2xl">{icon}</span>
      </div>
      <div className="min-w-0">
        <h3 className="font-headline text-base font-bold text-on-surface">{title}</h3>
        <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{description}</p>
        <span className="inline-flex items-center gap-1 text-xs text-primary font-medium mt-2">
          <span className="material-symbols-outlined text-sm">download</span>
          Скачать
        </span>
      </div>
    </a>
  )
}

// ── Segments block ──────────────────────────────────────────────────────────

const SEGMENT_COLOR: Record<PatientSegmentId, string> = {
  vip_retention:    'from-emerald-500/40 to-emerald-500/10',
  vip_reactivation: 'from-primary/40 to-primary/10',
  loyal_active:     'from-blue-500/40 to-blue-500/10',
  churn_risk:       'from-amber-500/40 to-amber-500/10',
  sleeping:         'from-violet-500/40 to-violet-500/10',
  one_time_fresh:   'from-cyan-500/40 to-cyan-500/10',
  one_time_old:     'from-rose-500/40 to-rose-500/10',
  dead_lead:        'from-gray-500/30 to-gray-500/5',
}

function SegmentsBlock({ segments }: { segments: AuditResponse['segments'] }) {
  const total = segments.reduce((s, x) => s + x.count, 0)
  return (
    <section>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="font-headline text-lg font-bold text-on-surface">RFM-сегментация базы</h2>
        <span className="text-xs text-on-surface-variant">8 групп по приоритету обзвона</span>
      </header>
      <div className="space-y-2">
        {segments.map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0
          return (
            <div key={s.segment} className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-on-surface-variant">S{s.priority}</span>
                  <span className="text-sm font-medium text-on-surface">{SEGMENT_LABELS[s.segment]}</span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono text-on-surface-variant">
                  <span>{s.count.toLocaleString('ru-RU')} чел.</span>
                  <span>{(s.total_ltv_kzt / 1_000_000).toFixed(1)}M ₸</span>
                  <span>~{s.avg_recency_days} дн</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${SEGMENT_COLOR[s.segment]} rounded-full`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Losses block ────────────────────────────────────────────────────────────

const LOSS_STYLE: Record<LossSeverity, { bg: string; text: string }> = {
  critical: { bg: 'bg-error/10 border-error/20',        text: 'text-error' },
  high:     { bg: 'bg-orange-500/10 border-orange-500/20', text: 'text-orange-300' },
  medium:   { bg: 'bg-amber-500/10 border-amber-500/20',  text: 'text-amber-300' },
  low:      { bg: 'bg-white/[0.04] border-white/[0.08]',  text: 'text-on-surface-variant' },
}

function LossesBlock({ losses, total, narrative }: { losses: AuditResponse['audit']['losses']; total: number; narrative: string }) {
  return (
    <section>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="font-headline text-lg font-bold text-on-surface">Карта потерь выручки</h2>
        <span className="text-xs text-on-surface-variant">~{(total / 1_000_000).toFixed(1)}M ₸/мес</span>
      </header>
      <p className="text-sm text-on-surface-variant mb-4">{narrative}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {losses.map((l) => {
          const s = LOSS_STYLE[l.severity]
          return (
            <div key={l.key} className={`rounded-xl border p-4 ${s.bg}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className={`text-sm font-medium ${s.text}`}>{l.label}</h3>
                <span className="text-sm font-mono font-bold text-on-surface whitespace-nowrap">
                  ~{(l.estimated_loss_kzt / 1_000_000).toFixed(1)}M ₸
                </span>
              </div>
              <p className="text-[11px] text-on-surface-variant font-mono">{l.source_data}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Bundles block ───────────────────────────────────────────────────────────

function BundlesBlock({ bundles, total }: { bundles: AuditResponse['bundles']; total: number }) {
  const [expandedKey, setExpandedKey] = useState<BundleKey | null>(null)
  return (
    <section>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="font-headline text-lg font-bold text-on-surface">9 связок роста</h2>
        <span className="text-xs text-primary font-medium">Потенциал: +{(total / 1_000_000).toFixed(1)}M ₸/мес</span>
      </header>
      <div className="space-y-2">
        {bundles.map((b) => {
          const open = expandedKey === b.key
          return (
            <div key={b.key} className="bg-surface-container-low rounded-xl border border-white/[0.06] overflow-hidden">
              <button
                onClick={() => setExpandedKey(open ? null : b.key)}
                className="w-full p-4 flex items-center justify-between gap-3 hover:bg-white/[0.02] text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono font-bold text-primary flex-shrink-0">#{b.priority}</span>
                  <span className="text-sm font-medium text-on-surface truncate">{b.label}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[10px] font-mono text-on-surface-variant">{b.effect_timeline}</span>
                  <span className="text-sm font-mono font-bold text-primary">
                    +{(b.estimated_revenue_kzt / 1_000_000).toFixed(2)}M ₸
                  </span>
                  <span className="material-symbols-outlined text-base text-on-surface-variant">
                    {open ? 'expand_less' : 'expand_more'}
                  </span>
                </div>
              </button>
              {open && (
                <div className="px-4 pb-4 border-t border-white/[0.04] space-y-2 pt-3">
                  <p className="text-xs text-on-surface-variant">
                    <span className="text-on-surface-variant/80">Целевые сегменты: </span>
                    {b.target_segments.map((s) => SEGMENT_LABELS[s]).join(', ')}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    <span className="text-on-surface-variant/80">Целевых пациентов: </span>
                    {b.target_patient_count.toLocaleString('ru-RU')}
                    <span className="text-on-surface-variant/80 ml-4">Конверсия: </span>{b.estimated_conversion}%
                    <span className="text-on-surface-variant/80 ml-4">Сложность: </span>{b.complexity}
                  </p>
                  <div className="rounded-lg bg-surface-container border border-white/[0.04] p-3 mt-2">
                    <p className="text-[11px] font-mono uppercase text-on-surface-variant mb-1">Триггер</p>
                    <p className="text-xs text-on-surface">{b.trigger_description}</p>
                  </div>
                  <div className="rounded-lg bg-surface-container border border-white/[0.04] p-3">
                    <p className="text-[11px] font-mono uppercase text-on-surface-variant mb-1">Скрипт (пример)</p>
                    <p className="text-xs text-on-surface italic">«{b.script_preview}»</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Empty state / skeleton ─────────────────────────────────────────────────

function EmptyState({ error }: { error: string | null }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] border-dashed bg-surface-container-low p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">
        upload_file
      </span>
      <h3 className="text-lg font-medium text-on-surface">Аудит ещё не проведён</h3>
      <p className="text-sm text-on-surface-variant mt-1 max-w-md mx-auto">
        Загрузите базу пациентов в анкете — система проанализирует её и построит
        8 сегментов, 9 связок роста и карту потерь выручки.
      </p>
      {error && <p className="text-xs text-error mt-3">Ошибка: {error}</p>}
      <Link
        href="/client/onboarding-medical"
        className="inline-flex items-center gap-2 rounded-xl bg-primary text-on-primary text-sm font-medium px-5 py-2.5 mt-5 hover:bg-primary/90"
      >
        <span className="material-symbols-outlined text-base">arrow_forward</span>
        К анкете
      </Link>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-surface-container animate-pulse" />
        ))}
      </div>
      <div className="h-32 rounded-2xl bg-surface-container animate-pulse" />
      <div className="h-96 rounded-2xl bg-surface-container animate-pulse" />
    </div>
  )
}
