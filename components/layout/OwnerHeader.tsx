'use client'

import { useAuthStore } from '@/stores/auth.store'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export function OwnerHeader() {
  const { user, logout } = useAuthStore()
  const router = useRouter()

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <header className="fixed top-0 right-0 left-0 lg:left-[220px] z-40 h-16 bg-[#0e0f14]/80 backdrop-blur-xl border-b border-white/[0.04] flex items-center justify-between px-4 md:px-6">
      {/* Left */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-on-surface-variant/50 uppercase tracking-widest hidden md:block">
          Owner Portal
        </span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        <Link
          href="/owner/notifications"
          aria-label="Открыть уведомления"
          className="relative w-9 h-9 rounded-xl bg-surface-container hover:bg-surface-container-high border border-white/[0.04] flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-xl text-on-surface-variant">notifications</span>
        </Link>

        <div className="flex items-center gap-2 bg-surface-container border border-white/[0.04] rounded-xl px-3 py-1.5">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-secondary/30 to-secondary/10 flex items-center justify-center text-[10px] font-bold text-secondary">
            {user?.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() ?? 'OW'}
          </div>
          <div className="hidden md:block">
            <p className="text-xs font-medium text-on-surface leading-none">{user?.name ?? 'Owner'}</p>
            <p className="text-[9px] text-on-surface-variant mt-0.5">{user?.organization ?? 'Компания'}</p>
          </div>
          <button onClick={handleLogout} className="ml-1">
            <span className="material-symbols-outlined text-base text-on-surface-variant hover:text-error transition-colors">logout</span>
          </button>
        </div>
      </div>
    </header>
  )
}
