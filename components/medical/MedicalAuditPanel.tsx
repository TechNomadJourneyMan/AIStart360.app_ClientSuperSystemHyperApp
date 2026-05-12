'use client'

/**
 * Reusable medical audit panel — extracts the RFM-segments / bundles /
 * losses / download-actions UI from /client/dashboard-medical so the
 * same content can also mount inside the main /dashboard for medical
 * clients without forcing them onto a separate page.
 *
 * Fetches via POST /api/medical/audit/run (idempotent — endpoint reads
 * persisted patient_segments / growth_bundles / revenue_losses if they
 * exist, otherwise recomputes from latest patient_base).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
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

const LOSS_STYLE: Record<LossSeverity, { bg: string; text: string }> = {
  critical: { bg: 'bg-error/10 border-error/20',           text: 'text-error' },
  high:     { bg: 'bg-orange-500/10 border-orange-500/20', text: 'text-orange-300' },
  medium:   { bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-300' },
  low:      { bg: 'bg-white/[0.04] border-white/[0.08]',   text: 'text-on-surface-variant' },
}

export function MedicalAuditPanel() {
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<BundleKey | null>(null)

  // Fast cached read — no recompute.
  const loadCached = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/medical/audit', { cache: 'no-store' })
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
    }
  }, [])

  // Full recompute — only on user click.
  const recompute = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
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
      setError(e instanceof Error ? e.message : 'Ошибка пересчёта')
    } finally {
      setRunning(false)
    }
  }, [])

  useEffect(() => { void loadCached() }, [loadCached])

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
        <p className="text-sm text-on-surface-variant mt-2">Считаем аудит клиники…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-white/[0.06] border-dashed bg-surface-container-low p-10 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">upload_file</span>
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

  const segments = data.segments
  const totalSeg = segments.reduce((s, x) => s + x.count, 0)
  const bundles = data.bundles
  const bundlesTotal = bundles.reduce((s, b) => s + b.estimated_revenue_kzt, 0)
  const losses = data.audit.losses

  return (
    <div className="space-y-6">
      {/* Header + recalculate */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em]">
          AI-аудит клиники
        </p>
        <button
          onClick={() => { void recompute() }}
          disabled={loading || running}
          className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-[14px] ${running ? 'animate-spin' : ''}`}>
            refresh
          </span>
          {running ? 'Пересчёт…' : 'Пересчитать'}
        </button>
      </div>

      {/* Downloads */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { title: 'PDF-стратегия', desc: '8-страничный документ с аудитом базы, картой потерь, 9 связками и планом', icon: 'picture_as_pdf', href: '/api/medical/strategy/pdf', dl: true },
          { title: 'XLSX для обзвона', desc: '4 листа: обзор, приоритизация, скрипты, инструкция оператору', icon: 'table_view', href: '/api/medical/strategy/xlsx', dl: true },
          { title: 'WhatsApp-сценарии', desc: 'Библиотека готовых шаблонов: cross-sell, upsell, поведенческие, сезонные', icon: 'chat', href: '/client/scenarios', dl: false },
        ].map((c) => (
          <a
            key={c.title}
            href={c.href}
            {...(c.dl ? { download: true } : {})}
            className="rounded-2xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-all p-5 flex items-start gap-4"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-primary text-2xl">{c.icon}</span>
            </div>
            <div className="min-w-0">
              <h3 className="font-headline text-base font-bold text-on-surface">{c.title}</h3>
              <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{c.desc}</p>
              <span className="inline-flex items-center gap-1 text-xs text-primary font-medium mt-2">
                <span className="material-symbols-outlined text-sm">{c.dl ? 'download' : 'arrow_forward'}</span>
                {c.dl ? 'Скачать' : 'Открыть'}
              </span>
            </div>
          </a>
        ))}
      </section>

      {/* RFM segments */}
      <section>
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="font-headline text-lg font-bold text-on-surface">RFM-сегментация базы</h2>
          <span className="text-xs text-on-surface-variant">8 групп по приоритету обзвона</span>
        </header>
        <div className="space-y-2">
          {segments.map((s) => {
            const pct = totalSeg > 0 ? (s.count / totalSeg) * 100 : 0
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

      {/* Losses */}
      <section>
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="font-headline text-lg font-bold text-on-surface">Карта потерь выручки</h2>
          <span className="text-xs text-on-surface-variant">~{(data.audit.total_loss_kzt / 1_000_000).toFixed(1)}M ₸/мес</span>
        </header>
        <p className="text-sm text-on-surface-variant mb-4">{data.audit.narrative}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {losses.map((l) => {
            const st = LOSS_STYLE[l.severity]
            return (
              <div key={l.key} className={`rounded-xl border p-4 ${st.bg}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className={`text-sm font-medium ${st.text}`}>{l.label}</h3>
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

      {/* Bundles */}
      <section>
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="font-headline text-lg font-bold text-on-surface">9 связок роста</h2>
          <span className="text-xs text-primary font-medium">Потенциал: +{(bundlesTotal / 1_000_000).toFixed(1)}M ₸/мес</span>
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
    </div>
  )
}
