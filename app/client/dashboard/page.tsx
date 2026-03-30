'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase-client'

const GRI_BLOCKS = [
  { label: 'Бизнес-модель',         score: 7.4,  icon: 'storefront'     },
  { label: 'Готовность основателя', score: 6.7,  icon: 'person_raised_hand' },
  { label: 'Доверие и позиция',     score: 5.2,  icon: 'verified'       },
  { label: 'Стабильность кассы',    score: 5.0,  icon: 'account_balance'},
  { label: 'Продукт и спрос',       score: 4.7,  icon: 'shopping_bag'   },
  { label: 'Команда',               score: 2.6,  icon: 'groups'         },
  { label: 'Операции',              score: 2.1,  icon: 'settings_suggest'},
]

const REPORTS = [
  { name: 'Аналитический профиль (Казахстан)', category: 'GRI',         icon: 'radar',       color: 'text-primary' },
  { name: 'OSINT Intelligence Report',         category: 'Intelligence', icon: 'manage_search', color: 'text-secondary' },
  { name: 'Модульный аналитический отчёт',     category: 'Strategic',   icon: 'bar_chart',   color: 'text-primary' },
  { name: 'GPT Intelligence Summary',          category: 'AI',          icon: 'smart_toy',   color: 'text-secondary' },
  { name: 'Протокол стратегии',                category: 'Protocol',    icon: 'description', color: 'text-on-surface-variant' },
]

const NEXT_STEPS = [
  { icon: 'event',        title: 'Сессия с экспертом',  desc: 'Разбор операционного блока',        color: 'text-secondary', bg: 'bg-secondary/10'   },
  { icon: 'description',  title: 'Скачать отчёт GRI',    desc: 'Полный анализ с планом действий',   color: 'text-primary',   bg: 'bg-primary/10'     },
  { icon: 'track_changes',title: 'План на 90 дней',      desc: 'Приоритетные шаги для роста',       color: 'text-amber-400', bg: 'bg-amber-400/10'   },
]

function scoreColor(score: number) {
  if (score >= 7) return { bar: 'bg-primary', text: 'text-primary' }
  if (score >= 5) return { bar: 'bg-amber-400', text: 'text-amber-400' }
  return { bar: 'bg-error', text: 'text-error' }
}

const GRI_SCORE = 4.8

export default function ClientDashboardPage() {
  const [userEmail, setUserEmail] = useState('')
  const [userName, setUserName] = useState('ChocoFamily')

  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      if (u) {
        setUserEmail(u.email ?? '')
        setUserName(u.user_metadata?.company ?? u.user_metadata?.full_name ?? 'ChocoFamily')
      }
    })
  }, [])

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {/* Top Nav */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#0A0B0F]/80 backdrop-blur-xl sticky top-0 z-10">
        <Image src="/logo.svg" alt="AIStart360" width={140} height={26} priority />
        <div className="flex items-center gap-3">
          {userEmail && (
            <span className="text-xs font-mono text-on-surface-variant bg-surface-container px-3 py-1.5 rounded-lg hidden sm:block">
              {userEmail}
            </span>
          )}
          <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-mono text-primary uppercase tracking-wider">Client Portal</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Welcome Hero */}
        <section className="relative overflow-hidden rounded-3xl bg-surface-container-low border border-white/[0.06] p-8">
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, #6effc0 0%, transparent 60%)' }} />
          <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
                Client Portal · Q1 2026
              </p>
              <h1 className="font-headline text-3xl font-extrabold text-on-surface leading-tight">
                Добро пожаловать,{' '}
                <span className="text-gradient">{userName}</span>
              </h1>
              <p className="text-sm text-on-surface-variant mt-2">
                E-commerce · Mature Stage · chocofamily.kz
              </p>
            </div>
            {/* GRI Score widget */}
            <div className="flex items-center gap-5 bg-surface-container rounded-2xl border border-white/[0.06] p-5 flex-shrink-0">
              <div className="relative w-20 h-20">
                <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                  <circle cx="40" cy="40" r="32" fill="none"
                    stroke={GRI_SCORE >= 7 ? '#6effc0' : GRI_SCORE >= 5 ? '#facc15' : '#ef4444'}
                    strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={`${(GRI_SCORE / 10) * 201} 201`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-mono font-bold text-on-surface">{GRI_SCORE}</span>
                  <span className="text-[8px] font-mono text-on-surface-variant">/ 10</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">GRI Score</p>
                <p className="text-sm font-bold text-amber-400 mt-0.5">Средний уровень</p>
                <Link href="/client/point-a" className="text-[10px] font-mono text-primary hover:underline mt-2 block">
                  Детальный анализ →
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* GRI Blocks + Reports */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* GRI Blocks */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-headline text-lg font-bold text-on-surface">Оценка по блокам GRI</h2>
              <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2.5 py-1 rounded-full">7 блоков</span>
            </div>
            <div className="space-y-4">
              {GRI_BLOCKS.map((b) => {
                const c = scoreColor(b.score)
                return (
                  <div key={b.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`material-symbols-outlined text-sm ${c.text} opacity-60`}>{b.icon}</span>
                        <span className="text-xs text-on-surface-variant">{b.label}</span>
                      </div>
                      <span className={`text-xs font-mono font-bold ${c.text}`}>{b.score}</span>
                    </div>
                    <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${c.bar}`} style={{ width: `${(b.score / 10) * 100}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Reports */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-headline text-lg font-bold text-on-surface">Ваши отчёты</h2>
              <span className="text-[10px] font-mono text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">{REPORTS.length} файлов</span>
            </div>
            <div className="space-y-3">
              {REPORTS.map((r, i) => (
                <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-container border border-white/[0.04] hover:border-primary/20 transition-colors group cursor-pointer">
                  <div className="w-9 h-9 rounded-xl bg-surface-container-high flex items-center justify-center flex-shrink-0">
                    <span className={`material-symbols-outlined text-base ${r.color}`}>{r.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-on-surface truncate group-hover:text-primary transition-colors">{r.name}</p>
                    <p className="text-[10px] text-on-surface-variant font-mono mt-0.5">{r.category}</p>
                  </div>
                  <span className="material-symbols-outlined text-base text-on-surface-variant/40 group-hover:text-primary transition-colors">download</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
          <div className="flex items-center gap-2 mb-6">
            <span className="material-symbols-outlined text-primary text-xl">rocket_launch</span>
            <h2 className="font-headline text-lg font-bold text-on-surface">Следующие шаги</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {NEXT_STEPS.map((step) => (
              <div key={step.title} className="flex items-start gap-3 p-4 rounded-xl bg-surface-container border border-white/[0.04] hover:bg-white/[0.04] transition-colors cursor-pointer">
                <div className={`w-9 h-9 rounded-xl ${step.bg} flex items-center justify-center flex-shrink-0`}>
                  <span className={`material-symbols-outlined text-lg ${step.color}`}>{step.icon}</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-on-surface">{step.title}</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick Links */}
        <section>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Точка А', href: '/client/point-a', icon: 'my_location', desc: 'Текущее состояние' },
              { label: 'Онбординг',  href: '/client/onboarding',  icon: 'assignment',   desc: 'Заполнить анкету'  },
              { label: 'Документы', href: '/client/onboarding/documents', icon: 'upload_file', desc: 'Загрузить файлы' },
              { label: 'Поддержка', href: 'mailto:admin@aistart360.kz', icon: 'support_agent', desc: 'Написать эксперту' },
            ].map((item) => (
              <Link key={item.label} href={item.href}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-surface-container-low border border-white/[0.04] hover:border-primary/30 hover:bg-primary/5 transition-all group text-center">
                <span className="material-symbols-outlined text-2xl text-on-surface-variant group-hover:text-primary transition-colors">{item.icon}</span>
                <span className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">{item.label}</span>
                <span className="text-[10px] text-on-surface-variant">{item.desc}</span>
              </Link>
            ))}
          </div>
        </section>

        <footer className="flex items-center justify-center gap-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-mono text-primary/60">System Online</span>
          </div>
          <span className="text-on-surface-variant/20">·</span>
          <span className="text-[10px] font-mono text-on-surface-variant/40">AIStart360 v2.0</span>
        </footer>

      </main>
    </div>
  )
}
