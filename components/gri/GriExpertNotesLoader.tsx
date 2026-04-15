'use client'

import { useState, useEffect } from 'react'
import ExpertNotesPanel from './ExpertNotesPanel'

interface GriExpertNotesLoaderProps {
  blockId: string
  blockLabel: string
  userId: string
  userRole: string | null
}

export default function GriExpertNotesLoader({
  blockId,
  blockLabel,
  userId,
  userRole,
}: GriExpertNotesLoaderProps) {
  const [initialNote, setInitialNote] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!userId) return

    fetch(`/api/v1/gri/expert-notes?user_id=${encodeURIComponent(userId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.ok && json.data?.notes?.[blockId]) {
          setInitialNote(json.data.notes[blockId].note)
        } else {
          setInitialNote('')
        }
        setLoaded(true)
      })
      .catch(() => {
        setInitialNote('')
        setLoaded(true)
      })
  }, [userId, blockId])

  if (!loaded) return null

  return (
    <ExpertNotesPanel
      blockId={blockId}
      blockLabel={blockLabel}
      userId={userId}
      userRole={userRole}
      initialNote={initialNote}
    />
  )
}
