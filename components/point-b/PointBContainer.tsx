'use client'

import { useEffect, useState } from 'react'
import { isTabKey, type PointBTabKey } from './overviewModel'
import PlanWorkflowSection from './PlanWorkflowSection'
import PointBDetails from './PointBDetails'
import PointBPaywall from './PointBPaywall'
import FinmodelTab from './tabs/FinmodelTab'
import OverviewTab from './tabs/OverviewTab'
import PointBTabs from './tabs/PointBTabs'
import RecommendationsTab from './tabs/RecommendationsTab'
import RoadmapTab from './tabs/RoadmapTab'
import ScenariosTab from './tabs/ScenariosTab'
import StrategyTab from './tabs/StrategyTab'
import WhatIfTab from './tabs/WhatIfTab'
import { usePointBState } from './usePointBState'

/**
 * Client container for Point B (plan Phase 2 Task 8, Ф3 Task 5, Ф5 Task 5, Ф6a Task 7): the plan status above, then eight tabs.
 *   «Обзор»       — verdict, А → Б, trajectory with a corridor, what the data lacks
 *                   (preliminary automatic calculation, GET /api/v1/point-b/state);
 *   «Сценарии»    — three paces of the APPROVED plan version, or «Эксперт готовит сценарии»;
 *   «Стратегия»   — strategies → initiatives → tasks of the approved plan with progress, and the impact × effort matrix;
 *   «Дорожная карта» — the same on a timeline by quarters, milestones, dependencies;
 *   «Рекомендации» — recommendations verified by an expert (who, when, for what), the count of those still checked;
 *   «Что если»    — six calculators on the owner's own data (a calculation, not a recommendation, never changes the plan);
 *   «Финмодель»   — the money of the business (level 2): inputs, hints, origin badges;
 *   «Подробности» — the previous page as it was ({@link PointBDetails}), loaded on first open.
 * A failure of the state request stays inside the first two tabs.
 *
 * Mounted on all client-facing Point B surfaces so behaviour is identical no matter which
 * route the owner reaches (/client/point-b, /point-b).
 *
 * A deep link `?tab=<key>` (an invite or a pop-up «Открыть» from another page of the cabinet) opens that tab. The
 * address is read after mount (no `useSearchParams`, so the page needs no Suspense boundary and the server render
 * stays on «Обзор»).
 */
export default function PointBContainer() {
  const { ctl, snap } = usePointBState()
  const [deepTab, setDeepTab] = useState<PointBTabKey | null>(null)
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (isTabKey(tab) && tab !== 'overview') setDeepTab(tab)
  }, [])

  // The tariff gate was turned on (or the tab was open before it): Pro placeholder, no data.
  if (snap.phase === 'locked') return <PointBPaywall />

  return (
    <div className="space-y-4">
      {/* The expert's plan: status banner and goal corrections that wait for the owner's answer. */}
      <PlanWorkflowSection />
      <PointBTabs
        // A deep link remounts the strip once, on the asked tab.
        key={deepTab ?? 'overview'}
        initialTab={deepTab ?? 'overview'}
        panels={{
          overview: <OverviewTab snap={snap} onRetry={() => void ctl.load()} />,
          scenarios: <ScenariosTab snap={snap} onRetry={() => void ctl.load()} />,
          // The tree of the approved plan version with the live progress of its tasks, and the same tree on a timeline.
          strategy: <StrategyTab snap={snap} onRetry={() => void ctl.load()} />,
          roadmap: <RoadmapTab snap={snap} onRetry={() => void ctl.load()} />,
          // Only what an expert verified; the pending ones are a count, never a text.
          recs: <RecommendationsTab snap={snap} onRetry={() => void ctl.load()} />,
          // Calculates only: nothing here changes the plan.
          whatif: <WhatIfTab state={snap} />,
          // A saved finmodel recalculates the overview and the scenarios from the new money.
          finmodel: <FinmodelTab onSaved={() => void ctl.load()} />,
          details: <PointBDetails />,
        }}
      />
    </div>
  )
}
