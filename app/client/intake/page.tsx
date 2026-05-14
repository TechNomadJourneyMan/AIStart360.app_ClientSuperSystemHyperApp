'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import { UniversalIntake } from '@/components/intake/UniversalIntake'

export default function IntakePage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { router.replace('/login'); return }
      if (cancelled) return
      // Resolve companyId from latest companies row for this user
      try {
        const { data } = await sb
          .from('companies')
          .select('id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
        if (data && data.length > 0) setCompanyId(data[0].id)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [router])

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-10 bg-surface/85 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">
              AIStart360 · Универсальная загрузка
            </p>
            <h1 className="text-xl font-headline font-bold text-on-surface mt-0.5">
              Закинь всё — AI разложит
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="text-xs text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">dashboard</span>
            На дашборд
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <UniversalIntake companyId={companyId} />
      </main>
    </div>
  )
}
