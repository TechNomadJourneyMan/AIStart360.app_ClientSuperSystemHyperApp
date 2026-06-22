export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import PointBContainer from '@/components/point-b/PointBContainer'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'

export const metadata: Metadata = { title: 'Точка Б — Целевое состояние' }

// Goal-driven Point B. The dashboard layout supplies the sidebar/header chrome;
// the container fetches the session-scoped plan and renders every state.
export default function PointBPage() {
  return (
    <>
      <div className="flex items-center justify-end px-4 pt-4">
        <ShareButtonAuto type="point_b" />
      </div>
      <PointBContainer />
    </>
  )
}
