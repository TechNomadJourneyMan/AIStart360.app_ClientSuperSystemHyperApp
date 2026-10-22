/**
 * lib/route-progress.ts — rules of the global page-loading bar (PO
 * 2026-10-22, п. 3: «показывать статус загрузки, чтобы пользователь знал, что
 * страница загружается и не зависает»).
 *
 * The bar itself is the existing nextjs-toploader (app/layout.tsx): it starts on
 * link clicks and finishes when the new URL is committed. This module adds
 * what it lacks, as pure functions so they are testable without a browser:
 *  - `shouldStartProgress` — whether a programmatic navigation (router.push /
 *    replace) is a page change worth a bar (not a hash jump, not the same URL,
 *    not another site);
 *  - `createProgressWatchdog` — a fallback: a bar that was started but never
 *    finished (a cancelled click, a navigation the router dropped) is closed
 *    after `PROGRESS_FALLBACK_MS`, so the page never looks stuck forever.
 */

/** A bar still running after this long is closed (the page has either loaded or failed). */
export const PROGRESS_FALLBACK_MS = 15_000
/** How often the watchdog looks at the bar. */
export const PROGRESS_WATCH_INTERVAL_MS = 1_000

function toUrl(href: string, base: string): URL | null {
  try {
    return new URL(href, base)
  } catch {
    return null
  }
}

/**
 * True when navigating from `currentHref` to `targetHref` loads another page of
 * this site: same origin, and a different path or query. Hash-only changes,
 * the same URL, other origins and non-http schemes do not start the bar.
 */
export function shouldStartProgress(currentHref: string, targetHref: string): boolean {
  const current = toUrl(currentHref, 'http://localhost')
  if (!current) return false
  const target = toUrl(targetHref, current.href)
  if (!target || !/^https?:$/.test(target.protocol)) return false
  if (target.origin !== current.origin) return false
  return target.pathname !== current.pathname || target.search !== current.search
}

export interface ProgressWatchdogDeps {
  isStarted: () => boolean
  done: () => void
  now: () => number
  timeoutMs?: number
}

export interface ProgressWatchdog {
  /** Look at the bar once (called on an interval). Returns true when it closed a stuck bar. */
  tick: () => boolean
  /** The navigation finished — forget the start time. */
  reset: () => void
}

export function createProgressWatchdog(deps: ProgressWatchdogDeps): ProgressWatchdog {
  const timeout = deps.timeoutMs ?? PROGRESS_FALLBACK_MS
  let since: number | null = null
  return {
    tick() {
      if (!deps.isStarted()) {
        since = null
        return false
      }
      const t = deps.now()
      if (since === null) {
        since = t
        return false
      }
      if (t - since >= timeout) {
        deps.done()
        since = null
        return true
      }
      return false
    },
    reset() {
      since = null
    },
  }
}
