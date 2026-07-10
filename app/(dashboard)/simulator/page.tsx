export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import SimulatorClient from '@/components/simulator/SimulatorClient'

export const metadata: Metadata = { title: 'Симулятор' }

// Business simulator (what-if scenarios). Server shell only: the dashboard
// layout supplies the chrome; the form, POST /api/v1/simulator and the saved
// simulations list all live in the client component.
export default function SimulatorPage() {
  return <SimulatorClient />
}
