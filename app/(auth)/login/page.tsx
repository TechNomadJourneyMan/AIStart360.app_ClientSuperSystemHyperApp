'use client'

import React, { Suspense } from 'react'
import { Logo } from '@/components/ui/Logo'
import { LoginForm } from '@/components/auth-home/LoginForm'

function LoginContent() {
  return (
    <main className="min-h-screen bg-background text-on-surface">
      <div className="mx-auto flex min-h-screen max-w-7xl">
      {/* Left — Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-8 xl:p-12 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[150px]" />

        <div className="relative z-10">
          <Logo className="min-h-11 min-w-11" />
          <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mt-2">
            Интеллектуальная платформа для бизнеса
          </p>
        </div>

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* GRI Hexagon */}
          <div className="w-48 h-48 mb-8 relative">
            <svg viewBox="0 0 200 200" className="w-full h-full text-primary" role="img" aria-label="GRI — платформа диагностики">
              <polygon points="100,10 180,55 180,145 100,190 20,145 20,55"
                fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
              <polygon points="100,30 160,65 160,135 100,170 40,135 40,65"
                fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
              <polygon points="100,50 140,75 140,125 100,150 60,125 60,75"
                fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
              {/* Vertices */}
              {[[100,10],[180,55],[180,145],[100,190],[20,145],[20,55]].map(([cx,cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="4" fill="currentColor" opacity="0.8" />
              ))}
              {/* Center text */}
              <text x="100" y="95" textAnchor="middle" fill="currentColor" fontSize="24" fontWeight="bold">GRI</text>
              <text x="100" y="115" textAnchor="middle" fill="currentColor" fontSize="13" letterSpacing="1">ПЛАТФОРМА</text>
            </svg>
          </div>

          <p className="text-base font-mono text-on-surface-variant tracking-widest uppercase">ИИ и эксперты</p>
          <h2 className="text-2xl font-headline font-extrabold text-primary mt-1">Платформа роста</h2>
          <p className="text-base text-on-surface-variant mt-4 max-w-sm leading-relaxed">
            Платформа диагностики и масштабирования бизнеса нового поколения
          </p>

          {/* Stats badges */}
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {[['500+', 'диагностик'], ['27', 'отраслей'], ['СНГ и Ближний Восток', '']].map(([val, label], i) => (
              <div key={i} className="px-4 py-2 bg-surface-container/40 border border-white/[0.05] rounded-full">
                <span className="text-xs font-mono text-on-surface-variant">
                  {val}{label ? ` · ${label}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div className="relative z-10 bg-surface-container/30 border border-white/[0.05] rounded-2xl p-5">
          <p className="text-base text-on-surface-variant italic leading-relaxed">
            &ldquo;AIStart360 помогла нам вырасти в 3 раза за 12 месяцев. GRI-диагностика — это не просто отчёт, это навигатор.&rdquo;
          </p>
          <div className="flex items-center gap-3 mt-3">
            <div aria-hidden="true" className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">ВЛ</div>
            <div>
              <p className="text-sm font-bold text-on-surface">Вортекс Лабс</p>
              <p className="text-xs text-on-surface-variant">Раунд А · финансовые технологии</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right — Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-4 py-6 sm:p-8 xl:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-6">
            <Logo className="min-h-11 min-w-11" />
          </div>

          {/* Badge */}
          <div className="flex items-center gap-2 mb-4">
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-xs font-mono text-primary uppercase tracking-widest">Доступ к платформе</span>
          </div>

          <h1 className="text-2xl font-headline font-extrabold text-on-surface mb-1">Войти в систему</h1>
          <p className="text-base text-on-surface-variant mb-6">Введите свои данные для входа</p>

          <LoginForm />
        </div>
      </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background flex items-center justify-center"><p role="status" className="text-base text-on-surface-variant">Загружаем форму входа…</p></main>}>
      <LoginContent />
    </Suspense>
  )
}
