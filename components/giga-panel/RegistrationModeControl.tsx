'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type Mode = 'open' | 'approval' | 'invite'

const LABELS: Record<Mode, string> = {
  open: 'Открытая',
  approval: 'По подтверждению',
  invite: 'По приглашению',
}
const ORDER: Mode[] = ['open', 'approval', 'invite']

/**
 * Super-admin control for the global registration mode:
 *   open     — self-registration + immediate access
 *   approval — self-registration, waits for admin approval (default)
 *   invite   — self-registration closed
 * Optimistic with rollback on failure. Renders nothing until the current mode
 * loads (or if the endpoint is unreachable, e.g. migration 040 not applied).
 */
export function RegistrationModeControl() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/giga-admin/settings/registration')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.mode) setMode(d.mode as Mode)
      })
      .catch(() => {})
  }, [])

  const change = async (next: Mode) => {
    if (saving || next === mode) return
    const prev = mode
    setMode(next)
    setSaving(true)
    try {
      const res = await fetch('/api/giga-admin/settings/registration', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Ошибка (HTTP ${res.status})`)
      toast.success(`Режим регистрации: ${LABELS[next]}`)
    } catch (err) {
      setMode(prev)
      toast.error(err instanceof Error ? err.message : 'Не удалось изменить режим регистрации')
    } finally {
      setSaving(false)
    }
  }

  if (!mode) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 hidden sm:inline">
        Регистрация
      </span>
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
        {ORDER.map((m) => (
          <button
            key={m}
            onClick={() => change(m)}
            disabled={saving || m === mode}
            title={LABELS[m]}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all disabled:cursor-default ${
              m === mode
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  )
}
