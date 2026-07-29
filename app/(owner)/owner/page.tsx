// Голый /owner — не страница, а вход в портал владельца. Без этого файла
// маршрут отдавал 404. Каноническая посадочная страница — /owner/dashboard.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function OwnerIndexRedirect() {
  redirect('/owner/dashboard')
}
