export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import PointBContainer from '@/components/point-b/PointBContainer'

export const metadata: Metadata = { title: 'Точка Б — Целевое состояние' }

// Goal-driven Point B. The dashboard layout supplies the sidebar/header chrome;
// the container fetches the session-scoped plan and renders every state.
export default function PointBPage() {
  return <PointBContainer />
}
