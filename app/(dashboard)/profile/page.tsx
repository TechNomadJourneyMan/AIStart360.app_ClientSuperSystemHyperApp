export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { completedStepsFromRows } from '@/lib/survey/steps'

export const metadata: Metadata = { title: 'Профиль' }

export default async function ProfilePage() {
  // Profile always belongs to the Supabase session user. The old staff-cookie
  // (Prisma) branch was removed — the forgeable `aistart360_user_id` cookie let
  // a crafted request load another user's profile (IDOR). Audit 2026-07-02.
  let sbProfile: Record<string, unknown> | null = null
  let sbCompany: Record<string, unknown> | null = null
  let diagCount = 0
  let surveySteps = 0

  const sb = await createClient()
  const { data: { user: sbUser } } = await sb.auth.getUser()

  if (sbUser?.id) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

    try {
      const [profileRes, companyRes, diagRes, surveyRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${sbUser.id}&select=*&limit=1`, { headers, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/companies?user_id=eq.${sbUser.id}&select=*&limit=1`, { headers, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/diagnostics?user_id=eq.${sbUser.id}&select=id`, { headers, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/survey_answers?user_id=eq.${sbUser.id}&select=step,question_key,answer`, { headers, cache: 'no-store' }),
      ])
      if (profileRes.ok) { const rows = await profileRes.json(); sbProfile = rows[0] ?? null }
      if (companyRes.ok) { const rows = await companyRes.json(); sbCompany = rows[0] ?? null }
      if (diagRes.ok) { const rows = await diagRes.json(); diagCount = rows.length }
      if (surveyRes.ok) {
        const rows = await surveyRes.json() as Array<{ step: number; question_key: string; answer: unknown }>
        surveySteps = completedStepsFromRows(rows).length
      }
    } catch {}
  }

  // --- Normalize display values ---
  const name = (sbProfile?.full_name as string) ?? '—'
  const email = (sbProfile?.email as string) ?? '—'
  const roleRaw = (sbProfile?.role as string) ?? 'client'
  const statusRaw = (sbProfile?.status as string) ?? 'pending'
  const org = (sbCompany?.name as string) ?? (sbProfile?.organization as string) ?? '—'
  const industry: string | null = (sbCompany?.industry as string) ?? null
  const createdAt = sbProfile?.created_at
    ? new Date(sbProfile.created_at as string).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
  const lastLogin = '—'

  const roleLabel =
    roleRaw === 'SUPER_ADMIN' ? 'Владелец' :
    roleRaw === 'ADMIN'       ? 'Администратор' :
    roleRaw === 'MANAGER'     ? 'Менеджер' :
    roleRaw === 'ANALYST'     ? 'Аналитик' :
    roleRaw === 'CLIENT' || roleRaw === 'client' ? 'Клиент' :
    roleRaw.toUpperCase()

  const isActive  = statusRaw === 'active' || statusRaw === 'approved'
  const isBlocked = statusRaw === 'blocked'
  const statusLabel = isActive ? 'Активен' : isBlocked ? 'Заблокирован' : 'Ожидает'
  const statusColor = isActive ? 'text-primary' : isBlocked ? 'text-error' : 'text-amber-400'
  const statusDot   = isActive ? 'bg-primary'   : isBlocked ? 'bg-error'   : 'bg-amber-400'

  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'

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
          <p className="text-xs font-mono text-on-surface-variant mt-1 uppercase tracking-wider">{roleLabel}</p>
          <div className="flex items-center gap-2 mt-3">
            <span className={`w-2 h-2 rounded-full ${statusDot} animate-pulse`} />
            <span className={`text-xs font-mono ${statusColor}`}>{statusLabel}</span>
          </div>

          <div className="w-full mt-6 pt-6 border-t border-white/[0.04] space-y-3 text-left">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant flex-shrink-0">mail</span>
              <span className="text-xs text-on-surface-variant break-all">{email}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant flex-shrink-0">business</span>
              <span className="text-xs text-on-surface-variant">{org}</span>
            </div>
            {industry && (
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-base text-on-surface-variant flex-shrink-0">category</span>
                <span className="text-xs text-on-surface-variant">{industry}</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant flex-shrink-0">calendar_today</span>
              <span className="text-xs text-on-surface-variant">Регистрация: {createdAt}</span>
            </div>
          </div>
        </div>

        {/* Account Info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Диагностик', value: String(diagCount), icon: 'analytics' },
              { label: 'Анкета', value: `${surveySteps}/6 шагов`, icon: 'assignment' },
              { label: 'Роль', value: roleLabel, icon: 'badge' },
            ].map(stat => (
              <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 text-center">
                <span className="material-symbols-outlined text-xl text-primary/50 mb-2 block">{stat.icon}</span>
                <p className="text-xl font-mono font-bold text-on-surface">{stat.value}</p>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">Информация об аккаунте</p>
            <div className="space-y-3">
              {[
                { label: 'Email',            value: email },
                { label: 'Роль',             value: roleLabel },
                { label: 'Статус',           value: statusLabel, color: statusColor },
                { label: 'Компания',         value: org },
                { label: 'Дата регистрации', value: createdAt },
                { label: 'Последний вход',   value: lastLogin },
              ].map(f => (
                <div key={f.label} className="flex justify-between text-xs py-1 border-b border-white/[0.03] last:border-0">
                  <span className="text-on-surface-variant">{f.label}</span>
                  <span className={`font-mono ${f.color ?? 'text-on-surface'}`}>{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
