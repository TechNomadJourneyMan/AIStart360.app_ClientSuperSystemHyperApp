/**
 * lib/inngest-target.ts — where the Inngest client sends events and which keys it uses; no client
 * here, so modules that only ask «is Inngest there?» do not load the SDK (and tests that stub
 * @/lib/inngest keep working). The client itself is lib/inngest.ts.
 *
 *   • INNGEST_SELF_HOSTED_URL set → our own Inngest server on Railway (self-hosted, service `inngest`),
 *     keys INNGEST_SELF_EVENT_KEY / INNGEST_SELF_SIGNING_KEY (hex, as the server is started with);
 *   • otherwise → Inngest Cloud (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY), as before 2026-11-15.
 */
export interface InngestTarget {
  selfHostedUrl: string | null
  eventKey?: string
  signingKey?: string
}

export function inngestTarget(env: NodeJS.ProcessEnv = process.env): InngestTarget {
  const url = env.INNGEST_SELF_HOSTED_URL?.trim()
  if (!url) return { selfHostedUrl: null }
  return {
    selfHostedUrl: url.replace(/\/+$/, ''),
    eventKey: env.INNGEST_SELF_EVENT_KEY?.trim() || undefined,
    signingKey: env.INNGEST_SELF_SIGNING_KEY?.trim() || undefined,
  }
}

/**
 * Events can be delivered somewhere: the self-hosted server, the cloud (an event key) or the local
 * dev server. When false, callers run their work inline instead (lib/point-a/recalc-queue.ts …).
 */
export function inngestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return inngestTarget(env).selfHostedUrl !== null || Boolean(env.INNGEST_EVENT_KEY) || env.INNGEST_DEV === '1'
}
