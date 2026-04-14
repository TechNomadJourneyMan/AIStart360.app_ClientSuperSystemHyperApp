'use client'

import { useState } from 'react'
import { GigaSidebar } from '@/components/giga-panel/GigaSidebar'
import { useTranslations } from 'next-intl'

export default function GigaPanelLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const t = useTranslations()

  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.08) 0%, transparent 60%), #04081a',
      }}
    >
      {/* Ambient grid overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Mobile header with hamburger */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center gap-3 px-4 py-3 bg-slate-950/90 backdrop-blur-xl border-b border-white/[0.07]">
        <button
          onClick={() => setSidebarOpen(true)}
          className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-lg text-blue-400">menu</span>
        </button>
        <p className="text-xs font-semibold text-blue-400 tracking-[0.15em] uppercase">{t('giga.title')}</p>
      </div>

      {/* Sidebar */}
      <GigaSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <main className="md:pl-64 min-h-screen">
        <div className="pt-16 md:pt-0 p-4 md:p-8">{children}</div>
      </main>
    </div>
  )
}
