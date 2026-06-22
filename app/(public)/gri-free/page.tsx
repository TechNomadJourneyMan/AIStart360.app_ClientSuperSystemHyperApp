import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'
import { MiniGriWizard } from '@/components/mini-gri/MiniGriWizard'

export const metadata: Metadata = {
  title: 'Бесплатный мини-GRI — узнайте готовность бизнеса к росту | AIStart360',
  description:
    'Пройдите быструю диагностику GRI за 5 минут — без регистрации. Оцените бизнес-модель, устойчивость и спрос, а затем откройте полный отчёт по 7 блокам.',
}

export default function GriFreePage() {
  return (
    <main className="min-h-screen bg-[#0A0B0F] text-on-surface relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-primary/5 rounded-full blur-[160px]" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-5 md:px-10 py-5">
        {/* Logo already links to "/" — no outer Link wrapper (avoids nested <a>) */}
        <Logo className="h-7" />
        <Link
          href="/login"
          className="text-sm text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-lg px-2 py-1"
        >
          Войти
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-5 md:px-10 pt-6 md:pt-12 pb-8 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full border border-white/[0.06] bg-surface-container/50">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-mono text-primary/80 uppercase tracking-[0.2em]">
            Бесплатно · без регистрации
          </span>
        </div>

        <h1 className="font-headline text-3xl md:text-5xl font-extrabold leading-tight text-on-surface">
          Узнайте GRI вашего бизнеса
          <br className="hidden md:block" />{' '}
          <span className="text-primary">за 5 минут</span>
        </h1>
        <p className="text-base md:text-lg text-on-surface-variant mt-4 max-w-xl mx-auto leading-relaxed">
          6 быстрых вопросов — и вы увидите мгновенную оценку готовности бизнеса
          к росту по 3 ключевым блокам. Полный разбор по 7 блокам открывается
          сразу после.
        </p>

        {/* Trust strip */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
          {[
            ['bolt', 'Мгновенный результат'],
            ['radar', '3 блока · радар'],
            ['lock_open', 'Полный GRI по e-mail'],
          ].map(([icon, label]) => (
            <div
              key={label}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container/40 border border-white/[0.05]"
            >
              <span className="material-symbols-outlined text-primary text-base">{icon}</span>
              <span className="text-xs font-mono text-on-surface-variant">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Wizard */}
      <section className="relative z-10 px-5 md:px-10 pb-20">
        <MiniGriWizard />
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-5 md:px-10 pb-10 text-center">
        <p className="text-xs text-on-surface-variant/50">
          AIStart360 — Institutional Intelligence Platform · GRI-диагностика и
          масштабирование бизнеса
        </p>
      </footer>
    </main>
  )
}
