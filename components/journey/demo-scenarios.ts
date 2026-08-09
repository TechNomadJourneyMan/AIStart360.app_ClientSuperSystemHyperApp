import { afterFactsConfirmed, runLocalTurn } from './demo-machine'
import { createEmptyWorkspace, type JourneyWorkspaceView } from './model'
import { journeyStateSchema } from '@/lib/journey/schema'
import myhonorProfile from '@/lib/demo/myhonor-public-profile.json'

/**
 * Public demo scenarios are an explicit allowlist. They are not a mechanism
 * for accepting arbitrary business data from a URL.
 */
export type JourneyDemoScenario = 'honor'

/**
 * Converts the value supplied by a route query to a safe, allowlisted demo
 * scenario. Repeated query values are rejected rather than picking one
 * implicitly.
 */
export function parseJourneyDemoScenario(
  value: string | string[] | undefined,
): JourneyDemoScenario | undefined {
  if (Array.isArray(value)) {
    if (value.length !== 1) return undefined
    value = value[0]
  }

  if (typeof value !== 'string') return undefined

  switch (value.trim().toLowerCase()) {
    case 'honor':
    case 'myhonor':
    case 'myhonor.shop':
      return 'honor'
    default:
      return undefined
  }
}

/**
 * Keeps a shared public scenario separate from the visitor's usual Journey
 * identity. It deliberately stores no credential or source business data.
 */
export function journeyDemoIdentityStorageKey(scenario: JourneyDemoScenario): string {
  return `aistart360:journey:demo:identity:v1:${scenario}`
}

/**
 * Builds a transparent, deterministic local Journey state for a public demo.
 * The normal local discovery -> fact confirmation -> Point B pipeline is used
 * so the result follows the same typed widget registry and schema checks as
 * the interactive fallback.
 */
export function createJourneyDemoScenarioState(
  scenario: JourneyDemoScenario,
  workspaceId: string,
): JourneyWorkspaceView {
  if (scenario !== 'honor') {
    throw new Error('Unsupported Journey demo scenario')
  }

  const discovered = runLocalTurn(
    createEmptyWorkspace(workspaceId),
    myhonorProfile.description,
  )
  const pointA = afterFactsConfirmed({
    ...discovered,
    companyName: myhonorProfile.companyName,
    facts: discovered.facts.map((fact) => ({ ...fact, status: 'confirmed' as const })),
  })
  const pointB = runLocalTurn(pointA, myhonorProfile.testGoal)

  return journeyStateSchema.parse({
    ...pointB,
    companyName: myhonorProfile.companyName,
  })
}
