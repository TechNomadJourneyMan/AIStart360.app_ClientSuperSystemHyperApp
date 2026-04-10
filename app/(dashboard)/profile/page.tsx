export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Профиль' }

export default async function ProfilePage() {
  const cookieStore = await cookies()
  const userId = cookieStore.get('aistart360_user_id')?.value ?? null

  let user: {
    id: string
    name: string | null
    email: string
    role: string
    createdAt: Date
    lastLogin: Date | null
    org: { name: string } | null
  } | null = null

  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        lastLogin: true,
        org: { select: { name: true } },
      },
    }).catch(() => null)
  }

  const name = user?.name ?? user?.email ?? 'Пользователь'
  const email = user?.email ?? '—'
  const org = user?.org?.name ?? '—'
  const rawRole = user?.role ?? 'MANAGER'

  // Map Prisma role → display label
  const roleLabel =
    rawRole === 'SUPER_ADMIN' ? 'Владелец' :
    rawRole === 'ADMIN' ? 'Администратор' :
    rawRole === 'MANAGER' ? 'Менеджер' :
    rawRole === 'ANALYST' ? 'Аналитик' : 'Пользователь'

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '??'

  const createdAt = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—'

  const lastLogin = user?.lastLogin
    ? new Date(user.lastLogin).toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : 'Никогда'

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Личный кабинет
        </p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Профиль</h1>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-8 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/30 flex items-center justify-center mb-4">
            <span className="text-2xl font-headline font-bold text-primary">{initials}</span>
          </div>
          <h2 className="font-headline text-lg font-bold text-on-surface">{name}</h2>
          <p className="text-xs font-mono text-on-surface-variant mt-1 uppercase tracking-wider">
            {roleLabel}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-mono text-primary">Активен</span>
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
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant flex-shrink-0">calendar_today</span>
              <span className="text-xs text-on-surface-variant">Регистрация: {createdAt}</span>
            </div>
          </div>
        </div>

        {/* Account Info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">
              Информация об аккаунте
            </p>
            <div className="space-y-3">
              {[
                { label: 'Email',            value: email },
                { label: 'Роль',             value: roleLabel },
                { label: 'Статус',           value: 'Активен', highlight: true },
                { label: 'Компания',         value: org },
                { label: 'Дата регистрации', value: createdAt },
                { label: 'Последний вход',   value: lastLogin },
              ].map((f) => (
                <div key={f.label} className="flex justify-between text-xs py-1 border-b border-white/[0.03] last:border-0">
                  <span className="text-on-surface-variant">{f.label}</span>
                  <span className={`font-mono ${f.highlight ? 'text-primary' : 'text-on-surface'}`}>
                    {f.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">
              Безопасность
            </p>
            <div className="space-y-2">
              {[
                { label: '2FA',    value: 'Не настроена',  action: 'Включить',    danger: false },
                { label: 'Пароль', value: 'Изменить пароль', action: 'Изменить',  danger: false },
                { label: 'Сессии', value: '1 активная',    action: 'Завершить все', danger: true },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-xs text-on-surface">{item.label}</p>
                    <p className="text-[10px] text-on-surface-variant">{item.value}</p>
                  </div>
                  <button
                    className={`text-[10px] font-mono px-3 py-1.5 rounded-lg border transition-colors ${
                      item.danger
                        ? 'text-error border-error/20 hover:bg-error/10'
                        : 'text-primary border-primary/20 hover:bg-primary/10'
                    }`}
                  >
                    {item.action}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
