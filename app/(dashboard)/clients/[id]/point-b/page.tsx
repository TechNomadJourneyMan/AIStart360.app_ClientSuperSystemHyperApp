'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type PointBData = Record<string, any>

export default function ClientPointBPage() {
  const params = useParams()
  const [data, setData] = useState<PointBData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/clients/${params.id}/analysis/point-b`)
        if (!res.ok) throw new Error('Failed to fetch Point B data')
        const json = await res.json()
        setData(json)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [params.id])

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest animate-pulse">
          Calculating Target State...
        </p>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-8">
      <div className="w-20 h-20 rounded-3xl bg-error/10 flex items-center justify-center mb-6 border border-error/10">
        <span className="material-symbols-outlined text-4xl text-error">warning</span>
      </div>
      <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">Ошибка анализа</h1>
      <p className="text-on-surface-variant text-sm mb-8 max-w-sm">{error || 'Не удалось загрузить данные'}</p>
      <Link href={`/clients/${params.id}`} className="px-6 py-3 bg-primary text-on-primary rounded-xl font-bold">
        Вернуться назад
      </Link>
    </div>
  )

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <section>
        <nav className="flex items-center gap-2 text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">
          <Link href="/clients" className="hover:text-primary transition-colors">Клиенты</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <Link href={`/clients/${params.id}`} className="hover:text-primary transition-colors">Client Profile</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <span className="text-on-surface font-bold">Point B</span>
        </nav>
        
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
          Стратегия роста · Горизонт ${data.horizon_months || 12} месяцев
        </p>
        <h1 className="font-headline text-4xl font-extrabold text-on-surface">
          Точка <span className="text-gradient">Б</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
          Проекция целевого состояния бизнеса на основе текущих данных и стратегических целей. 
          Этот мост построен ИИ-агентом AIStart360.
        </p>
      </section>

      {/* Target KPIs */}
      <section>
        <div className="flex items-center gap-3 mb-6">
           <h2 className="font-headline text-lg font-bold text-on-surface">Целевые показатели</h2>
           <div className="h-px flex-1 bg-outline-variant/10" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(data.targets ?? []).map((target: any) => (
            <div key={target.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 group hover:border-primary/20 transition-all">
              <div className="flex items-start justify-between mb-3">
                <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">{target.label}</p>
                <span className="material-symbols-outlined text-base text-primary/40 group-hover:text-primary transition-colors">{target.icon}</span>
              </div>
              <div className="flex items-end gap-2 mb-3">
                <span className="text-xl font-mono font-bold text-primary">{target.value}</span>
                <span className="text-[10px] text-on-surface-variant font-mono pb-1 opacity-70">цель</span>
              </div>
              <div className="flex items-center justify-between text-[10px] mb-2 font-mono">
                <span className="text-on-surface-variant">{target.current} сейчас</span>
                <span className="text-primary">{target.pct}%</span>
              </div>
              <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-primary-fixed-dim rounded-full transition-all duration-700"
                  style={{ width: `${target.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Roadmap */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-center gap-3 mb-2">
             <h2 className="font-headline text-lg font-bold text-on-surface">Дорожная карта</h2>
             <div className="h-px flex-1 bg-outline-variant/10" />
          </div>
          <div className="relative pl-12 space-y-8">
            <div className="absolute left-[20px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-primary via-primary/20 to-transparent rounded-full" />
            {(data.milestones ?? []).map((m: any, i: number) => (
              <div key={i} className="relative">
                {/* Connector Dot */}
                <div className={`
                  absolute -left-[32px] top-4 w-5 h-5 rounded-full flex items-center justify-center -translate-x-1/2 z-10
                  ${m.status === 'current' ? 'bg-primary ring-8 ring-primary/10' : m.status === 'planned' ? 'bg-surface-container-high border-2 border-primary/40' : 'bg-surface-container-high border-2 border-white/10'}
                `}>
                  {m.status === 'current' && <span className="w-2.5 h-2.5 rounded-full bg-on-primary" />}
                </div>

                <div className={`
                  bg-surface-container-low rounded-2xl border p-5 transition-all
                  ${m.status === 'current' ? 'border-primary/30 bg-primary/[0.04] shadow-primary-sm' : 'border-white/[0.04] hover:border-white/[0.1]'}
                `}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span className={`text-[10px] font-mono uppercase tracking-widest ${m.status === 'current' ? 'text-primary' : 'text-on-surface-variant'}`}>
                        {m.q} {m.status === 'current' ? '· В процессе' : ''}
                      </span>
                      <h3 className="text-base font-bold text-on-surface mt-1">{m.title}</h3>
                    </div>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${m.status === 'current' ? 'bg-primary/20 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                      <span className="material-symbols-outlined">{m.icon}</span>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{m.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Gap Analysis */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center gap-3 mb-2">
             <h2 className="font-headline text-lg font-bold text-on-surface">Gap-анализ</h2>
             <div className="h-px flex-1 bg-outline-variant/10" />
          </div>
          <div className="space-y-4">
            {(data.gap_analysis ?? []).map((item: any, idx: number) => (
              <div key={idx} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:border-primary/20 transition-all group">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-${item.color}/10 border border-${item.color}/20`}>
                    <span className={`material-symbols-outlined text-${item.color}`}>{item.icon}</span>
                  </div>
                  <div>
                    <span className={`text-[9px] font-mono text-${item.color} uppercase tracking-widest font-bold`}>{item.label}</span>
                    <h3 className="text-sm font-bold text-on-surface">{item.title}</h3>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="bg-error/5 rounded-xl p-3 border border-error/10">
                    <p className="text-[9px] font-mono uppercase text-error mb-1 opacity-70">Разрыв</p>
                    <p className="text-xs text-on-surface">{item.gap}</p>
                  </div>
                  <div className="bg-primary/5 rounded-xl p-3 border border-primary/10">
                    <p className="text-[9px] font-mono uppercase text-primary mb-1 opacity-70">Действие</p>
                    <p className="text-xs text-on-surface font-medium">{item.action}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          <div className="bg-gradient-to-br from-primary to-primary-fixed-dim rounded-3xl p-8 text-on-primary">
            <h4 className="font-headline font-bold text-lg mb-3">Готовы к масштабированию?</h4>
            <p className="text-xs opacity-90 leading-relaxed mb-6">
              Мы подготовили подробный план действий для достижения ваших целей. 
              Запишитесь на стратегическую сессию с экспертом.
            </p>
            <button className="w-full py-3 bg-white text-primary rounded-xl font-bold text-sm shadow-xl hover:scale-[0.98] transition-all">
              Записаться на сессию
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
