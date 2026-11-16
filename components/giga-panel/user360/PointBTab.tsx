'use client'

import { useCallback, useEffect, useState } from 'react'
import StaffPointBView from '@/components/point-b/StaffPointBView'
import type { PlanVersionRow } from '@/lib/point-b/plan/types'
import { FinmodelPanel } from './point-b/FinmodelPanel'
import { GoalReviewPanel } from './point-b/GoalReviewPanel'
import { PlanFactPanel } from './point-b/PlanFactPanel'
import { PlanPanel } from './point-b/PlanPanel'
import { RecommendationsPanel } from './point-b/RecommendationsPanel'
import { WhatIfSavedPanel } from './point-b/WhatIfSavedPanel'
import { usePlanController } from './point-b/usePlanController'

/**
 * Точка Б клиента: тот же расчёт, что видит клиент (R3, M3: состояние страницы клиента — модель и только одобренная
 * версия плана; старый расчёт V2 здесь больше не показывается), плюс работа по плану —
 * проверка целей и версии плана (черновик → на одобрение → одобрена). Прямой записи
 * «корректировки» больше нет: любой текст эксперта — это версия плана, и клиент видит
 * его только после одобрения Admin / Super Admin. Работать с планом может только тот,
 * у кого есть clients.review. Там же — «Финмодель» клиента: проверка допущений (деньги, расходы,
 * долги) и подтверждение значений, и сохранённые клиентом «что если» (только чтение).
 * И «Рекомендации клиента»: очередь проверки рекомендаций правил и ИИ — клиент видит только подтверждённые.
 * И «План-факт и пересчёт»: сверка «план — факт» по месяцам, «Факт за месяц» от эксперта, версии и кнопка «Пересчитать».
 */

const NO_VERSIONS: PlanVersionRow[] = []

/** Goals + plan versions share one controller: a verified goal unlocks the approval. */
function PlanWorkspace({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const { ctl, snap } = usePlanController(userId)
  // A published / returned version changes what the calculation below shows.
  useEffect(() => { if (snap.notice) onChanged() }, [snap.notice, onChanged])
  return (
    <div className="space-y-4">
      <GoalReviewPanel ctl={ctl} snap={snap} />
      <PlanPanel ctl={ctl} snap={snap} />
      {/* Recommendations of the rules and the AI wait here for the expert; the plan versions fill the default scope. */}
      <RecommendationsPanel userId={userId} versions={snap.plan?.versions ?? NO_VERSIONS} />
    </div>
  )
}

export function PointBTab({ userId, canReview }: { userId: string; canReview: boolean }) {
  // A published / returned version changes what the client sees: the view below is reloaded.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  return (
    <div className="space-y-4">
      {canReview && <PlanWorkspace userId={userId} onChanged={reload} />}
      {/* Plan-fact of the approved version and the button «Пересчитать» (staff only, checked on the server). */}
      {canReview && <PlanFactPanel userId={userId} />}
      {/* The money of the client (level 2): the expert checks the assumptions and verifies them. */}
      {canReview && <FinmodelPanel userId={userId} />}
      {/* What the client calculated and saved in «Что если», read-only; a proposal arrives as a message. */}
      {canReview && <WhatIfSavedPanel userId={userId} />}
      {/* What the client sees: the SAME state as /client/point-b (R3, M3). */}
      <StaffPointBView url={`/api/giga-admin/users/${userId}/point-b`} reloadKey={reloadKey} actionPlanUserId={userId} />
    </div>
  )
}
