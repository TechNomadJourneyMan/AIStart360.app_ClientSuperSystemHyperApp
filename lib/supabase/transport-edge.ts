/**
 * lib/supabase/transport-edge.ts — the Supabase transport of middleware.
 *
 * Middleware runs in the Edge runtime, whose global scope is its own: the wrapper instrumentation.ts
 * puts over `globalThis.fetch` on the Node server does not exist there. Everything middleware sends
 * to Supabase therefore goes through this one wrapper instead — the session client of
 * lib/supabase/middleware.ts and the plain PostgREST calls of the *-edge helpers.
 *
 * The wrapper is made on first use, not at import (the environment is read then), and probes the
 * private path at that moment without holding the request for the answer. Edge-safe.
 */
import { createSupabaseTransportFetch, type SupabaseTransportFetch } from './transport'

type FetchArgs = Parameters<typeof fetch>

let transport: SupabaseTransportFetch | null = null

export const edgeSupabaseFetch: typeof fetch = (...args: FetchArgs) => {
  if (!transport) {
    // The base is whatever `fetch` is when a request goes out, as with a bare fetch() call.
    transport = createSupabaseTransportFetch((...baseArgs: FetchArgs) => fetch(...baseArgs))
    void transport.probe()
  }
  return transport(...args)
}
