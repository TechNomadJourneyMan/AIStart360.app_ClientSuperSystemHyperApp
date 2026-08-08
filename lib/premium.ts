/**
 * Which cabinet sections are shown as locked behind a paid plan.
 *
 * Previously each nav component carried its own hard-coded
 * `['/metrics', '/market', '/point-b']`, and the Sidebar's "promo code" field
 * unlocked them by POSTing the entered value to `/api/giga-admin/auth` — i.e.
 * the super-admin password doubled as the upgrade code, and a wrong guess was
 * indistinguishable from a failed admin login. That path is gone.
 *
 * The gate was always cosmetic: none of these routes enforce a plan on the
 * server, so a locked badge never actually kept anyone out of the page. Keep
 * that in mind before treating it as monetisation — it is a nav hint, not
 * access control. Real enforcement belongs in middleware plus the
 * `subscriptions` table.
 *
 * Default: nothing is locked. Set the env var to a comma-separated path list
 * to bring the badges back, e.g.
 *
 *   NEXT_PUBLIC_PREMIUM_LOCKED_PATHS=/metrics,/market,/point-b
 */
export const PREMIUM_LOCKED_PATHS: string[] = (
  process.env.NEXT_PUBLIC_PREMIUM_LOCKED_PATHS ?? ''
)
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)

/** The locked root a href belongs to, or undefined when it is freely available. */
export function premiumLockedRoot(href: string): string | undefined {
  return PREMIUM_LOCKED_PATHS.find((p) => href === p || href.startsWith(p + '/'))
}

/** Only clients ever see the lock; staff roles always have the full cabinet. */
export function isPremiumLocked(role: string, href: string): boolean {
  return role === 'client' && premiumLockedRoot(href) !== undefined
}
