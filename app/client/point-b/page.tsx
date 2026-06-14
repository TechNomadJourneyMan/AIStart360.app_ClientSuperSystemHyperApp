'use client'

import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import PointBContainer from '@/components/point-b/PointBContainer'

export default function ClientPointBPage() {
  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      <header className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Image src="/logo.svg" alt="AIStart360" width={120} height={22} />
          <div className="flex items-center gap-3">
            <Link href="/client/point-a" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">arrow_back</span>Точка A
            </Link>
            <Link href="/client/dashboard" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">dashboard</span>Дашборд
            </Link>
            <button
              onClick={async () => {
                const sb = createClient()
                await sb.auth.signOut()
                window.location.href = '/login'
              }}
              className="flex items-center gap-1.5 text-xs font-mono text-red-400/70 hover:text-red-400 border border-red-500/10 rounded-lg px-3 py-1.5 transition-all"
            >
              <span className="material-symbols-outlined text-sm">logout</span>Выход
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <PointBContainer />
      </main>
    </div>
  )
}
