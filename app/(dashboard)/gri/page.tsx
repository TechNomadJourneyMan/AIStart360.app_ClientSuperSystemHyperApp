import type { Metadata } from 'next'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { OnboardingStatusBadges } from '@/components/dashboard/OnboardingStatusBadges'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'

export const metadata: Metadata = { title: 'GRI — Growth Readiness Index' }

const GriPageShell = dynamic(() => import('@/components/gri/page/GriPageShell'), {
  loading: () => <div className="animate-pulse h-[600px] bg-white/[0.03] rounded-2xl m-4" />,
})

export default function GriPage() {
  return (
    <>
      <div className="flex items-center justify-end gap-2 px-4 pt-4">
        <ShareButtonAuto type="gri" />
        <OnboardingStatusBadges />
      </div>
      {/* useSearchParams в GriPageShell требует Suspense-границу */}
      <Suspense fallback={null}>
        <GriPageShell />
      </Suspense>
    </>
  )
}
