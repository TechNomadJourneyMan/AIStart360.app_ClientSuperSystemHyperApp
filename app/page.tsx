import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthHome } from '@/components/auth-home/AuthHome'
import { homeRedirectFor, initialHomeTab } from '@/components/auth-home/home-routing'

// Главная портала — окно входа и регистрации (решение PO 2026-11-14).
// Маркетинговый лендинг продукта живёт на https://aistart360.app; прежний
// лендинг с A/B-вариантами (?v=1..4) и ценами удалён отсюда.
//
// Middleware пропускает `/` без проверки сессии, поэтому вошедшего отправляет
// страница: на /login, где middleware ведёт его в кабинет по роли
// (components/auth-home/home-routing.ts).

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
  return <AuthHome initialTab={initialHomeTab(searchParams)} />
}
