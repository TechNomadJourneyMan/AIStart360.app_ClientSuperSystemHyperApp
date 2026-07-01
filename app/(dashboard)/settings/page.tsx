import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { SettingsClient, type SettingsInitial, type Prefs } from '@/components/settings/SettingsClient'

export const metadata: Metadata = { title: 'Settings' }
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
          <p className="text-sm text-on-surface-variant mt-2">Войдите снова и попробуйте открыть страницу повторно.</p>
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

  const initial: SettingsInitial = {
    firstName: fullName.split(' ')[0] ?? '',
    lastName: fullName.split(' ').slice(1).join(' '),
    email: user.email ?? '',
    position: (profile?.position ?? meta.position ?? '') as string,
    organization: (profile?.organization ?? meta.organization ?? '') as string,
    phone: (profile?.phone ?? meta.phone ?? '') as string,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-bold text-on-surface">Настройки</h1>
        <p className="text-on-surface-variant text-sm mt-1">Управление аккаунтом и системой</p>
      </div>

      <SettingsClient initial={initial} preferences={(profile?.preferences ?? {}) as Prefs} />
    </div>
  )
}
