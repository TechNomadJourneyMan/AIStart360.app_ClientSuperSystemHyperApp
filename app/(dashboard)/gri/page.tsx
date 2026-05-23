import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { OnboardingStatusBadges } from '@/components/dashboard/OnboardingStatusBadges'

export const metadata: Metadata = { title: 'GRI — Growth Readiness Index' }

const GRICalculator = dynamic(
  () => import('@/components/gri/calculator/GRICalculator'),
  {
    loading: () => (
      <div className="animate-pulse h-[600px] bg-white/[0.03] rounded-2xl m-4" />
    ),
  },
)

const GRIAssessment = dynamic(
  () => import('@/components/gri/assessment/GRIAssessment'),
  {
    loading: () => (
      <div className="animate-pulse h-[600px] bg-white/[0.03] rounded-2xl m-4" />
    ),
  },
)

export default function GriPage() {
  return (
    <>
      <div className="flex items-center justify-end gap-2 px-4 pt-4">
        <OnboardingStatusBadges />
      </div>
      <GRICalculator />
      <GRIAssessment />
    </>
  )
}
