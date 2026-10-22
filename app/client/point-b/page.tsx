'use client'

import PointBContainer from '@/components/point-b/PointBContainer'
import PointBAccessGate from '@/components/point-b/PointBAccessGate'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'

/**
 * /client/point-b — Point B inside the cabinet shell: the menu, profile and
 * sign-out come from app/client/layout.tsx (ClientNav); the page keeps only
 * its own action («Поделиться»).
 */
export default function ClientPointBPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-headline text-xl font-bold text-on-surface sm:text-2xl">Точка Б</h1>
        <PointBAccessGate pending={null} locked={null}><ShareButtonAuto type="point_b" /></PointBAccessGate>
      </div>
      <PointBAccessGate>
        <PointBContainer />
      </PointBAccessGate>
    </main>
  )
}
