'use client'

/**
 * Shared reads of small per-user endpoints that several components on one
 * screen need at the same time.
 *
 * Before: the sidebar, the mobile nav, the status badges, the quick pills and
 * the growth hero each fetched GET /api/v1/onboarding/status on mount (up to
 * five identical requests per /dashboard load, each one an Auth round trip +
 * two DB reads on the server), and GET /api/v1/gri/assessment twice.
 *
 * Now they go through one react-query key each: requests made while another
 * is in flight are merged, and a result younger than SHARED_STALE_MS is
 * reused. A component that mounts later (next navigation) still refetches,
 * as before; the cache is in memory only (keys are excluded from the
 * localStorage persister in app/providers.tsx — user data must not outlive
 * the session on a shared device; logout reloads the page).
 */

import { useQuery, type QueryClient } from '@tanstack/react-query'

/** Long enough to merge the mounts of one page load, short enough to stay fresh. */
export const SHARED_STALE_MS = 3_000

export interface OnboardingStatus {
  survey: {
    completed_steps: number
    total_steps: number
    percent: number
    is_complete: boolean
    current_goal_12m: string | null
    current_goal_3y: string | null
    /** Current monthly revenue typed on survey step 1 (₸), null when unknown. */
    current_revenue_month?: number | null
  }
  documents: { count: number; has_files: boolean }
}

export const ONBOARDING_STATUS_KEY = ['onboarding-status'] as const
export const GRI_ASSESSMENT_KEY = ['gri-assessment-current'] as const

/** `data` of GET /api/v1/onboarding/status, or null when the API says no. Network errors throw. */
export async function fetchOnboardingStatus(): Promise<OnboardingStatus | null> {
  const res = await fetch('/api/v1/onboarding/status', { credentials: 'include' })
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: OnboardingStatus } | null
  return j?.ok && j.data ? j.data : null
}

/** Envelope of GET /api/v1/gri/assessment (`{ ok, data: { current, history } }`), or null on an HTTP error. */
export async function fetchGriAssessmentEnvelope(): Promise<GriAssessmentEnvelope | null> {
  const res = await fetch('/api/v1/gri/assessment', { credentials: 'include' })
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as GriAssessmentEnvelope | null
}

export interface GriAssessmentEnvelope {
  ok?: boolean
  data?: {
    current?: { gri_index?: number; section_avgs?: Record<string, number>; created_at?: string } | null
  } | null
}

const sharedOptions = {
  staleTime: SHARED_STALE_MS,
  // Same as the old mount-only fetches: no retries, no refetch on tab focus.
  retry: false,
  refetchOnWindowFocus: false,
} as const

export function useOnboardingStatus() {
  return useQuery({ queryKey: ONBOARDING_STATUS_KEY, queryFn: fetchOnboardingStatus, ...sharedOptions })
}

export function useGriAssessmentEnvelope() {
  return useQuery({ queryKey: GRI_ASSESSMENT_KEY, queryFn: fetchGriAssessmentEnvelope, ...sharedOptions })
}

/** Imperative variants (for loaders that combine several requests). */
export function getOnboardingStatus(qc: QueryClient): Promise<OnboardingStatus | null> {
  return qc.fetchQuery({ queryKey: ONBOARDING_STATUS_KEY, queryFn: fetchOnboardingStatus, staleTime: SHARED_STALE_MS, retry: false })
}

export function getGriAssessmentEnvelope(qc: QueryClient): Promise<GriAssessmentEnvelope | null> {
  return qc.fetchQuery({ queryKey: GRI_ASSESSMENT_KEY, queryFn: fetchGriAssessmentEnvelope, staleTime: SHARED_STALE_MS, retry: false })
}
