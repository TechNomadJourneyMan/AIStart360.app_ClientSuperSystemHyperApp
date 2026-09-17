'use client'

import { useEffect, useState } from 'react'

/**
 * Polls the maintenance status. When the works end, sends the user back to
 * the cabinet with a full page load (no stale client-router redirect).
 */
export default function MaintenanceWatcher({ active }: { active: boolean }) {
  const [reopened, setReopened] = useState(!active)

  useEffect(() => {
    if (reopened) return
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/v1/platform/maintenance', { cache: 'no-store' })
        const d = await r.json()
        if (d?.ok && !d.enabled) setReopened(true)
      } catch {
        /* keep waiting */
      }
    }, 10_000)
    return () => clearInterval(id)
  }, [reopened])

  useEffect(() => {
    if (!reopened || !active) return
    // Middleware caches the switch for a few seconds — wait it out, then go.
    const t = setTimeout(() => window.location.assign('/client/home'), 6_000)
    return () => clearTimeout(t)
  }, [reopened, active])

  if (reopened && active) {
    return <p className="mt-4 text-sm text-[#6effc0]">Работы завершены — возвращаем вас в кабинет…</p>
  }
  return null
}
