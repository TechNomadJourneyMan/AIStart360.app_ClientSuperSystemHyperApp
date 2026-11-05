/**
 * lib/runtime/platform.ts — which kind of runtime the portal is on.
 *
 * Vercel freezes a function once it has answered, so work after the response needs `waitUntil`
 * (VERCEL=1). A long-lived `next start` process (Railway) keeps running after the response, so
 * the same work can simply go on — it is switched on with PERSISTENT_SERVER=1 and tracked in
 * lib/background.ts so a SIGTERM can wait for it. Tests and local dev set neither flag and
 * start nothing behind the response.
 */

// Partial: Next's typings make NODE_ENV mandatory in ProcessEnv, which a test's `{ VERCEL: '1' }` is not.
type Env = Partial<NodeJS.ProcessEnv>

/** A long-lived server process (Railway): PERSISTENT_SERVER=1. */
export function isPersistentServer(env: Env = process.env): boolean {
  return env.PERSISTENT_SERVER === '1'
}

/** May work be started that outlives the HTTP response? Vercel (waitUntil) or a persistent server. */
export function canRunAfterResponse(env: Env = process.env): boolean {
  return env.VERCEL === '1' || isPersistentServer(env)
}
