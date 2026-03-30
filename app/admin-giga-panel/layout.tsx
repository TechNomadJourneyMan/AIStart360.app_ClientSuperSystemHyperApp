import type { Metadata } from 'next'
import { GigaSidebar } from '@/components/giga-panel/GigaSidebar'

export const metadata: Metadata = {
  title: 'ГИГА-Панель | Super Admin',
  description: 'Изолированная система управления — только для SUPER_ADMIN',
  robots: 'noindex, nofollow',
}

export default function GigaPanelLayout({ children }: { children: React.ReactNode }) {
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

      {/* Sidebar */}
      <GigaSidebar />

      {/* Main content */}
      <main className="pl-64 min-h-screen">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
