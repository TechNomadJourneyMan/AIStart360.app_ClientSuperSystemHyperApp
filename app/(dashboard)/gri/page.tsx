import type { Metadata } from 'next'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { OnboardingStatusBadges } from '@/components/dashboard/OnboardingStatusBadges'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'
import { AskAiButton } from '@/components/ai-chat/AskAiButton'
import FeatureGate from '@/components/access/FeatureGate'

export const metadata: Metadata = { title: 'GRI — Growth Readiness Index' }

const GriPageShell = dynamic(() => import('@/components/gri/page/GriPageShell'), {
  loading: () => <div className="animate-pulse h-[600px] bg-white/[0.03] rounded-2xl m-4" />,
})

// Round 2 (R2-A): the full GRI is a paid section — closed → the one paywall
// (free: the express assessment of the survey and the mini-GRI). /gri/methodology stays open.
export default function GriPage() {
  return (
    <FeatureGate feature="gri_full" wrapperClassName="px-4 py-6">
      <div className="flex items-center justify-end gap-2 px-4 pt-4">
        {/* One AI chat over the company's data (components/ai-chat/ChatHost) */}
        <AskAiButton surface="gri" />
        <ShareButtonAuto type="gri" />
        <OnboardingStatusBadges />
      </div>
      {/* useSearchParams в GriPageShell требует Suspense-границу */}
      <Suspense fallback={null}>
        <GriPageShell />
      </Suspense>
    </FeatureGate>
  )
}
