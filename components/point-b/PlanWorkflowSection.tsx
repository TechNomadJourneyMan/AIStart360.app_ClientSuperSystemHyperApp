'use client'

/**
 * components/point-b/PlanWorkflowSection.tsx — what the owner sees above the Point B
 * content about his plan: the status banner and a card per goal correction that
 * waits for an answer. The banner's state of preparation (R3) comes from the page state
 * (GET /api/v1/point-b/state → plan.prep); renders nothing until something honest can be said.
 */
import PlanStatusBanner from './PlanStatusBanner'
import GoalCorrectionCard from './GoalCorrectionCard'
import type { PlanPrepState } from './planPrep'
import type { ClientPlanController, ClientPlanSnapshot } from './planController'
import { usePointBPlan } from './usePointBPlan'

export function PlanWorkflowView({ snap, ctl, prep = null }: { snap: ClientPlanSnapshot; ctl: Pick<ClientPlanController, 'respond'>; prep?: PlanPrepState | null }) {
  if (!snap.loaded) return null
  const banner = snap.status === 'published' || (prep !== null && prep.kind !== 'published')
  if (!banner && snap.corrections.length === 0) return null
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
      {banner && <PlanStatusBanner status={snap.status} version={snap.version} prep={prep} />}
    </div>
  )
}

export default function PlanWorkflowSection({ prep = null }: { prep?: PlanPrepState | null }) {
  const { ctl, snap } = usePointBPlan()
  return <PlanWorkflowView snap={snap} ctl={ctl} prep={prep} />
}
