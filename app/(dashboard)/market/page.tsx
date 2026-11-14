export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import type { Metadata } from 'next'
import MarketAppEmbed from '@/components/market/MarketAppEmbed'
import FeatureGate from '@/components/access/FeatureGate'

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
 * Round 2 (R2-A): платный раздел — закрыт → пейволл; встроенное приложение не
 * монтируется и сессия кабинета в него не передаётся (прокси /api/market → 402).
 */
export default function MarketPage() {
  return (
    <FeatureGate feature="market" wrapperClassName="px-4 py-6">
      <Suspense fallback={null}>
        <MarketAppEmbed />
      </Suspense>
    </FeatureGate>
  )
}
