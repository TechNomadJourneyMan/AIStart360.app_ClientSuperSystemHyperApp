export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PointBContainer from '@/components/point-b/PointBContainer'
import { isClientForPointB } from '@/components/point-b/pointBAccess'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'
import { getRequestUser } from '@/lib/request-user'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionRole } from '@/lib/api-identity'

export const metadata: Metadata = { title: 'Точка Б — Целевое состояние' }

// Goal-driven Point B. The dashboard layout supplies the sidebar/header chrome;
// the container fetches the session-scoped plan and renders every state.
// A client has ONE Point B page — the cabinet's (`/client/point-b`), which also owns the
// Pro paywall; this shell version is for staff (who are never gated).
export default async function PointBPage() {
  const user = await getRequestUser()
  if (user && isClientForPointB(await getSessionRole(createServerClient(), user.id))) {
    redirect('/client/point-b')
  }
  return (
    <>
      <div className="flex items-center justify-end px-4 pt-4">
        <ShareButtonAuto type="point_b" />
      </div>
      <PointBContainer />
    </>
  )
}
