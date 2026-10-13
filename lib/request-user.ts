import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase-server'
import { requestCache } from '@/lib/request-cache'

/**
 * The signed-in user of the current server render, verified with Supabase Auth
 * (`auth.getUser()` — a server round trip, exactly as before).
 *
 * Deduplicated per request: the cabinet layout, the page and server child
 * components used to call `getUser()` each, i.e. 2–3 identical Auth round
 * trips per page load. Now the first caller makes the request and the others
 * reuse its result within the same render only.
 *
 * Use it in Server Components. Route handlers keep their own `getUser()`.
 */
export const getRequestUser = requestCache(async (): Promise<User | null> => {
  const { data } = await createServerClient().auth.getUser()
  return data?.user ?? null
})
