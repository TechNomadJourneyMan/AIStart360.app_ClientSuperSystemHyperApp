/**
 * components/access/FeatureGate.tsx — server gate of a paid PAGE (Round 2, R2-A).
 *
 * Wraps the content of Точка А / Точка Б / Рынок / полный GRI. The decision is
 * the one of the API (lib/access/decision.ts → 402): closed → the paywall is
 * rendered on the server and the section's own client code is not mounted, so
 * it requests no data (no spinner forever, no 402 in the browser console).
 * The open request of the user is read here too → the button shows «Заявка
 * отправлена» right away after a reload.
 *
 * No session → the children (middleware sends anonymous users to /login; the
 * API answers 401 anyway). Any failure of the decision fails CLOSED only for the
 * data: the API still gates; the page then shows its content's own error state.
 */
import type { ReactNode } from 'react'
import { getRequestUser } from '@/lib/request-user'
import { createServiceClient } from '@/lib/supabase-service'
import { getRequestAccess } from '@/lib/access/request-access'
import { findOpenAccessRequest } from '@/lib/access/upgrade-requests'
import type { PaidSection } from '@/lib/access/entitlements'
import Paywall from './Paywall'

export async function isPaidSectionOpen(feature: PaidSection): Promise<{ open: boolean; userId: string | null }> {
  const user = await getRequestUser()
  if (!user) return { open: true, userId: null }
  try {
    const access = await getRequestAccess(user.id)
    return { open: access.sections[feature], userId: user.id }
  } catch (err) {
    console.error('[FeatureGate] decision failed', feature, err instanceof Error ? err.message : err)
    return { open: true, userId: user.id }
  }
}

async function requested(userId: string): Promise<boolean | undefined> {
  try {
    return !!(await findOpenAccessRequest(createServiceClient(), userId))
  } catch {
    return undefined // the paywall reads it itself
  }
}

export default async function FeatureGate({
  feature,
  children,
  wrapperClassName = 'mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8',
}: {
  feature: PaidSection
  children: ReactNode
  /** Layout around the paywall (the section's own page chrome is not rendered). */
  wrapperClassName?: string
}) {
  const { open, userId } = await isPaidSectionOpen(feature)
  if (open || !userId) return <>{children}</>
  return (
    <main className={wrapperClassName}>
      <Paywall feature={feature} initialRequested={await requested(userId)} />
    </main>
  )
}
