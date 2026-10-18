'use client'

/**
 * components/point-b/PlanWorkflowSection.tsx — what the owner sees above the Point B
 * content about the expert's plan: the status banner and a card per goal correction that
 * waits for an answer. Renders nothing until the plan answer is in and nothing when there
 * is nothing to say.
 */
import PlanStatusBanner from './PlanStatusBanner'
import GoalCorrectionCard from './GoalCorrectionCard'
import type { ClientPlanController, ClientPlanSnapshot } from './planController'
import { usePointBPlan } from './usePointBPlan'

export function PlanWorkflowView({ snap, ctl }: { snap: ClientPlanSnapshot; ctl: Pick<ClientPlanController, 'respond'> }) {
  if (!snap.loaded || (snap.status === 'none' && snap.corrections.length === 0)) return null
  return (
    <div className="space-y-3">
      {snap.corrections.map((c) => (
        <GoalCorrectionCard
          key={c.id}
          correction={c}
          busy={snap.responding.includes(c.id)}
          error={snap.errors[c.id] ?? null}
          onRespond={(accept) => void ctl.respond(c.id, accept)}
        />
      ))}
      <PlanStatusBanner status={snap.status} version={snap.version} />
    </div>
  )
}

export default function PlanWorkflowSection() {
  const { ctl, snap } = usePointBPlan()
  return <PlanWorkflowView snap={snap} ctl={ctl} />
}
