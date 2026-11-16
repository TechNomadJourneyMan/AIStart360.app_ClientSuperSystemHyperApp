import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'
import { SymbolIcon } from '@/components/ui/SymbolIcon'
import { RegisterForm } from '@/components/auth-home/RegisterForm'
import { loadAuthEntry } from '@/lib/registration/entry'
import { INVITE_ONLY_TITLE, registerNotice } from '@/lib/registration/wait-text'

export const metadata: Metadata = {
  title: { absolute: 'Регистрация — AIStart360' },
  openGraph: { title: 'Регистрация — AIStart360' },
}

// R4 B3: форма зависит от режима регистрации — сервер читает его при каждом
// заходе (не при сборке). В режиме «по приглашению» вместо регистрации —
// «Запросить приглашение».
export const dynamic = 'force-dynamic'

/**
 * N4B-8 / R-107: только разделы, которые есть у клиента (без «Рынка» и
 * TAM/SAM/SOM — раздел только для персонала), GRI — 7 блоков
 * (lib/gri-assessment/sections.ts), без придуманных чисел и отзывов.
 */
const FEATURES: ReadonlyArray<{ icon: string; title: string; desc: string }> = [
  { icon: 'radar', title: 'GRI-диагностика', desc: 'Готовность к росту по 7 блокам: продукт и спрос, доверие, бизнес-модель, деньги, операции, команда, владелец' },
  { icon: 'query_stats', title: 'Точка А', desc: 'Где бизнес сейчас: главные метрики и разбор по блокам' },
  { icon: 'trending_up', title: 'Точка Б', desc: 'План движения к вашей цели' },
]

const LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/gri-free', label: 'Бесплатная проверка GRI' },
  { href: '/privacy', label: 'Конфиденциальность' },
  { href: '/terms', label: 'Условия' },
]

export default async function RegisterPage({ searchParams }: { searchParams?: { notice?: string | string[] } }) {
  const entry = await loadAuthEntry()
  const inviteOnly = entry.mode === 'invite'
  return (
    <div className="min-h-screen bg-background text-on-surface flex">
      {/* Left — Branding */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[150px]" />

        <div className="relative z-10">
          <Logo className="h-8" />
        </div>

        <div className="relative z-10">
          <p className="text-3xl font-headline font-extrabold text-on-surface leading-tight">
            Присоединяйтесь к<br />
            <span className="text-primary">AIStart360</span>
          </p>
          <p className="text-sm text-on-surface-variant mt-4 max-w-sm leading-relaxed">
            Платформа для роста бизнеса: диагностика, разбор текущего состояния и план к цели.
          </p>

          {/* Features */}
          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.icon} className="flex items-start gap-3">
                <SymbolIcon name={f.icon} className="text-primary text-xl mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-on-surface/80">{f.title}</p>
                  <p className="text-xs text-on-surface-variant">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Verifiable links instead of invented numbers (R-107) */}
        <nav aria-label="Полезные ссылки" className="relative z-10 grid grid-cols-3 gap-3">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="min-h-11 bg-surface-container/30 border border-white/[0.05] rounded-xl p-4 text-center text-xs font-bold text-primary hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Right — Form */}
      <div className="w-full lg:w-[55%] flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <Logo className="h-8" />
          </div>

          <h1 className="text-2xl font-headline font-extrabold text-on-surface mb-1">
            {inviteOnly ? INVITE_ONLY_TITLE : 'Подать заявку'}
          </h1>
          {!inviteOnly && (
            <p className="text-base text-on-surface-variant mb-6">
              Зарегистрируйтесь как клиент для диагностики бизнеса.
            </p>
          )}

          <RegisterForm
            mode={entry.mode}
            waitText={entry.waitText}
            notice={inviteOnly ? registerNotice(searchParams?.notice) : null}
          />
        </div>
      </div>
    </div>
  )
}
