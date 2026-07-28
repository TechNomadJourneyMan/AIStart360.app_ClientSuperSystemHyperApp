import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Профиль' }

export default function ProfilePage() {
  redirect('/settings')
}
