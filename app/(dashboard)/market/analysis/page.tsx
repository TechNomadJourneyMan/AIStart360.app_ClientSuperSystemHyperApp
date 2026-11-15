export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { MarketAnalysisChecklist } from '@/components/market-analysis/MarketAnalysisChecklist'
import FeatureGate from '@/components/access/FeatureGate'

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
  // Round 2 (R2-A): part of the paid section «Рынок» (API /api/v1/market-analysis → 402 the same way).
  return <FeatureGate feature="market" wrapperClassName="px-4 py-6"><MarketAnalysisChecklist /></FeatureGate>
}
