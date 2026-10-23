'use client'

import { Suspense } from 'react'
import { SnapshotScreen } from '@/components/onboarding/express/SnapshotScreen'

/** «Снимок бизнеса» after the express flow (spec 2026-10-23 §7.3). */
export default function SurveySnapshotPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0c0e14]" />}>
      <SnapshotScreen />
    </Suspense>
  )
}
