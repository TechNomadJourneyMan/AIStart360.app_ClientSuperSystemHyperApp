'use client'

/**
 * components/point-b/PointBAccessGate.tsx — wraps the client Point B content.
 * Locked (gates on, no `point_b`) → the paywall and NOTHING of the client's data
 * is requested (the children are not mounted); loading → a neutral skeleton so a
 * free account never flashes the page; open → the children.
 */
import type { ReactNode } from 'react'
import { useEntitlements } from '@/hooks/useEntitlements'
import PointBPaywall from './PointBPaywall'
import { resolvePointBAccess } from './pointBAccess'

interface Props {
  children: ReactNode
  /** Drawn while the answer is loading (default: a skeleton). */
  pending?: ReactNode
  /** Drawn when locked (default: the paywall). `null` hides the slot, e.g. a header button. */
  locked?: ReactNode
}

export default function PointBAccessGate({ children, pending, locked }: Props) {
  const { access, loading } = useEntitlements()
  const state = resolvePointBAccess({ loading, gatesEnabled: access.gatesEnabled, pointB: access.point_b })
  if (state === 'loading') {
    return pending !== undefined
      ? <>{pending}</>
      : <div className="h-40 animate-pulse rounded-2xl bg-surface-container/60" role="status" aria-label="Загрузка" />
  }
  if (state === 'locked') return locked !== undefined ? <>{locked}</> : <PointBPaywall />
  return <>{children}</>
}
