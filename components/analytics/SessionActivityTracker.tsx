'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import ActivityTracker from './ActivityTracker'

/**
 * ActivityTracker for surfaces that are also open to anonymous visitors
 * (/gri-free, /r/[token], /journey): mounts only when a Supabase session
 * exists — anonymous views are not tracked (the events API would reject them).
 */
export default function SessionActivityTracker({ pageAlias }: { pageAlias?: string }) {
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    let alive = true
    try {
      void createClient().auth.getSession()
        .then(({ data }) => { if (alive) setSignedIn(!!data.session) })
        .catch(() => {})
    } catch {
      /* no Supabase config (tests / preview) — stay anonymous */
    }
    return () => { alive = false }
  }, [])

  return signedIn ? <ActivityTracker pageAlias={pageAlias} /> : null
}
