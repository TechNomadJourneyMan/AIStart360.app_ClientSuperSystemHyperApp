export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import MarketAppEmbed from '@/components/market/MarketAppEmbed'

export const metadata: Metadata = { title: 'Рынок · Mark-analytics' }

/**
 * /market — продукт «Рынок» (Mark-analytics).
 *
 * Решение владельца продукта (июнь 2026): прежний «Competitor & Market Radar»
 * удалён; раздел целиком занимает встроенное приложение Mark-analytics
 * (карта рынка KZ, анализ ниши TAM/SAM/SOM, каталог компаний, виджеты).
 * Вход — только через личный кабинет (DashboardShell даёт auth-гейт),
 * сессия кабинета пробрасывается в приложение через postMessage.
 * Чек-лист «50 вопросов» живёт отдельной страницей: /market/analysis.
 */
export default function MarketPage() {
  return <MarketAppEmbed />
}
