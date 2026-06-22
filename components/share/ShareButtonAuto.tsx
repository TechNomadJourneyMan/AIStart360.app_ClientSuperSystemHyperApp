'use client'

import { useEffect, useState } from 'react'
import { ShareButton, type ShareReportType } from './ShareButton'

/**
 * Share button that resolves the CURRENT user's company id on its own (via
 * GET /api/v1/onboarding/company — session-scoped), so a page that doesn't
 * already have `companyId` in hand can drop it in without prop drilling.
 *
 * Renders nothing until the company id is known, then defers to ShareButton.
 */
export function ShareButtonAuto({
  type,
  size = 'sm',
  className,
}: {
  type: ShareReportType
  size?: 'sm' | 'md'
  className?: string
}) {
  const [companyId, setCompanyId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/v1/onboarding/company')
        const json = (await res.json()) as { ok?: boolean; data?: { id?: string } | null }
        if (active && json?.ok && json.data?.id) {
          setCompanyId(String(json.data.id))
        }
      } catch {
        /* leave companyId null → button stays hidden */
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (!companyId) return null

  return (
    <ShareButton type={type} companyId={companyId} size={size} className={className} />
  )
}

export default ShareButtonAuto
