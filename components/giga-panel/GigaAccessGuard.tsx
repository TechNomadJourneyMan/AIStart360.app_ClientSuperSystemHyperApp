'use client'

import { useEffect } from 'react'

/**
 * Runs on every render inside the admin-giga-panel layout.
 * The fact that this component mounts at all means the middleware
 * already validated the super_admin cookie — so we re-pin it on
 * every tick to prevent the main Providers from clearing it.
 */
export function GigaAccessGuard() {
  useEffect(() => {
    // Re-establish cookie with a 7-day expiry so it outlasts any session
    document.cookie = 'aistart360_role=super_admin; path=/; max-age=604800; SameSite=Lax'
  })

  return null
}
