'use client'

import { useEffect, useState } from 'react'
import { ShareButton, type ShareReportType } from './ShareButton'

/**
 * Share buttons for a STAFF member (expert / admin) viewing a specific client.
 * The share / export API needs the VIEWED client's Supabase `companyId`, which
 * the expert pages don't carry in hand — they only know the client's user id.
 *
 * This resolves the company id via the existing expert dashboard endpoint
 * (`/api/expert/clients/<id>/dashboard` → data.company.id) and then renders one
 * ShareButton per report type. Renders nothing until the company id is known, so
 * a client without a company simply shows no buttons.
 */
export function ExpertClientShare({
  clientId,
  types = ['point_a', 'gri', 'point_b'],
  size = 'sm',
}: {
  /** The viewed client's Supabase user id (= the page's params.id). */
  clientId: string
  /** Which report links to offer (defaults to Точка А / GRI / Точка Б). */
  types?: ShareReportType[]
  size?: 'sm' | 'md'
}) {
  const [companyId, setCompanyId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(`/api/expert/clients/${clientId}/dashboard`)
        const json = (await res.json()) as {
          ok?: boolean
          data?: { company?: { id?: string } | null }
        }
        if (active && json?.ok && json.data?.company?.id) {
          setCompanyId(String(json.data.company.id))
        }
      } catch {
        /* leave null → buttons stay hidden */
      }
    })()
    return () => {
      active = false
    }
  }, [clientId])

  if (!companyId) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {types.map((type) => (
        <ShareButton
          key={type}
          type={type}
          companyId={companyId}
          size={size}
          triggerLabel
        />
      ))}
    </div>
  )
}

export default ExpertClientShare
