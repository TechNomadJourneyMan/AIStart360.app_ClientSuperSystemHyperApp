'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { EXPERT_NAV, isExpertNavActive } from './ExpertSidebar'

export function ExpertHeader() {
  const { user, logout } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <header className="fixed top-0 right-0 left-0 lg:left-[220px] z-40 h-16 bg-[#0e0f14]/80 backdrop-blur-xl border-b border-white/[0.04] flex items-center justify-between px-4 md:px-6">
      {/* Left */}
      <div className="flex items-center gap-3">
        {/* Burger — only on mobile, the sidebar is hidden < lg */}
        <button onClick={() => setMenuOpen(true)} aria-label="Открыть меню"
          className="lg:hidden w-9 h-9 -ml-1 rounded-xl flex items-center justify-center text-on-surface-variant hover:bg-white/[0.06] transition-colors">
          <span className="material-symbols-outlined">menu</span>
        </button>
        <span className="text-xs font-mono text-on-surface-variant/50 uppercase tracking-widest hidden md:block">
          Expert Portal
        </span>
      </div>

      {/* Right */}
      {/* No notifications bell: /notifications is an ADMIN_PATH, so middleware
          bounced the expert back to /expert/dashboard on every click, and the
          (expert) group has no notifications page of its own yet. */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-surface-container border border-white/[0.04] rounded-xl px-3 py-1.5">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
            {user?.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() ?? 'EX'}
          </div>
          <div className="hidden md:block">
            <p className="text-xs font-medium text-on-surface leading-none">{user?.name ?? 'Expert'}</p>
            <p className="text-[9px] text-on-surface-variant mt-0.5 capitalize">{user?.role ?? 'expert'}</p>
          </div>
          <button onClick={handleLogout} aria-label="Выйти" className="ml-1">
            <span className="material-symbols-outlined text-base text-on-surface-variant hover:text-error transition-colors">logout</span>
          </button>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[260px] flex flex-col bg-[#0e0f14] border-r border-white/[0.04]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
              <span className="text-xs font-mono text-on-surface-variant/60 uppercase tracking-[0.2em]">Expert Portal</span>
              <button onClick={() => setMenuOpen(false)} aria-label="Закрыть меню"
                className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/[0.06]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto no-scrollbar px-2 py-3 space-y-0.5">
              {EXPERT_NAV.map((item) => {
                const active = isExpertNavActive(pathname, item.href)
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                      active ? 'bg-primary/10 text-primary' : 'text-[#8a93a0] hover:text-[#e6f1ea] hover:bg-white/[0.04]'
                    }`}>
                    <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                )
              })}
            </nav>
            <div className="border-t border-white/[0.04] px-2 py-3">
              <button onClick={handleLogout}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[#8a93a0] hover:text-error hover:bg-error/5 transition-all">
                <span className="material-symbols-outlined text-[20px]">logout</span>
                <span className="text-sm">Выйти</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
