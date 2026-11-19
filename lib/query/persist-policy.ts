/**
 * Which React Query entries the root provider (app/providers.tsx) may persist to localStorage.
 *
 * Persisting makes data show instantly on the next visit — and keeps it in the browser for 24 h,
 * readable by the next person on a shared device before any refetch, and restored as «fresh»
 * (staleTime) so a reload shows the old state instead of asking the server. So user data never
 * goes there: goals and Point A (company data), the per-user status/entitlement answers, and the
 * owner CRM — the personal data of the owner's own customers (names, phones, e-mails, notes), whose
 * queue also changes with every logged touch and every sync.
 *
 * The roots are literals (no hook imports: this module is in every page's bundle);
 * tests/unit/query/persist-policy.test.ts checks them against the hooks' real query keys.
 */
export const NOT_PERSISTED_ROOTS: ReadonlySet<string> = new Set([
  'goals',
  'point-a-state',
  'onboarding-status', // hooks/useOnboardingStatus ONBOARDING_STATUS_KEY
  'gri-assessment-current', // hooks/useOnboardingStatus GRI_ASSESSMENT_KEY
  'access-me', // hooks/useEntitlements ACCESS_ME_KEY
  'crm', // hooks/useCrm crmKeys.all — every CRM query (today, clients, interactions, reminders)
])

/**
 * Bumped whenever the policy stops persisting something: a different buster drops every cache
 * persisted before (v3, 2026-11-18: the CRM base was persisted until then).
 */
export const PERSIST_BUSTER = 'v3'

/** dehydrateOptions.shouldDehydrateQuery: only successful queries outside the user-data roots. */
export function shouldPersistQuery(query: { queryKey: readonly unknown[]; state: { status: string } }): boolean {
  return query.state.status === 'success' && !NOT_PERSISTED_ROOTS.has(String(query.queryKey[0]))
}
