'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'

const NAV_ITEMS = [
  { label: 'Обзор', href: '/client/dashboard', icon: 'dashboard' },
  { label: 'Точка А', href: '/client/point-a', icon: 'my_location' },
  { label: 'Документы', href: '/client/onboarding/documents', icon: 'description' },
]

export function ClientPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuthStore()

  const isStandaloneFlow =
    pathname === '/client/waiting-room' || pathname === '/client/onboarding'

  if (isStandaloneFlow) {
    return <div className="min-h-screen bg-[#0A0B0F]">{children}</div>
  }

  const isActive = (href: string) =>
    href === '/client/dashboard' ? pathname === href : pathname.startsWith(href)

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const initials = user?.name
    ?.split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'AS'

  return (
    <div className="min-h-screen bg-[#0A0B0F] text-on-surface">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col border-r border-white/[0.06] bg-[#0e0f14] lg:flex">
        <Link href="/client/dashboard" className="flex h-16 items-center border-b border-white/[0.06] px-5">
          <Image src="/logo.svg" alt="AIStart360" width={142} height={26} priority />
        </Link>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border border-primary/20 bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-white/[0.04] hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-xl">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-white/[0.06] p-3">
          <Link
            href="/client/onboarding"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-on-surface-variant transition-colors hover:bg-white/[0.04] hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-xl">edit_note</span>
            Обновить анкету
          </Link>
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.06] bg-[#0e0f14]/90 px-4 backdrop-blur-xl lg:left-[220px] lg:px-6">
        <Link href="/client/dashboard" className="lg:hidden">
          <Image src="/logo.svg" alt="AIStart360" width={122} height={23} priority />
        </Link>
        <p className="hidden text-xs font-mono uppercase tracking-[0.18em] text-on-surface-variant/60 lg:block">
          Кабинет компании
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-surface-container px-2.5 py-1.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-[10px] font-bold text-primary">
              {initials}
            </span>
            <span className="hidden max-w-36 truncate text-xs text-on-surface sm:block">
              {user?.name || user?.email || 'Пользователь'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Выйти"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error"
          >
            <span className="material-symbols-outlined text-xl">logout</span>
          </button>
        </div>
      </header>

      <main className="min-h-screen px-4 pb-24 pt-20 lg:ml-[220px] lg:px-8 lg:pb-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-white/[0.06] bg-[#111318]/95 backdrop-blur-xl lg:hidden">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 py-3 text-[10px] font-medium ${
                active ? 'text-primary' : 'text-on-surface-variant'
              }`}
            >
              <span className="material-symbols-outlined text-2xl">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
