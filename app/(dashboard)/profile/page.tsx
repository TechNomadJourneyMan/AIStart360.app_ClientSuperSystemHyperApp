export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase-server'

export const metadata: Metadata = { title: 'Профиль' }

export default async function ProfilePage() {
  const sb = createServerClient()

  // Get current user
  const { data: { user } } = await sb.auth.getUser()

  let profile: Record<string, unknown> | null = null
  let company: Record<string, unknown> | null = null
  let diagCount = 0
  let surveySteps = 0

  if (user?.id) {
    // Fetch via REST to bypass RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

    try {
      const [profileRes, companyRes, diagRes, surveyRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=*&limit=1`, { headers, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/companies?user_id=eq.${user.id}&select=*&limit=1`, { headers, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/diagnostics?user_id=eq.${user.id}&select=id`, { headers, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/survey_answers?user_id=eq.${user.id}&select=step`, { headers, cache: 'no-store' }),
      ])

      if (profileRes.ok) {
        const rows = await profileRes.json()
        profile = rows[0] ?? null
      }
      if (companyRes.ok) {
        const rows = await companyRes.json()
        company = rows[0] ?? null
      }
      if (diagRes.ok) {
        const rows = await diagRes.json()
        diagCount = rows.length
      }
      if (surveyRes.ok) {
        const rows = await surveyRes.json() as Array<{ step: number }>
        surveySteps = new Set(rows.map(r => r.step)).size
      }
    } catch {}
  }

  const name = (profile?.full_name as string) ?? user?.email ?? 'Пользователь'
  const email = (profile?.email as string) ?? user?.email ?? '—'
  const role = ((profile?.role as string) ?? 'client').toUpperCase()
  const status = (profile?.status as string) ?? 'active'
  const org = (company?.name as string) ?? (profile?.organization as string) ?? '—'
  const industry = (company?.industry as string) ?? null
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
  const createdAt = profile?.created_at ? new Date(profile.created_at as string).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

  const statusLabel = status === 'approved' ? 'Активен' : status === 'blocked' ? 'Заблокирован' : 'Ожидает'
  const statusColor = status === 'approved' ? 'text-primary' : status === 'blocked' ? 'text-error' : 'text-amber-400'
  const statusDot = status === 'approved' ? 'bg-primary' : status === 'blocked' ? 'bg-error' : 'bg-amber-400'

  return (
    <div className="space-y-8 max-w-4xl">
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Личный кабинет</p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Профиль</h1>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-8 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/30 flex items-center justify-center mb-4">
            <span className="text-2xl font-headline font-bold text-primary">{initials}</span>
          </div>
          <h2 className="font-headline text-lg font-bold text-on-surface">{name}</h2>
          <p className="text-xs font-mono text-on-surface-variant mt-1 uppercase tracking-wider">{role}</p>
          <div className="flex items-center gap-2 mt-3">
            <span className={`w-2 h-2 rounded-full ${statusDot} animate-pulse`} />
            <span className={`text-xs font-mono ${statusColor}`}>{statusLabel}</span>
          </div>

          <div className="w-full mt-6 pt-6 border-t border-white/[0.04] space-y-3">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant">mail</span>
              <span className="text-xs text-on-surface-variant">{email}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant">business</span>
              <span className="text-xs text-on-surface-variant">{org}</span>
            </div>
            {industry && (
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-base text-on-surface-variant">category</span>
                <span className="text-xs text-on-surface-variant">{industry}</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant">calendar_today</span>
              <span className="text-xs text-on-surface-variant">Регистрация: {createdAt}</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Диагностик', value: String(diagCount), icon: 'analytics' },
              { label: 'Анкета', value: `${surveySteps}/6 шагов`, icon: 'assignment' },
              { label: 'Роль', value: role, icon: 'badge' },
            ].map(stat => (
              <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 text-center">
                <span className="material-symbols-outlined text-xl text-primary/50 mb-2 block">{stat.icon}</span>
                <p className="text-xl font-mono font-bold text-on-surface">{stat.value}</p>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Account Info */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">Информация об аккаунте</p>
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Email</span>
                <span className="font-mono text-on-surface">{email}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Роль</span>
                <span className="font-mono text-on-surface">{role}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Статус</span>
                <span className={`font-mono ${statusColor}`}>{statusLabel}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Компания</span>
                <span className="font-mono text-on-surface">{org}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Дата регистрации</span>
                <span className="font-mono text-on-surface">{createdAt}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">User ID</span>
                <span className="font-mono text-on-surface/50 text-[10px]">{user?.id?.slice(0, 8)}...</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
