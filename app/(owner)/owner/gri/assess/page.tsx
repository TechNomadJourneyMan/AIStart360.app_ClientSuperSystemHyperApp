'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'

// Опросник смонтирован внутри owner-портала намеренно: путь /gri входит в
// ADMIN_PATHS и владельцу закрыт (middleware уводит его на /owner/dashboard),
// поэтому /owner/gri/assess — единственный доступный владельцу вход в
// диагностику. Способ монтирования тот же, что в components/gri/page/GriPageShell.
const GRIAssessment = dynamic(() => import('@/components/gri/assessment/GRIAssessment'), {
  loading: () => <div className="animate-pulse h-[400px] bg-white/[0.03] rounded-2xl" />,
})

export default function OwnerGriAssessPage() {
  const [saved, setSaved] = useState(false)

  const checkSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/gri/assessment', { credentials: 'include' })
      if (!res.ok) return
      const j = await res.json()
      const cur = j?.data?.current
      setSaved(typeof cur?.gri_index === 'number' && cur.gri_index > 0)
    } catch {
      /* оффлайн — баннер просто не появится */
    }
  }, [])

  // GRIAssessment шлёт 'gri:assessment-updated' на каждое изменение оценок,
  // поэтому источник правды — сервер: баннер «результат сохранён» показываем
  // только после того, как POST /api/v1/gri/assessment реально прошёл.
  useEffect(() => {
    void checkSaved()
    let timer: ReturnType<typeof setTimeout> | undefined
    const onUpdate = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void checkSaved(), 1200)
    }
    window.addEventListener('gri:assessment-updated', onUpdate)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('gri:assessment-updated', onUpdate)
    }
  }, [checkSaved])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">GRI-диагностика</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Growth Readiness Index · 7 блоков, самооценка по шкале 0–10
          </p>
        </div>
        <Link href="/owner/gri"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-on-surface-variant text-sm font-medium hover:text-on-surface hover:bg-white/[0.06] transition-colors">
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          К результатам GRI
        </Link>
      </div>

      {saved && (
        <div className="glass-card rounded-2xl p-4 border border-primary/20 bg-primary/[0.04] flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-xl">check_circle</span>
            <p className="text-sm text-on-surface">Результат диагностики сохранён — он уже виден на дашборде.</p>
          </div>
          <Link href="/owner/dashboard"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/20 transition-colors">
            <span className="material-symbols-outlined text-lg">dashboard</span>
            Открыть дашборд
          </Link>
        </div>
      )}

      <div id="gri-assessment">
        <GRIAssessment />
      </div>
    </div>
  )
}
