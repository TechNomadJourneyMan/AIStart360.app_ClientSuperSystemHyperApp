'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Eye, LogOut } from 'lucide-react'
import type { StaffRole } from '@/lib/admin/rbac'
import { navForRole, permissionCount } from '@/lib/devtools/matrix'
import { Badge, Button, ErrorState, GigaApiError, Panel, Skeleton, fmtDateTime, gigaFetch, useGigaQuery } from '../kit'

interface State {
  viewAs: { role: StaffRole; label: string; expiresAt: string | null } | null
  roles: Array<{ role: StaffRole; label: string }>
}

const ROLE_NOTES: Partial<Record<StaffRole, string>> = {
  admin: 'Всё, кроме ролей, системных настроек, полного удаления и Dev-tools',
  super_expert: 'Работа с людьми: пользователи, анкеты, отчёты на проверке. Свой кабинет /super-expert',
  crm_manager: 'Клиенты, лиды, inbox, вход «от имени», модерация',
  content_manager: 'Контент, разделы платформы, модерация',
  analyst: 'Агрегаты и пути клиентов без контактов и документов',
  support: 'Пользователи с контактами, просмотр кабинета «от имени»',
}

/**
 * «Как роль»: Super Admin видит панель ровно так, как сотрудник выбранной
 * роли (меню + права на сервере), не выходя из своего аккаунта. Режим живёт
 * 2 часа или до «Выйти» в полосе сверху.
 */
export function ViewAsTab() {
  const { data, error, loading, reload } = useGigaQuery<State & { ok: true }>('/api/giga-admin/dev-tools/view-as')
  const [busy, setBusy] = useState<string | null>(null)

  const start = async (role: StaffRole) => {
    setBusy(role)
    try {
      await gigaFetch('/api/giga-admin/dev-tools/view-as', { method: 'POST', json: { role } })
      toast.success('Режим включён — открываем панель глазами роли')
      window.location.assign(role === 'super_expert' ? '/super-expert' : '/admin-giga-panel')
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось включить режим')
      setBusy(null)
    }
  }

  const stop = async () => {
    setBusy('exit')
    try {
      await gigaFetch('/api/giga-admin/dev-tools/view-as', { method: 'DELETE' })
      window.location.assign('/admin-giga-panel/dev-tools')
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось выйти из режима')
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <ErrorState error={error} onRetry={reload} />
      <Panel
        title="Посмотреть панель как роль"
        description="Аккаунт не переключается: меняются только меню и права на сервере. Права можно лишь понизить; Dev-tools и выход из режима всегда работают с вашей настоящей ролью. Начало и конец режима пишутся в журнал."
      >
        {data?.viewAs ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-500/[0.08] px-4 py-3">
            <Eye size={16} className="text-amber-300" />
            <p className="min-w-0 flex-1 text-xs text-amber-100">
              Сейчас включён режим <span className="font-semibold">{data.viewAs.label}</span>
              {data.viewAs.expiresAt && <span className="text-amber-200/70"> · до {fmtDateTime(data.viewAs.expiresAt)}</span>}
            </p>
            <Button size="sm" variant="warning" icon={<LogOut size={12} />} loading={busy === 'exit'} onClick={stop}>Выйти из режима</Button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Режим выключен — вы видите панель как Super Admin.</p>
        )}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loading && !data && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        {data?.roles.map((r) => {
          const nav = navForRole(r.role)
          const sections = nav.giga.reduce((n, g) => n + g.items.length, 0)
          const active = data.viewAs?.role === r.role
          return (
            <div key={r.role} className="flex flex-col rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-100">{r.label}</p>
                {active && <Badge tone="amber">включён</Badge>}
              </div>
              <p className="mt-1 flex-1 text-[11px] leading-relaxed text-slate-500">{ROLE_NOTES[r.role] ?? ''}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="blue">{permissionCount(r.role)} прав</Badge>
                <Badge>{sections} разделов в меню</Badge>
                {nav.superExpert && <Badge tone="violet">кабинет SuperExpert</Badge>}
              </div>
              <Button
                className="mt-3"
                size="sm"
                variant={active ? 'secondary' : 'primary'}
                icon={<Eye size={12} />}
                loading={busy === r.role}
                disabled={!!busy}
                onClick={() => start(r.role)}
              >
                {active ? 'Открыть снова' : `Смотреть как ${r.label}`}
              </Button>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-slate-600">
        Нужно увидеть кабинет клиента? Это «Войти от имени» — только для клиентов, из User 360 или со вкладки «Тест-аккаунты».
      </p>
    </div>
  )
}
