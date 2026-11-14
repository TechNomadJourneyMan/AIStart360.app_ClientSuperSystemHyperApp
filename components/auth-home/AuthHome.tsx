'use client'

import React, { Suspense, useRef, useState } from 'react'
import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'
import { LoginForm } from '@/components/auth-home/LoginForm'
import { RegisterForm } from '@/components/auth-home/RegisterForm'
import { PRODUCT_SITE_URL, type HomeTab } from '@/components/auth-home/home-routing'

const TABS: ReadonlyArray<{ id: HomeTab; label: string }> = [
  { id: 'login', label: 'Вход' },
  { id: 'register', label: 'Регистрация' },
]

const tabId = (t: HomeTab) => `auth-home-tab-${t}`
const panelId = (t: HomeTab) => `auth-home-panel-${t}`

/**
 * Главная портала: компактное окно «Вход / Регистрация».
 * Формы — те же, что на /login и /register (components/auth-home/*Form).
 */
export function AuthHome({ initialTab = 'login' }: { initialTab?: HomeTab }) {
  const [tab, setTab] = useState<HomeTab>(initialTab)
  const tabRefs = useRef<Record<HomeTab, HTMLButtonElement | null>>({ login: null, register: null })

  const select = (next: HomeTab, focus = false) => {
    setTab(next)
    if (focus) tabRefs.current[next]?.focus()
  }

  // WAI-ARIA tabs: стрелки/Home/End переключают вкладку и переносят фокус.
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next === null) return
    e.preventDefault()
    select(TABS[next].id, true)
  }

  const switchLink = (target: HomeTab, prompt: string, label: string) => (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0 mt-4 text-sm text-on-surface-variant">
      <span>{prompt}</span>
      <button
        type="button"
        onClick={() => select(target, true)}
        className="inline-flex min-h-11 min-w-11 items-center text-primary font-bold hover:underline"
      >
        {label}
      </button>
    </div>
  )

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-on-surface">
      {/* Фоновое свечение бренда */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-primary/5 blur-[150px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8 sm:py-12">
        <header className="mb-6 text-center">
          <Logo className="min-h-11 min-w-11" />
          <h1 className="mt-4 text-2xl font-headline font-extrabold text-on-surface">
            {tab === 'login' ? 'Вход в AIStart360' : 'Регистрация в AIStart360'}
          </h1>
          <p className="mt-2 text-base text-on-surface-variant">
            Диагностика бизнеса и план роста — ИИ и эксперты на одной платформе.
          </p>
        </header>

        <section className="glass-card rounded-3xl p-4 shadow-2xl shadow-black/30 sm:p-8" aria-label="Вход и регистрация">
          <div role="tablist" aria-label="Вход или регистрация" className="mb-6 grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.06] bg-surface-container/60 p-1">
            {TABS.map((t) => {
              const active = t.id === tab
              return (
                <button
                  key={t.id}
                  ref={(el) => { tabRefs.current[t.id] = el }}
                  type="button"
                  role="tab"
                  id={tabId(t.id)}
                  aria-selected={active}
                  aria-controls={panelId(t.id)}
                  tabIndex={active ? 0 : -1}
                  onClick={() => select(t.id)}
                  onKeyDown={onTabKeyDown}
                  className={`min-h-11 rounded-xl px-3 text-base font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 ${
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* Неактивная панель не рендерится: у форм нет общих id, а фокус и
              автозаполнение браузера видят только одну форму. */}
          <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
            {tab === 'login' ? (
              <Suspense fallback={<p role="status" className="text-base text-on-surface-variant">Загружаем форму входа…</p>}>
                <LoginForm footer={switchLink('register', 'Нет аккаунта?', 'Создать аккаунт')} />
              </Suspense>
            ) : (
              <RegisterForm footer={switchLink('login', 'Уже есть аккаунт?', 'Войти')} />
            )}
          </div>
        </section>

        <footer className="mt-6">
          <nav aria-label="Информация" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0 text-sm text-on-surface-variant">
            <a
              href={PRODUCT_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center hover:text-primary hover:underline"
            >
              О платформе<span className="sr-only"> (откроется в новой вкладке)</span>
            </a>
            <Link href="/gri-free" className="inline-flex min-h-11 items-center hover:text-primary hover:underline">
              Бесплатная проверка GRI
            </Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-primary hover:underline">
              Конфиденциальность
            </Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-primary hover:underline">
              Условия
            </Link>
          </nav>
          <p className="mt-2 text-center text-xs text-on-surface-variant">© {new Date().getFullYear()} AIStart360</p>
        </footer>
      </div>
    </main>
  )
}
