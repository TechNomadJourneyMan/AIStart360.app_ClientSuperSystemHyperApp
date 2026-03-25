import { redirect } from 'next/navigation'

// Root redirect: неаутентифицированные → /login, аутентифицированные → /dashboard
// Логику авторизации вынести в middleware.ts (см. /ТЗ/backend_guide.md)
export default function RootPage() {
  redirect('/dashboard')
}
