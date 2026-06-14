export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { MarketAnalysisChecklist } from '@/components/market-analysis/MarketAnalysisChecklist'

export const metadata: Metadata = { title: 'Анализ рынка · 50 вопросов' }

/**
 * /market/analysis — ЭТАП 02 «Анализ рынка».
 *
 * Тонкая серверная обёртка: внешний DashboardShell обеспечивает аутентификацию
 * и сайдбар, поэтому страница лишь монтирует клиентский чек-лист, который сам
 * читает live-данные из `/api/v1/market-analysis` и честно деградирует, если
 * эндпоинт ещё не готов.
 */
export default function MarketAnalysisPage() {
  return <MarketAnalysisChecklist />
}
