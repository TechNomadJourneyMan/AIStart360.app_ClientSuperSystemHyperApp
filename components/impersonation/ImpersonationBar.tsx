'use client'

import { useEffect, useState } from 'react'

interface Props { mode: 'view' | 'edit'; target: string; admin: string; expiresAt: number }

function left(ms: number): string {
  if (ms <= 0) return '0:00'
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function ImpersonationBar({ mode, target, admin, expiresAt }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (expiresAt && now >= expiresAt) window.location.reload()
  }, [now, expiresAt])

  const exit = async () => {
    setLeaving(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/impersonation/exit', { method: 'POST' })
      const json = await res.json().catch(() => null)
      window.location.href = json?.redirect || '/admin-giga-panel'
    } catch {
      setLeaving(false)
      setError('Не удалось выйти. Повторите.')
    }
  }

  return (
    <>
      {/* Frame around the viewport: impossible to miss which account this is. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[95] border-[3px] border-amber-400/80" />
      <div
        role="status"
        className="fixed inset-x-3 bottom-24 z-[100] mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-300/60 bg-amber-400 px-4 py-2.5 text-[#1f1500] shadow-[0_10px_40px_rgba(0,0,0,0.5)] lg:bottom-4"
      >
        <span className="material-symbols-outlined text-xl" aria-hidden>admin_panel_settings</span>
        <div className="min-w-0 flex-1 text-xs leading-snug">
          <p className="font-bold">Вы просматриваете кабинет в режиме администратора</p>
          <p className="truncate">
            {target} · {mode === 'edit' ? 'правка разрешена, действия записываются' : 'только просмотр'} · вы: {admin} · осталось {left(expiresAt - now)}
          </p>
          {error && <p className="font-semibold text-red-900">{error}</p>}
        </div>
        <button
          type="button"
          onClick={exit}
          disabled={leaving}
          className="rounded-xl bg-[#1f1500] px-3.5 py-2 text-xs font-bold text-amber-300 transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {leaving ? 'Выходим…' : 'Выйти из режима пользователя'}
        </button>
      </div>
    </>
  )
}
