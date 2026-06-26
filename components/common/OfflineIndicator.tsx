'use client'

import { useEffect, useState } from 'react'

/**
 * Thin top banner shown when the browser goes offline. Reassures the user that
 * their input is kept locally (the survey autosaves to localStorage, and the
 * React Query cache is persisted) and will sync once the connection returns.
 */
export function OfflineIndicator() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-2 bg-amber-500/90 text-black text-[11px] sm:text-xs font-medium py-1.5 px-4 text-center"
    >
      <span className="material-symbols-outlined text-sm">cloud_off</span>
      Нет сети — данные сохраняются локально и отправятся, когда связь восстановится
    </div>
  )
}
