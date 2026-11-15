import { Inngest } from 'inngest'
import { inngestTarget } from '@/lib/inngest-target'

export { inngestEnabled, inngestTarget, type InngestTarget } from '@/lib/inngest-target'

/**
 * lib/inngest.ts — the Inngest client of the portal.
 *
 * Two places the client can talk to:
 *   • our own Inngest server on Railway (self-hosted, `inngest start`, service `inngest`) —
 *     when INNGEST_SELF_HOSTED_URL is set, e.g. http://inngest.railway.internal:8288. Its keys
 *     are INNGEST_SELF_EVENT_KEY and INNGEST_SELF_SIGNING_KEY (hex, the same values the server is
 *     started with). The client never falls back to the cloud while this is set: the base URL,
 *     the keys and «not dev mode» are all explicit;
 *   • Inngest Cloud (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY) — what ran before 2026-11-15, when
 *     the cloud plan ran out and Inngest stopped calling the portal.
 *
 * Switching back is unsetting INNGEST_SELF_HOSTED_URL: the cloud variables are left in place.
 */
function clientOptions(env: NodeJS.ProcessEnv = process.env): ConstructorParameters<typeof Inngest>[0] {
  const target = inngestTarget(env)
  if (!target.selfHostedUrl) return { id: 'aistart360' }
  return {
    id: 'aistart360',
    baseUrl: target.selfHostedUrl,
    isDev: false,
    ...(target.eventKey ? { eventKey: target.eventKey } : {}),
    ...(target.signingKey ? { signingKey: target.signingKey } : {}),
  }
}

/** For tests: the options the client is built with under `env`. */
export const __inngestClientOptions = clientOptions

export const inngest = new Inngest(clientOptions())
