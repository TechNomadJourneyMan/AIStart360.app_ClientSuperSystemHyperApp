'use client'

// GRI block of the user dashboard: status, progress and key numbers. The test
// itself lives in the GRI mega-section (/gri, inside the portal shell with all
// its tabs) — the buttons navigate there. Nothing here is lazy-loaded, so a
// failed chunk can never take the whole dashboard down.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { AssessmentCurrent } from '@/lib/gri-assessment/types'
import { GRI_SECTIONS, GRI_CRITERIA_COUNT } from '@/lib/gri-assessment/sections'
import { GRI_BLOCK_RU } from '@/lib/gri-assessment/labels'
import { scoresFingerprint, type GriScores } from '@/lib/gri-assessment/score'

const GRI_TARGET = 8.5
const tone = (v: number) => (v >= 7 ? 'bg-primary/80 text-primary' : v >= 4 ? 'bg-amber-400/80 text-amber-300' : 'bg-red-400/80 text-red-400')
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

interface DraftInfo { blocksStarted: number; updatedAt: string }

export default function GriSection() {
  const [assessment, setAssessment] = useState<AssessmentCurrent | null>(null)
  const [draft, setDraft] = useState<DraftInfo | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    try {
      const [curRes, draftRes] = await Promise.all([
        fetch('/api/v1/gri/assessment', { credentials: 'include' }),
        fetch('/api/v1/gri/draft', { credentials: 'include' }).catch(() => null),
      ])
      if (!curRes.ok) throw new Error(String(curRes.status))
      const cur = (await curRes.json())?.data?.current ?? null
      setAssessment(cur && typeof cur.gri_index !== 'undefined' ? (cur as AssessmentCurrent) : null)

      const d = draftRes?.ok ? (await draftRes.json())?.data?.draft : null
      const scores = (d?.state?.scores ?? null) as GriScores | null
      // A draft equal to the stored result is not «unfinished work».
      const unfinished = scores && scoresFingerprint(scores) && scoresFingerprint(scores) !== scoresFingerprint((cur?.scores ?? null) as GriScores | null)
      setDraft(unfinished ? { blocksStarted: Object.values(scores).filter((c) => c && Object.values(c).some((v) => Number(v) > 0)).length, updatedAt: d.updated_at } : null)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const blocksDone = assessment ? GRI_SECTIONS.filter((s) => Number(assessment.section_avgs?.[s.id]) > 0).length : 0
  const index = assessment ? Number(assessment.gri_index) : null
  const primary = draft
    ? { href: '/gri?tab=assess', icon: 'play_arrow', label: 'Продолжить GRI Assessment' }
    : assessment
      ? { href: '/gri?tab=result', icon: 'insights', label: 'Открыть результат' }
      : { href: '/gri?tab=assess', icon: 'play_arrow', label: 'Пройти GRI Assessment' }

  return (
    <section id="gri" className="scroll-mt-20" aria-labelledby="gri-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="gri-title" className="text-sm font-semibold text-on-surface">GRI Assessment</h2>
        <span className="text-[11px] text-on-surface-variant">Growth Readiness Index · 7 блоков · {GRI_CRITERIA_COUNT} критериев</span>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-primary/[0.07] blur-[90px]" />

        {state === 'loading' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" aria-busy="true">
            <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
            <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="material-symbols-outlined text-xl text-error" aria-hidden>cloud_off</span>
            <p className="min-w-0 flex-1 text-sm text-on-surface-variant">Не удалось загрузить статус GRI.</p>
            <button type="button" onClick={() => { setState('loading'); void load() }} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-on-surface hover:bg-white/[0.05]">Повторить</button>
            <Link href="/gri" className="rounded-xl bg-gradient-to-r from-primary to-[#00e29e] px-4 py-2 text-sm font-bold text-[#003824]">Открыть GRI</Link>
          </div>
        )}

        {state === 'ready' && (
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
            {/* Status + CTA */}
            <div>
              <span className={`inline-block rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                draft ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                  : assessment ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-white/10 bg-white/[0.04] text-on-surface-variant'
              }`}>
                {draft ? 'Диагностика не завершена' : assessment ? 'Диагностика пройдена' : 'Диагностика не пройдена'}
              </span>
              <div className="mt-3 flex items-end gap-3">
                <span className="text-5xl font-bold tabular-nums text-primary">{index == null ? '—' : index.toFixed(1)}</span>
                <span className="pb-1.5 text-sm text-on-surface-variant">/ цель {GRI_TARGET}+</span>
              </div>
              <p className="mt-2 max-w-sm text-xs leading-snug text-on-surface-variant">
                {draft
                  ? `Вы начали ${draft.blocksStarted} из ${GRI_SECTIONS.length} блоков ${fmtDate(draft.updatedAt)} — ответы сохранены, продолжите с того же места.`
                  : assessment
                    ? `Оценка от ${fmtDate(assessment.created_at)}. В результате — ТОП-5 ограничений роста и план на 90 дней.`
                    : 'Индекс готовности к росту по 7 зонам бизнеса, главные ограничения и пошаговый план. Около 15–20 минут, прогресс сохраняется.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={primary.href} className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] px-5 py-3 text-sm font-bold text-[#003824] transition-transform hover:scale-[0.99]">
                  <span className="material-symbols-outlined text-base" aria-hidden>{primary.icon}</span>
                  {primary.label}
                </Link>
                {assessment && !draft && (
                  <Link href="/gri?tab=assess" className="flex items-center rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-on-surface hover:bg-white/[0.05]">Пройти заново</Link>
                )}
                {assessment && (
                  <Link href="/gri?tab=dynamics" className="flex items-center rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-on-surface hover:bg-white/[0.05]">Динамика</Link>
                )}
              </div>
            </div>

            {/* Progress + key numbers per block */}
            <div>
              <div className="mb-2 flex items-baseline justify-between text-xs">
                <span className="text-on-surface-variant">Прогресс по блокам</span>
                <span className="font-mono text-on-surface">{blocksDone}/{GRI_SECTIONS.length}</span>
              </div>
              <ul className="space-y-2">
                {GRI_SECTIONS.map((sec) => {
                  const v = Number(assessment?.section_avgs?.[sec.id] ?? 0)
                  const [bar, text] = tone(v).split(' ')
                  return (
                    <li key={sec.id} className="flex items-center gap-3">
                      <span className="w-36 shrink-0 truncate text-xs text-on-surface-variant sm:w-52">{GRI_BLOCK_RU[sec.id]}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className={`h-full rounded-full ${v > 0 ? bar : ''}`} style={{ width: `${v * 10}%` }} />
                      </div>
                      <span className={`w-8 text-right font-mono text-xs font-semibold ${v > 0 ? text : 'text-on-surface-variant/50'}`}>{v > 0 ? v.toFixed(1) : '—'}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
