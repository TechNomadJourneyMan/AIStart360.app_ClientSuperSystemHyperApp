'use client'

import PlanWorkflowSection from './PlanWorkflowSection'
import PointBDetails from './PointBDetails'
import PointBPaywall from './PointBPaywall'
import FinmodelTab from './tabs/FinmodelTab'
import OverviewTab from './tabs/OverviewTab'
import PointBTabs from './tabs/PointBTabs'
import ScenariosTab from './tabs/ScenariosTab'
import WhatIfTab from './tabs/WhatIfTab'
import { usePointBState } from './usePointBState'

/**
 * Client container for Point B (plan Phase 2 Task 8, Ф3 Task 5): the plan status above, then five tabs.
 *   «Обзор»       — verdict, А → Б, trajectory with a corridor, what the data lacks
 *                   (preliminary automatic calculation, GET /api/v1/point-b/state);
 *   «Сценарии»    — three paces of the APPROVED plan version, or «Эксперт готовит сценарии»;
 *   «Что если»    — six calculators on the owner's own data (a calculation, not a recommendation, never changes the plan);
 *   «Финмодель»   — the money of the business (level 2): inputs, hints, origin badges;
 *   «Подробности» — the previous page as it was ({@link PointBDetails}), loaded on first open.
 * A failure of the state request stays inside the first two tabs.
 *
 * Mounted on all client-facing Point B surfaces so behaviour is identical no matter which
 * route the owner reaches (/client/point-b, /point-b).
 */
export default function PointBContainer() {
  const { ctl, snap } = usePointBState()

  // The tariff gate was turned on (or the tab was open before it): Pro placeholder, no data.
  if (snap.phase === 'locked') return <PointBPaywall />

  return (
    <div className="space-y-4">
      {/* The expert's plan: status banner and goal corrections that wait for the owner's answer. */}
      <PlanWorkflowSection />
      <PointBTabs
        panels={{
          overview: <OverviewTab snap={snap} onRetry={() => void ctl.load()} />,
          scenarios: <ScenariosTab snap={snap} onRetry={() => void ctl.load()} />,
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
