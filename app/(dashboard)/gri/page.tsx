import type { Metadata } from 'next'
import GRICalculator from '@/components/gri/calculator/GRICalculator'

export const metadata: Metadata = { title: 'GRI — Growth Readiness Index' }

export default function GriPage() {
  return <GRICalculator />
}
