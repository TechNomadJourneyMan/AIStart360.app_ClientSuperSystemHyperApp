'use client'

import { PlanPanelStandalone } from '../point-b/PlanPanel'

/**
 * Экспертная Точка Б во вкладке «Разбор»: тот же поток, что и во вкладке «Точка Б», —
 * версия плана (черновик → на одобрение → одобрена). Эксперт отправляет версию,
 * Admin / Super Admin одобряет или возвращает; клиент видит только одобренную.
 * Цели клиента проверяются на вкладке «Точка Б».
 */
export function PointBReview({ userId }: { userId: string }) {
  return <PlanPanelStandalone userId={userId} />
}
