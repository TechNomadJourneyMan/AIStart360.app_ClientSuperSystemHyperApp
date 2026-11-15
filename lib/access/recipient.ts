/**
 * lib/access/recipient.ts — the paid-section decision for the RECIPIENT of a
 * notice (R2-A, ревью L-6): background code without a session (notifications,
 * the survey completion notice) asks «is Точка А open for this user?» with the
 * service role. Staff are not considered (the recipient is a client); any
 * failure → closed (no score / no paywall link is sent by mistake).
 */
import { createServiceClient } from '@/lib/supabase-service'
import { resolveFeature } from './decision'
import type { PaidSection } from './entitlements'

export async function sectionClosedFor(userId: string, section: PaidSection): Promise<boolean> {
  try {
    return !(await resolveFeature(createServiceClient(), userId, section)).allowed
  } catch {
    return true
  }
}

export const pointAClosedFor = (userId: string): Promise<boolean> => sectionClosedFor(userId, 'point_a')
