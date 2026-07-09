'use client'

/**
 * hooks/useEntitlements.ts — клиентский снимок прав доступа (Фаза 6).
 * Один GET /api/v1/access/me на маунт. Пока грузится или гейты выключены —
 * везде «разрешено» (сервер всё равно энфорсит платные роуты сам).
 */

import { useEffect, useState } from 'react'

export interface AccessMe {
  gatesEnabled: boolean
  tier: 'free' | 'pro'
  pdf_export: boolean
  ai_chat: boolean
  benchmarks: boolean
  griRunsUsed: number
  canRunFullGri: boolean
}

const OPEN: AccessMe = {
  gatesEnabled: false,
  tier: 'free',
  pdf_export: true,
  ai_chat: true,
  benchmarks: true,
  griRunsUsed: 0,
  canRunFullGri: true,
}

export function useEntitlements(): { access: AccessMe; loading: boolean } {
  const [access, setAccess] = useState<AccessMe>(OPEN)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/v1/access/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return
        if (!j.gatesEnabled) return // гейты выключены — остаёмся «всё открыто»
        setAccess({
          gatesEnabled: true,
          tier: j.entitlements?.tier === 'pro' ? 'pro' : 'free',
          pdf_export: Boolean(j.entitlements?.pdf_export),
          ai_chat: Boolean(j.entitlements?.ai_chat),
          benchmarks: Boolean(j.entitlements?.benchmarks),
          griRunsUsed: Number(j.griRunsUsed ?? 0),
          canRunFullGri: Boolean(j.canRunFullGri),
        })
      })
      .catch(() => {}) // сеть упала → открытое состояние; сервер защитит сам
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return { access, loading }
}
