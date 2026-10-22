'use client'

import { useEffect } from 'react'
import PointBView from '@/components/point-b/PointBView'
import type { PointBV2 } from '@/lib/point-b/engine'
import type { PlanVersionRow } from '@/lib/point-b/plan/types'
import { ErrorState, useGigaQuery } from '../kit'
import { FinmodelPanel } from './point-b/FinmodelPanel'
import { GoalReviewPanel } from './point-b/GoalReviewPanel'
import { PlanPanel } from './point-b/PlanPanel'
import { RecommendationsPanel } from './point-b/RecommendationsPanel'
import { WhatIfSavedPanel } from './point-b/WhatIfSavedPanel'
import { usePlanController } from './point-b/usePlanController'

/**
 * Точка Б клиента: тот же расчёт, что видит клиент, плюс работа эксперта по плану —
 * проверка целей и версии плана (черновик → на одобрение → одобрена). Прямой записи
 * «корректировки» больше нет: любой текст эксперта — это версия плана, и клиент видит
 * его только после одобрения Admin / Super Admin. Работать с планом может только тот,
 * у кого есть clients.review. Там же — «Финмодель» клиента: проверка допущений (деньги, расходы,
 * долги) и подтверждение значений, и сохранённые клиентом «что если» (только чтение).
 * И «Рекомендации клиента»: очередь проверки рекомендаций правил и ИИ — клиент видит только подтверждённые.
 */

const NO_VERSIONS: PlanVersionRow[] = []

interface Version { id: string; expert_notes: string; author_name: string | null; is_approved: boolean; created_at: string }
interface PointBData { pointB: PointBV2 | null; reason: string | null; version: Version | null }

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
  const { data, error, loading, reload } = useGigaQuery<{ data: PointBData }>(`/api/giga-admin/users/${userId}/point-b`)
  const d = data?.data

  return (
    <div className="space-y-4">
      {canReview && <PlanWorkspace userId={userId} onChanged={reload} />}
      {/* The money of the client (level 2): the expert checks the assumptions and verifies them. */}
      {canReview && <FinmodelPanel userId={userId} />}
      {/* What the client calculated and saved in «Что если», read-only; a proposal arrives as a message. */}
      {canReview && <WhatIfSavedPanel userId={userId} />}
      <ErrorState error={error} onRetry={reload} />
      {!error && (
        <PointBView
          pointB={d?.pointB ?? null}
          loading={loading && !d}
          reason={d?.reason ?? null}
          onRecalculate={reload}
          actionPlanUserId={userId}
          expertNote={canReview ? null : d?.version ?? null}
        />
      )}
    </div>
  )
}
