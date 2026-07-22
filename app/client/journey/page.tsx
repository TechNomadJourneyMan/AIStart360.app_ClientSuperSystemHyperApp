import { JourneyWorkspace } from '@/components/journey/Workspace'
import { parseJourneyDemoScenario } from '@/components/journey/demo-scenarios'

/** Authenticated alias for the isolated top-level experiment. */
export default function ClientJourneyPage({
  searchParams,
}: {
  searchParams?: { demo?: string | string[] }
}) {
  return <JourneyWorkspace initialDemoScenario={parseJourneyDemoScenario(searchParams?.demo)} />
}
