export const dynamic = "force-dynamic"

import type { Metadata } from 'next'

import { IntelligenceClient } from '@/components/insights/IntelligenceClient'

// Titled to match the sidebar entry «Разведка» (lib/navigation.ts:34) — the
// screen used to call itself «Аналитический центр», so clicking one name landed
// you on another.
export const metadata: Metadata = { title: 'Разведка' }

export default function IntelligencePage() {
  return <IntelligenceClient />
}
