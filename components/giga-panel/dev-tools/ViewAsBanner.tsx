'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Eye, LogOut } from 'lucide-react'
import { useStaff } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import { GigaApiError, gigaFetch } from '../kit'

/**
 * Полоса режима «посмотреть как роль» (Dev-tools Super Admin). Видна на каждой
 * странице панели и кабинета SuperExpert, пока режим включён. «Выйти» стирает
 * cookie на сервере и возвращает в Dev-tools с настоящей ролью.
 */
export function ViewAsBanner() {
  const { me } = useStaff()
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  if (!me?.viewAs) return null

  const exit = async () => {
    setBusy(true)
    try {
      await gigaFetch('/api/giga-admin/dev-tools/view-as', { method: 'DELETE' })
      window.location.assign('/admin-giga-panel/dev-tools')
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось выйти из режима')
      setBusy(false)
    }
  }

  const inSuperExpert = ws.base === '/super-expert'
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/[0.12] px-4 py-3 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.08)]"
    >
      <Eye size={16} className="shrink-0 text-amber-300" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed">
        Вы смотрите панель как роль <span className="font-semibold text-amber-50">{me.viewAs.label}</span>
        <span className="text-amber-200/70"> — меню и права этой роли. Ваш аккаунт ({me.realRoleLabel ?? 'Super Admin'}) не переключён.</span>
      </p>
      {me.viewAs.role === 'super_expert' && !inSuperExpert && (
        <Link href="/super-expert" className="rounded-xl border border-amber-400/30 px-3 py-1.5 text-[11px] font-medium text-amber-100 hover:bg-amber-500/15">
          Открыть кабинет SuperExpert
        </Link>
      )}
      {inSuperExpert && (
        <Link href="/admin-giga-panel" className="rounded-xl border border-amber-400/30 px-3 py-1.5 text-[11px] font-medium text-amber-100 hover:bg-amber-500/15">
          Панель GIGA-CRM
        </Link>
      )}
      <button
        type="button"
        onClick={exit}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-60"
      >
        <LogOut size={12} />
        {busy ? 'Выходим…' : 'Выйти'}
      </button>
    </div>
  )
}
