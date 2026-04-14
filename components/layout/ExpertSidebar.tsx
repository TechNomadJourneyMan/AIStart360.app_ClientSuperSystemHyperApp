'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useAuthStore } from '@/stores/auth.store'

export function ExpertSidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const t = useTranslations()
  const { user, logout } = useAuthStore()

  const EXPERT_NAV = [
    { label: t('nav.dashboard'),  href: '/expert/dashboard', icon: 'dashboard'      },
    { label: t('nav.profile'),    href: '/expert/profile',   icon: 'account_circle' },
    { label: t('nav.reports'),    href: '/expert/reports',   icon: 'description'    },
    { label: t('nav.gri'),        href: '/expert/gri',        icon: 'radar'          },
    { label: t('nav.insights'),   href: '/expert/insights',   icon: 'lightbulb'      },
  ]

  const isActive = (href: string) =>
    href === '/expert/dashboard' ? pathname === href : pathname.startsWith(href)

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 h-screen z-50 flex-col w-[220px] bg-[#0e0f14] border-r border-white/[0.04]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/[0.04]">
        <Image src="/logo-icon.svg" alt="AIStart360" width={28} height={28} />
        <div>
          <p className="text-xs font-mono text-on-surface-variant/60 uppercase tracking-[0.2em]">{t('expert.portal')}</p>
        </div>
      </div>

      {/* User info */}
      {user && (
        <div className="mx-3 mt-4 p-3 rounded-xl bg-surface-container border border-white/[0.04]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-primary">
                {user.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-on-surface truncate">{user.name}</p>
              <p className="text-[10px] text-on-surface-variant truncate">{user.organization ?? 'Expert'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-2 py-3 space-y-0.5">
        {EXPERT_NAV.map((item) => {
          const active = isActive(item.href)
          return (
            <Link key={item.href} href={item.href}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150
                ${active
                  ? 'bg-primary/10 text-primary'
                  : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'
                }
              `}
            >
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />}
              <span className="material-symbols-outlined text-[20px] flex-shrink-0"
                style={active ? { fontVariationSettings: "'FILL' 0.7" } : undefined}>
                {item.icon}
              </span>
              <span className={`text-sm font-medium ${active ? 'text-primary' : ''}`}>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/[0.04] px-2 py-3 space-y-0.5">
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
          <span className="text-[10px] font-mono text-primary/70 tracking-wider">{t('expert.online')}</span>
        </div>
        <button onClick={handleLogout}
          className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[#6b7280] hover:text-error hover:bg-error/5 transition-all">
          <span className="material-symbols-outlined text-[20px]">logout</span>
          <span className="text-sm">{t('nav.logout')}</span>
        </button>
      </div>
    </aside>
  )
}
