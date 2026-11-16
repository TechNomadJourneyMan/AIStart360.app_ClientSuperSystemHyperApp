import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthHome } from '@/components/auth-home/AuthHome'
import { homeRedirectFor, initialHomeTab } from '@/components/auth-home/home-routing'
import { loadAuthEntry } from '@/lib/registration/entry'

// Главная портала — окно входа и регистрации (решение PO 2026-11-14).
// Маркетинговый лендинг продукта живёт на https://aistart360.app; прежний
// лендинг с A/B-вариантами (?v=1..4) и ценами удалён отсюда.
//
// Middleware пропускает `/` без проверки сессии, поэтому вошедшего отправляет
// страница: на /login, где middleware ведёт его в кабинет по роли
// (components/auth-home/home-routing.ts).
//
// R4 B3 (N4B-3, R-051, R-104): режим регистрации, демо и текст ожидания
// читаются здесь, на сервере, при каждом заходе (настройка меняется в ГИГА без
// сборки) и передаются окну входа.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { absolute: 'Вход — AIStart360' },
  description: 'Вход и регистрация на платформе AIStart360: диагностика бизнеса и план роста.',
  openGraph: { title: 'Вход — AIStart360' },
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { tab?: string | string[] }
}) {
  const target = homeRedirectFor((await cookies()).getAll())
  if (target) redirect(target)
  const entry = await loadAuthEntry()
  return (
    <AuthHome
      initialTab={initialHomeTab(searchParams)}
      registrationMode={entry.mode}
      demoOpen={entry.demoOpen}
      waitText={entry.waitText}
      showProductSite={entry.showProductSite}
    />
  )
}
