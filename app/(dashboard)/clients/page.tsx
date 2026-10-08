import { redirect } from 'next/navigation'

// Список клиентов переехал в ГИГА-Панель (старая таблица читала удалённый
// /api/v1/admin/clients).
export default function LegacyClientsRedirect() {
  redirect('/admin-giga-panel/users')
}
