import * as React from 'react'

/**
 * Per-request memoisation for Server Components (React `cache`).
 *
 * A page render runs the layout and the page (and server child components) in
 * one request; without this each of them repeated the same Supabase reads
 * (auth.getUser, platform sections, user facts). `cache` keeps one result per
 * argument list for the lifetime of a single server render, so nothing leaks
 * between requests or users.
 *
 * `React.cache` exists in the React build Next.js uses for Server Components.
 * Outside a render (route handlers, server actions, vitest) it is either
 * missing or a pass-through, so behaviour there is unchanged: every call runs.
 */
type AnyFn = (...args: any[]) => any

const reactCache = (React as unknown as { cache?: <T extends AnyFn>(fn: T) => T }).cache

export function requestCache<T extends AnyFn>(fn: T): T {
  return typeof reactCache === 'function' ? reactCache(fn) : fn
}
