/**
 * lib/runtime/role.ts — what this process is for (PORTAL_ROLE).
 *
 * The same build is deployed as two Railway services, the portal and the agents service
 * (docs/railway-agents-service.md), and this variable tells a process which of the two it is:
 *   unset, or anything else → 'all': the portal and the agent work in one process. The default, so
 *                             local development, tests and a single-service deployment are as before;
 *   'web'                   → the portal only: a queued agent task is handed to the agents service
 *                             (AGENTS_SERVICE_URL), nothing of the agent runtime executes here;
 *   'agents'                → agent work only: the queue, its maintenance loop and the agents digest.
 *
 * Only environment reads and Web APIs here: the module is imported by routes, the queue, the cron
 * schedule and the boot code alike, and must stay free of anything heavy.
 */

// Partial, like lib/runtime/platform.ts: Next's typings make NODE_ENV mandatory in ProcessEnv.
type Env = Partial<NodeJS.ProcessEnv>

export type PortalRole = 'all' | 'web' | 'agents'

/** PORTAL_ROLE, trimmed and lower-cased: 'web' or 'agents'; anything else (a typo included) is 'all'. */
export function portalRole(env: Env = process.env): PortalRole {
  const value = env.PORTAL_ROLE?.trim().toLowerCase()
  return value === 'web' || value === 'agents' ? value : 'all'
}

/** Does this process execute agent tasks and their maintenance? Everything but the web role. */
export function runsAgentWork(role: PortalRole = portalRole()): boolean {
  return role !== 'web'
}

/** Is this process the portal (pages, the Workflow queue, the portal's own cron jobs)? Everything but the agents role. */
export function servesWeb(role: PortalRole = portalRole()): boolean {
  return role !== 'agents'
}

/**
 * Where the agents service listens (AGENTS_SERVICE_URL, e.g. `http://agents.railway.internal:8080`),
 * ready to have a path appended: a valid http(s) URL without its trailing slash, else null. Only the
 * origin and the path are kept; a query, a fragment or credentials are not part of a service address.
 */
export function agentsServiceUrl(env: Env = process.env): string | null {
  const raw = env.AGENTS_SERVICE_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}
