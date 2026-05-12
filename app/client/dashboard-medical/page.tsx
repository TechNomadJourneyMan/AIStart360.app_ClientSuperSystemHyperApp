'use client'

// Legacy clinic dashboard route — content is now merged into the main
// /dashboard for medical-vertical clients. This page is kept as a
// standalone view (e.g. for sharing a direct link or for older
// bookmarks) and simply renders MedicalAuditPanel inside its layout.

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import { MedicalAuditPanel } from '@/components/medical/MedicalAuditPanel'

export default function MedicalDashboardPage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!cancelled && !user) router.replace('/login')
    })()
    return () => { cancelled = true }
  }, [router])

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">
              AI-усиление для клиник
            </p>
            <h1 className="text-xl font-headline font-bold text-on-surface mt-0.5">
              Кабинет клиники
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="text-xs text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">dashboard</span>
            На главный дашборд
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <MedicalAuditPanel />
      </main>
    </div>
  )
}
