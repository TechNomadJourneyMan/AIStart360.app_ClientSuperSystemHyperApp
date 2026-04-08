'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import type { PointB } from '@/types/point-b'

const BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы', sales: 'Продажи', operations: 'Операции',
  marketing: 'Маркетинг', strategy: 'Стратегия',
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Критично' },
  high:     { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Высокий' },
  medium:   { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Средний' },
  low:      { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Низкий' },
}

export default function ClientPointBPage() {
  const [pointB, setPointB] = useState<PointB | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user?.id) setUserId(data.session.user.id)
    })
  }, [])

  const loadData = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/diagnostics/point-b?user_id=${userId}`)
      const data = await res.json()
      if (data.ok) setPointB(data.data)
    } catch {}
    setLoading(false)
  }, [userId])

  useEffect(() => { if (userId) loadData() }, [userId, loadData])

  const scoreColor = (s: number) => s >= 70 ? '#6effc0' : s >= 40 ? '#fbbf24' : '#ef4444'

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      <header className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Image src="/logo.svg" alt="AIStart360" width={120} height={22} />
          <div className="flex items-center gap-3">
            <Link href="/client/point-a" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">arrow_back</span>Точка A
            </Link>
            <Link href="/client/dashboard" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">dashboard</span>Дашборд
            </Link>
            <button onClick={async () => { const sb = createClient(); await sb.auth.signOut(); window.location.href = '/login' }}
              className="flex items-center gap-1.5 text-xs font-mono text-red-400/70 hover:text-red-400 border border-red-500/10 rounded-lg px-3 py-1.5 transition-all">
              <span className="material-symbols-outlined text-sm">logout</span>Выход
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : !pointB ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-3xl text-primary">flag</span>
            </div>
            <h2 className="font-headline text-xl font-bold text-on-surface mb-2">Точка Б не рассчитана</h2>
            <p className="text-sm text-on-surface-variant mb-6">Сначала заполните анкету и рассчитайте Точку А</p>
            <Link href="/client/onboarding" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm">
              Заполнить анкету
            </Link>
          </div>
        ) : (
          <>
            {/* Hero */}
            <section>
              <p className="text-xs font-mono text-violet-400 uppercase tracking-[0.2em] mb-2">Точка Б · Целевое состояние</p>
              <h1 className="font-headline text-2xl font-extrabold text-on-surface mb-1">
                Куда вы идёте за <span className="text-violet-400">{pointB.horizon_months} месяцев</span>
              </h1>
              {pointB.user_goals.goal_12months && (
                <p className="text-sm text-on-surface-variant mt-2 italic">"{pointB.user_goals.goal_12months}"</p>
              )}
            </section>

            {/* Target KPIs */}
            <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {pointB.target_kpis.map(kpi => (
                <div key={kpi.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">{kpi.label}</p>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-sm text-on-surface-variant line-through">{kpi.current}</span>
                    <span className="material-symbols-outlined text-xs text-violet-400">arrow_forward</span>
                    <span className="text-xl font-mono font-bold text-violet-400">{kpi.target}</span>
                  </div>
                  <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500 transition-all duration-1000" style={{ width: `${kpi.progress}%` }} />
                  </div>
                </div>
              ))}
            </section>

            {/* GAP Analysis */}
            <section>
              <h2 className="font-headline text-lg font-bold text-on-surface mb-4">GAP-анализ</h2>
              <div className="space-y-3">
                {pointB.gap_analysis.map(gap => {
                  const p = PRIORITY_COLORS[gap.priority]
                  return (
                    <div key={gap.block} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-on-surface">{gap.label}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${p.bg} ${p.text}`}>{p.label}</span>
                          <span className="text-[10px] text-on-surface-variant">{gap.effort}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-on-surface-variant w-8">{gap.current}</span>
                        <div className="flex-1 h-2 bg-surface-container rounded-full overflow-hidden relative">
                          <div className="absolute h-full rounded-full bg-on-surface-variant/20" style={{ width: `${gap.target}%` }} />
                          <div className="absolute h-full rounded-full transition-all duration-1000" style={{ width: `${gap.current}%`, background: scoreColor(gap.current) }} />
                        </div>
                        <span className="text-xs font-mono text-violet-400 w-8">{gap.target}</span>
                        <span className={`text-xs font-mono font-bold ${p.text}`}>+{gap.gap}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Roadmap */}
            <section>
              <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Дорожная карта</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {pointB.roadmap.map((q, i) => (
                  <div key={q.quarter} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 relative">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-mono font-bold text-violet-400 bg-violet-500/15 px-2 py-0.5 rounded">{q.quarter}</span>
                      <span className="text-[10px] text-on-surface-variant">+{q.expected_improvement} баллов</span>
                    </div>
                    <h3 className="text-sm font-bold text-on-surface mb-3">{q.title}</h3>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {q.focus_blocks.map(b => (
                        <span key={b} className="text-[9px] bg-white/[0.05] text-on-surface-variant px-1.5 py-0.5 rounded">{BLOCK_LABELS[b] ?? b}</span>
                      ))}
                    </div>
                    <ul className="space-y-1.5">
                      {q.milestones.map((m, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-xs text-on-surface-variant">
                          <span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">check_circle</span>
                          {m}
                        </li>
                      ))}
                    </ul>
                    {i < 3 && (
                      <div className="hidden md:block absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 z-10">
                        <span className="material-symbols-outlined text-lg text-white/10">arrow_forward</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Growth blockers */}
            {pointB.user_goals.growth_blockers.length > 0 && (
              <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5">
                <h2 className="text-sm font-bold text-on-surface mb-3">Барьеры роста (из анкеты)</h2>
                <div className="flex flex-wrap gap-2">
                  {pointB.user_goals.growth_blockers.map(b => (
                    <span key={b} className="text-xs bg-red-500/10 text-red-400 border border-red-500/15 px-3 py-1.5 rounded-lg">{b}</span>
                  ))}
                </div>
              </section>
            )}

            {/* Navigation */}
            <section className="grid grid-cols-3 gap-3">
              <Link href="/client/point-a" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">assessment</span>
                <div><p className="text-xs font-medium text-on-surface group-hover:text-primary">Точка А</p><p className="text-[10px] text-on-surface-variant">Текущее состояние</p></div>
              </Link>
              <Link href="/client/onboarding" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">edit_note</span>
                <div><p className="text-xs font-medium text-on-surface group-hover:text-primary">Обновить анкету</p><p className="text-[10px] text-on-surface-variant">Пересчитать цели</p></div>
              </Link>
              <Link href="/client/dashboard" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">dashboard</span>
                <div><p className="text-xs font-medium text-on-surface group-hover:text-primary">Дашборд</p><p className="text-[10px] text-on-surface-variant">Обзор показателей</p></div>
              </Link>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
