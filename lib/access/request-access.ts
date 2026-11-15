/**
 * lib/access/request-access.ts — the access snapshot of the session user for
 * ONE server render (Round 2, R2-A). The cabinet layout (menu locks), the home
 * page (paywall cards) and the page gate (components/access/FeatureGate) read
 * the same decision (lib/access/decision.ts → resolveAccess) once per request.
 * Server Components only; route handlers call gateFeature / resolveFeature.
 */
import { createServerClient } from '@/lib/supabase-server'
import { requestCache } from '@/lib/request-cache'
import { resolveAccess, type AccessSnapshot } from './decision'

export const getRequestAccess = requestCache(async (userId: string): Promise<AccessSnapshot> => resolveAccess(createServerClient(), userId))
