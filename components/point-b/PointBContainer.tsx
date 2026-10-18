'use client'

import PlanWorkflowSection from './PlanWorkflowSection'
import PointBDetails from './PointBDetails'
import PointBPaywall from './PointBPaywall'
import OverviewTab from './tabs/OverviewTab'
import PointBTabs from './tabs/PointBTabs'
import ScenariosTab from './tabs/ScenariosTab'
import { usePointBState } from './usePointBState'

/**
 * Client container for Point B (plan Phase 2 Task 8): the plan status above, then three tabs.
 *   «Обзор»       — verdict, А → Б, trajectory with a corridor, what the data lacks
 *                   (preliminary automatic calculation, GET /api/v1/point-b/state);
 *   «Сценарии»    — three paces of the APPROVED plan version, or «Эксперт готовит сценарии»;
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
          details: <PointBDetails />,
        }}
      />
    </div>
  )
}
