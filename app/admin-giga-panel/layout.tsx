'use client'

import { useState } from 'react'
import { GigaSidebar } from '@/components/giga-panel/GigaSidebar'
import { StaffProvider, useStaff } from '@/components/giga-panel/StaffContext'

function ShellBody({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { error, me, loading } = useStaff()

  return (
    <div
      className="min-h-screen text-slate-100"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.08) 0%, transparent 60%), #04081a' }}
    >
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="fixed left-0 right-0 top-0 z-40 flex items-center gap-3 border-b border-white/[0.07] bg-slate-950/90 px-4 py-3 backdrop-blur-xl md:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Открыть меню"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/20"
        >
          <span className="material-symbols-outlined text-lg text-blue-400">menu</span>
        </button>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-400">GIGA-CRM</p>
      </div>

      <GigaSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="min-h-screen md:pl-64">
        <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-20 md:px-8 md:pt-8">
          {!loading && !me && error ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-6 text-center">
              <p className="text-sm font-semibold text-red-200">Нет доступа к панели</p>
              <p className="mt-1 text-xs text-slate-400">{error}</p>
              <a href="/giga-login" className="mt-4 inline-block rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-white">Войти</a>
            </div>
          ) : children}
        </div>
      </main>
    </div>
  )
}

export default function GigaPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffProvider>
      <ShellBody>{children}</ShellBody>
    </StaffProvider>
  )
}
