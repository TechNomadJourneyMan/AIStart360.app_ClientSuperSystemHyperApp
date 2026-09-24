import { redirect } from 'next/navigation'

/**
 * Старый портал эксперта (/expert/*) выведен из работы: эксперт — это
 * сотрудник с ролью super_expert, его рабочее место — кабинет /super-expert
 * (Мой день, User 360 с вкладками Точка А / Точка Б / Пульс / Кейсы /
 * Комментарии). Любая старая ссылка ведёт туда; кого туда не пустят, решает
 * middleware и права роли.
 */
export default function LegacyExpertPortal({ params }: { params: { slug?: string[] } }) {
  const [section, id] = params.slug ?? []
  if (section === 'clients' && id && /^[0-9a-f-]{36}$/i.test(id)) redirect(`/super-expert/users/${id}`)
  redirect('/super-expert/today')
}
