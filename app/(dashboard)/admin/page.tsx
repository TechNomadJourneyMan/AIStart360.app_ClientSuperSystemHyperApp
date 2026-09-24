import { redirect } from 'next/navigation'

// Устаревшая админка удалена: управление пользователями и заявками — в ГИГА-Панели.
export default function LegacyAdminRedirect() {
  redirect('/admin-giga-panel')
}
