'use client'

/**
 * Giga-panel access is gated server-side by a personal Supabase session
 * (middleware + lib/admin/giga-actor.ts); the break-glass cookie is gone.
 *
 * The previous implementation re-pinned an UNSIGNED `aistart360_role=super_admin`
 * cookie on every render to keep itself "alive". That is now both impossible
 * (the real gate is httpOnly) and unsafe (an unsigned string is forgeable and
 * no longer grants access). It has been removed; this component is intentionally
 * a no-op so existing mount points keep working.
 */
export function GigaAccessGuard() {
  return null
}
