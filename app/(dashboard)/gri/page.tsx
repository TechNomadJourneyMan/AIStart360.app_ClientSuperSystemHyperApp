import type { Metadata } from 'next'
import GRICalculator from '@/components/gri/calculator/GRICalculator'
import { GriStrategyPanel } from '@/components/gri/GriStrategyPanel'

export const metadata: Metadata = { title: 'GRI — Growth Readiness Index' }

export default function GriPage() {
  return (
    <div className="space-y-8">
      <GRICalculator />
      <GriStrategyPanel />
    </div>
  )
}
