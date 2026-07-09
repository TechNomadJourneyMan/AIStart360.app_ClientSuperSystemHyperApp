'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useCrmClients, useUpdateClient, type CrmClient } from '@/hooks/useCrm'
import { CLIENT_STATUSES, type ClientStatus } from '@/lib/crm/client-validate'
import { CLIENT_STATUS_META, FunnelBar, fmtTenge } from './FunnelBar'
import { AddClientInline } from './AddClientInline'
import { MascotEmptyHint } from '@/components/assistant/mascot/MascotEmptyHint'

const DAY_MS = 86_400_000

/** Recency dot by last_contact_at: green <7d, amber 7-30d, red >30d / never. */
function recency(lastContactAt: string | null): { dot: string; title: string } {
  if (!lastContactAt) return { dot: 'bg-on-surface-variant/40', title: 'Нет касаний' }
  const t = new Date(lastContactAt).getTime()
  if (Number.isNaN(t)) return { dot: 'bg-on-surface-variant/40', title: 'Нет касаний' }
  const days = Math.floor((Date.now() - t) / DAY_MS)
  if (days < 7) return { dot: 'bg-primary', title: `Контакт ${days} дн. назад` }
  if (days <= 30) return { dot: 'bg-amber-400', title: `Контакт ${days} дн. назад` }
  return { dot: 'bg-error', title: `Контакт ${days} дн. назад` }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function ClientsTable({
  onOpenClient,
  onOpenImport,
}: {
  onOpenClient?: (c: CrmClient) => void
  onOpenImport?: () => void
}) {
  // Fetch the whole base once; filter by status/search client-side so the funnel
  // counts stay accurate and status clicks don't refetch (base is ≤500 rows).
  const { data: clients = [], isLoading, error } = useCrmClients()
  const update = useUpdateClient()

  const [status, setStatus] = useState<ClientStatus | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients.filter((c) => {
      if (status && c.status !== status) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.phone_raw ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      )
    })
  }, [clients, status, search])

  const changeStatus = (c: CrmClient, next: ClientStatus) => {
    if (next === c.status) return
    update.mutate(
      { id: c.id, patch: { status: next } },
      {
        onSuccess: () => toast.success(`Статус «${c.name}»: ${CLIENT_STATUS_META[next].label}`),
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Не удалось обновить статус'),
      },
    )
  }

  return (
    <div className="space-y-4">
      <AddClientInline />

      <FunnelBar clients={clients} active={status} onSelect={setStatus} />

      {/* Toolbar: search + import */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <span className="material-symbols-outlined text-base text-on-surface-variant/50 absolute left-3 top-1/2 -translate-y-1/2">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени, телефону, email…"
            className="w-full bg-surface-container border border-white/[0.06] rounded-xl pl-10 pr-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30"
          />
        </div>
        {onOpenImport && (
          <button
            onClick={onOpenImport}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-sm">upload_file</span>
            Импорт CSV
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : error ? (
        <div className="p-6 text-center bg-error/10 rounded-2xl border border-error/20">
          <p className="text-error text-sm font-medium">Не удалось загрузить базу клиентов</p>
        </div>
      ) : filtered.length === 0 ? (
        clients.length === 0 ? (
          <MascotEmptyHint
            title="База пуста"
            text="Добавьте первого клиента формой выше — или импортируйте всех разом из CSV. А я подскажу, кому звонить в первую очередь."
            cta={{
              label: 'Добавить клиента',
              onClick: () => {
                const el = document.querySelector<HTMLElement>('[data-tour="crm-add"]')
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el?.querySelector('input')?.focus()
              },
            }}
          />
        ) : (
          <div className="p-10 text-center bg-surface-container-low rounded-2xl border border-white/[0.04]">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 block mb-2">group_off</span>
            <p className="text-sm text-on-surface-variant">Ничего не найдено по фильтру</p>
          </div>
        )
      ) : (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {['Клиент', 'Статус', 'Ср. чек', 'Последний контакт', ''].map((h) => (
                    <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const rec = recency(c.last_contact_at)
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onOpenClient?.(c)}
                      className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer group"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rec.dot}`} title={rec.title} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors truncate">{c.name}</p>
                            <p className="text-[10px] font-mono text-on-surface-variant truncate">{c.phone_raw || c.phone || c.email || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={c.status}
                          onChange={(e) => changeStatus(c, e.target.value as ClientStatus)}
                          className={`bg-surface-container border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs font-medium focus:outline-none focus:border-primary/30 ${CLIENT_STATUS_META[c.status as ClientStatus]?.text ?? 'text-on-surface'}`}
                        >
                          {CLIENT_STATUSES.map((s) => (
                            <option key={s} value={s} className="bg-surface-container text-on-surface">
                              {CLIENT_STATUS_META[s].label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-on-surface">{c.avg_check ? fmtTenge(c.avg_check) : '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-on-surface-variant">{fmtDate(c.last_contact_at)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="material-symbols-outlined text-base text-on-surface-variant/40 group-hover:text-primary transition-colors">chevron_right</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
