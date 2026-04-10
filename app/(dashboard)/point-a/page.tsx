export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { FileArea } from '@/components/point-a/FileArea'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

export default async function PointAPage() {
  const session = await auth()

  // Resolve userId from ALL auth sources:
  // 1. Staff httpOnly cookie (Prisma login)
  // 2. Supabase Auth session (Google OAuth / email login)
  // 3. NextAuth session
  // 4. GigaAccessGuard role cookie fallback
  const cookieStore = await cookies()
  const staffUserId = cookieStore.get('aistart360_user_id')?.value ?? null
  const staffRole = cookieStore.get('aistart360_role')?.value ?? null

  let supabaseUserId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user: sbUser } } = await supabase.auth.getUser()
    supabaseUserId = sbUser?.id ?? null
  } catch {
    // Supabase auth not available
  }

  let clientId = staffUserId ?? supabaseUserId ?? session?.user?.id ?? (staffRole ? `giga-${staffRole}` : null)

  // Fetch data from Supabase REST API (bypasses RLS)
  let docsCount = 0
  let avgScore = 0
  let domainScores: Array<{ id: string; label: string; score: number; max: number; icon: string }> = []
  let latestReports: Array<{ id: string; score: number; calculatedAt: string; clientName: string }> = []

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

    // Count user's uploaded documents
    if (clientId) {
      const docsRes = await fetch(
        `${supabaseUrl}/rest/v1/documents?user_id=eq.${clientId}&select=id`,
        { headers, cache: 'no-store' }
      )
      if (docsRes.ok) {
        const docs = await docsRes.json()
        docsCount = Array.isArray(docs) ? docs.length : 0
      }
    }

    // Get user's latest diagnostic
    const user = session?.user
    if (user?.id) {
      if (!clientId) clientId = user.id
      const diagRes = await fetch(
        `${supabaseUrl}/rest/v1/diagnostics?user_id=eq.${user.id}&order=calculated_at.desc&limit=1`,
        { headers, cache: 'no-store' }
      )
      if (diagRes.ok) {
        const diags = await diagRes.json()
        const diag = diags[0]
        if (diag) {
          avgScore = diag.overall_score ?? 0

          const blocks: Record<string, { label: string; icon: string }> = {
            finance: { label: 'Финансы', icon: 'payments' },
            sales: { label: 'Продажи', icon: 'trending_up' },
            operations: { label: 'Операции', icon: 'settings' },
            marketing: { label: 'Маркетинг', icon: 'campaign' },
            strategy: { label: 'Стратегия', icon: 'flag' },
          }

          domainScores = Object.entries(blocks).map(([key, meta]) => {
            const blockData = diag[`${key}_score`]
            const score = typeof blockData === 'object' && blockData !== null
              ? (blockData as { score?: number }).score ?? 0
              : 0
            return { id: key, label: meta.label, score, max: 100, icon: meta.icon }
          })

          latestReports = [{
            id: diag.id,
            score: diag.overall_score ?? 0,
            calculatedAt: diag.calculated_at ?? diag.created_at,
            clientName: user.email ?? 'Клиент',
          }]
        }
      }
    }
  } catch (err) {
    console.error('[point-a] Data fetch error:', err)
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          AI Диагностика · Текущее состояние
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Точка <span className="text-gradient">А</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
          Объективная оценка текущего состояния бизнеса.
          Загрузите документы для автоматического анализа ИИ-агентом.
        </p>
      </section>

      {/* Current State Overview */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Общий балл', value: String(avgScore), icon: 'radar', good: avgScore >= 50, note: avgScore ? 'из 100' : 'нет данных' },
          { label: 'Документы', value: String(docsCount), icon: 'description', good: docsCount > 0, note: docsCount > 0 ? 'загружено' : 'нет файлов' },
          { label: 'Блоков', value: String(domainScores.length || 5), icon: 'category', good: true, note: 'направлений' },
          { label: 'Health', value: avgScore >= 70 ? 'High' : avgScore >= 40 ? 'Medium' : avgScore > 0 ? 'Low' : '—', icon: 'favorite', good: avgScore >= 40, note: avgScore > 0 ? 'по диагностике' : 'нет данных' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/10 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
              <span className={`material-symbols-outlined text-base ${stat.good ? 'text-primary/50' : 'text-error/50'}`}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-mono font-bold text-on-surface mb-1">{stat.value}</p>
            <p className={`text-[10px] font-mono uppercase tracking-tighter ${stat.good ? 'text-primary' : 'text-error'}`}>{stat.note}</p>
          </div>
        ))}
      </section>

      {/* Domain Diagnostics */}
      {domainScores.length > 0 && (
        <section>
          <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-6">
            <div>
              <h2 className="font-headline text-lg font-bold text-on-surface">Диагностика по блокам</h2>
              <p className="text-xs text-on-surface-variant mt-1">Текущий уровень по каждому направлению</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {domainScores.map((domain) => {
              const pct = (domain.score / domain.max) * 100
              const isStrong = pct >= 70
              const isCritical = pct < 50
              return (
                <div key={domain.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/10 p-5 transition-all group hover:scale-[1.01]">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center border border-white/[0.04]">
                      <span className="material-symbols-outlined text-lg text-primary">{domain.icon}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${
                      isCritical ? 'text-error border-error/20 bg-error/5' :
                      isStrong ? 'text-primary border-primary/20 bg-primary/5' :
                      'text-tertiary-container border-tertiary-container/20 bg-tertiary-container/5'
                    }`}>
                      {isCritical ? 'Критично' : isStrong ? 'Сильно' : 'Средне'}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-on-surface mb-3">{domain.label}</h3>
                  <div className="flex items-end justify-between mb-2">
                    <span className="text-3xl font-mono font-bold text-on-surface">{domain.score}</span>
                    <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-widest">/ {domain.max}</span>
                  </div>
                  <div className="h-1.5 bg-surface-container rounded-full overflow-hidden border border-white/[0.02]">
                    <div className={`h-full rounded-full transition-all duration-1000 ${
                      isCritical ? 'bg-error' : isStrong ? 'bg-primary' : 'bg-tertiary-container'
                    }`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Interactive File Area */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
        <FileArea userId={clientId ?? ''} />
      </section>

      {/* Latest reports */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Последние расчёты</h2>
        <div className="grid grid-cols-1 gap-3">
          {latestReports.map((report) => (
            <div key={report.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold border ${report.score >= 50 ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-error/10 border-error/20 text-error'}`}>
                  {report.score}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-on-surface">{report.clientName}</h3>
                  <p className="text-xs text-on-surface-variant font-mono">
                    {new Date(report.calculatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {latestReports.length === 0 && (
            <div className="bg-surface-container-low rounded-2xl border border-dashed border-white/10 p-12 text-center">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-4 block">insert_chart</span>
              <p className="text-sm text-on-surface-variant font-medium">Нет данных диагностики</p>
              <p className="text-xs text-on-surface-variant/60 mt-1">Заполните анкету для расчёта Точки А</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
