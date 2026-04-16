import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Creates a Supabase client for use in Server Components, API Route Handlers,
 * and Server Actions. Uses @supabase/ssr with the anon key so that
 * auth.getUser() correctly reads the user's session from cookies.
 *
 * For privileged DB operations (bypassing RLS) use direct service-role REST
 * fetches in the route handler — do NOT use this client for those.
 */
export function createServerClient() {
  const cookieStore = cookies()

  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Route Handlers are read-only for cookies — safe to ignore
          }
        },
      },
    },
  )
}
