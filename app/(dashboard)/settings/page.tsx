import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SettingsClient, type SettingsInitial, type Prefs } from '@/components/settings/SettingsClient'
import TelegramLinkPanel from '@/components/settings/TelegramLinkPanel'

export const metadata: Metadata = { title: 'Настройки' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="font-headline text-3xl font-bold text-on-surface">Настройки</h1>
        <div className="bg-surface-container rounded-xl p-6 border border-outline-variant/30">
          <p className="text-on-surface">Не удалось загрузить профиль пользователя.</p>
          <p className="text-sm text-on-surface-variant mt-2">Сессия истекла или не найдена. Войдите снова.</p>
          <Link
            href="/login"
            className="mt-4 inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-lg">login</span>
            Войти
          </Link>
        </div>
      </div>
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const fullName = (profile?.full_name ?? meta.full_name ?? meta.name ?? user.email ?? 'Пользователь') as string

  // Telegram personal-account link (userbot sync) — separate from the
  // notification-bot toggle inside SettingsClient.
  const telegramProfile = profile as
    | { telegram_chat_id?: string | null; telegram_username?: string | null }
    | null
    | undefined
  const telegramPersonalUsername = process.env.TELEGRAM_PERSONAL_USERNAME || null

  const initial: SettingsInitial = {
    firstName: fullName.split(' ')[0] ?? '',
    lastName: fullName.split(' ').slice(1).join(' '),
    email: user.email ?? '',
    position: (profile?.position ?? meta.position ?? '') as string,
    organization: (profile?.organization ?? meta.organization ?? '') as string,
    phone: (profile?.phone ?? meta.phone ?? '') as string,
  }

  // Staff = the roles middleware lets into /team (ADMIN_PATHS). Anyone else
  // would only get redirected, so the tab stays hidden for them.
  const role = String(profile?.role ?? (meta.role as string) ?? 'client').toLowerCase()
  const isStaff = role === 'admin' || role === 'super_admin'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-bold text-on-surface">Настройки</h1>
        <p className="text-on-surface-variant text-sm mt-1">Управление аккаунтом и системой</p>
      </div>

      {/* The personal Telegram panel used to render outside the tabs, so it hung
          under «Биллинг» and «Журнал» too, next to a second, unrelated Telegram
          block. It now lives inside the «Интеграции» tab. Audit 2026-08-09. */}
      <SettingsClient
        initial={initial}
        preferences={(profile?.preferences ?? {}) as Prefs}
        isStaff={isStaff}
        telegramPersonalPanel={
          <TelegramLinkPanel
            initialLinked={Boolean(telegramProfile?.telegram_chat_id)}
            initialTelegramUsername={telegramProfile?.telegram_username ?? null}
            personalUsername={telegramPersonalUsername}
          />
        }
      />
    </div>
  )
}
