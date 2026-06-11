'use client'

/**
 * Giga-panel access is gated by the HMAC-SIGNED, httpOnly `aistart360_giga`
 * cookie set by /api/giga-admin/auth (audit A2b). That cookie:
 *   - cannot be read or written from client JS (httpOnly), and
 *   - is NOT touched by the app's normal-user logout/Providers, which only
 *     clear the separate `aistart360_role` cookie.
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
