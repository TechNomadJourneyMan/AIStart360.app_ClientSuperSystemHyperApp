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
  // Фаза 6: системные тумблеры доступа (авто-одобрение self-serve + тарифные гейты).
  const [access, setAccess] = useState<{ autoApproveClients: boolean; accessGates: boolean; insightModeration: boolean } | null>(null)
  const [accessSaving, setAccessSaving] = useState(false)

  useEffect(() => {
    fetch('/api/giga-admin/settings/registration')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.mode) setMode(d.mode as Mode)
      })
      .catch(() => {})
    fetch('/api/giga-admin/settings/access')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok) setAccess({ autoApproveClients: !!d.autoApproveClients, accessGates: !!d.accessGates, insightModeration: !!d.insightModeration })
      })
      .catch(() => {})
  }, [])

  const toggleAccess = async (key: 'autoApproveClients' | 'accessGates' | 'insightModeration') => {
    if (!access || accessSaving) return
    const prev = access
    const next = { ...access, [key]: !access[key] }
    setAccess(next)
    setAccessSaving(true)
    try {
      const res = await fetch('/api/giga-admin/settings/access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next[key] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Ошибка (HTTP ${res.status})`)
      // Сервер — источник истины (вернул фактические значения).
      setAccess({
        autoApproveClients: !!data.autoApproveClients,
        accessGates: !!data.accessGates,
        insightModeration: !!data.insightModeration,
      })
      toast.success(
        key === 'autoApproveClients'
          ? `Авто-одобрение: ${data.autoApproveClients ? 'вкл' : 'выкл'}`
          : key === 'accessGates'
            ? `Тарифные гейты: ${data.accessGates ? 'вкл' : 'выкл'}`
            : `Модерация ИИ-инсайтов: ${data.insightModeration ? 'вкл' : 'выкл (автопубликация!)'}`,
      )
    } catch (err) {
      setAccess(prev)
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить настройку')
    } finally {
      setAccessSaving(false)
    }
  }

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
      {access && (
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
          <button
            onClick={() => toggleAccess('autoApproveClients')}
            disabled={accessSaving}
            title="Авто-одобрение self-serve регистраций (режим «По подтверждению»)"
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              access.autoApproveClients
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/25'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Авто-одобрение
          </button>
          <button
            onClick={() => toggleAccess('accessGates')}
            disabled={accessSaving}
            title="Тарифные гейты: полный GRI / AI-чат / PDF / бенчмарки по тарифу (нужна миграция 048)"
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              access.accessGates
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/25'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Гейты тарифов
          </button>
          <button
            onClick={() => toggleAccess('insightModeration')}
            disabled={accessSaving}
            title="Обязательная проверка ИИ-инсайтов экспертом перед публикацией клиенту. Выключение = автопубликация (нужна миграция 060)"
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              access.insightModeration
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/25'
                : 'bg-red-500/10 text-red-300 border border-red-500/20'
            }`}
          >
            Модерация ИИ
          </button>
        </div>
      )}
    </div>
  )
}
