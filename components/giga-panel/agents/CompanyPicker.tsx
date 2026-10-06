'use client'

/**
 * Searchable company picker for agent runs and filters.
 *
 * There is no company search endpoint in GIGA, so the picker searches
 * accounts (GET /api/giga-admin/users?q=, which already matches company
 * names) and resolves the chosen account's company id through the User 360
 * header (GET /api/giga-admin/users/:id/profile → company.id). Accounts
 * without a company row are shown but cannot be picked. Without `users.view`
 * the picker falls back to entering a company id by hand.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Building2, Loader2, Search, X } from 'lucide-react'
import { useStaff } from '../StaffContext'
import { Button, cx, gigaFetch, inputClass, useDebounced } from '../kit'

export interface PickedCompany { id: string; name: string | null }

interface UserHit { id: string; email: string | null; full_name: string | null; company_name: string | null; organization: string | null }

export function CompanyPicker({ value, onChange, label = 'Компания', compact = false, autoFocus = false }: {
  value: PickedCompany | null
  onChange: (c: PickedCompany | null) => void
  label?: string
  compact?: boolean
  autoFocus?: boolean
}) {
  const { can } = useStaff()
  const canSearch = can('users.view')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 250)
  const [hits, setHits] = useState<UserHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [manual, setManual] = useState('')
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!canSearch || dq.length < 2) { setHits([]); setSearchError(null); return }
    let alive = true
    setSearching(true)
    setSearchError(null)
    gigaFetch<{ data: UserHit[] }>(`/api/giga-admin/users?q=${encodeURIComponent(dq)}&pageSize=8&sort=name&dir=asc`)
      .then((r) => { if (alive) { setHits(r.data ?? []); setCursor(0) } })
      .catch((e) => { if (alive) { setHits([]); setSearchError(e instanceof Error ? e.message : 'Поиск недоступен') } })
      .finally(() => { if (alive) setSearching(false) })
    return () => { alive = false }
  }, [dq, canSearch])

  const pick = async (u: UserHit) => {
    if (!u.company_name) return
    setResolving(u.id)
    setError(null)
    try {
      const r = await gigaFetch<{ data: { company: { id: string; name: string | null } | null } }>(`/api/giga-admin/users/${u.id}/profile`)
      const c = r.data?.company
      if (!c?.id) { setError('У этого аккаунта нет карточки компании.'); return }
      onChange({ id: String(c.id), name: c.name ?? u.company_name })
      setQ('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось получить компанию')
    } finally {
      setResolving(null)
    }
  }

  if (value) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-blue-500/25 bg-blue-500/[0.08] px-3 py-2">
        <Building2 size={14} className="shrink-0 text-blue-300" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-100">{value.name || 'Компания'}</span>
          {!compact && <span className="block truncate font-mono text-[10px] text-slate-500">{value.id}</span>}
        </span>
        <button type="button" onClick={() => onChange(null)} aria-label="Сбросить компанию" className="rounded text-slate-500 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
          <X size={14} />
        </button>
      </div>
    )
  }

  if (!canSearch) {
    return (
      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="ID компании"
            aria-label={`${label}: ID компании`}
            className={cx(inputClass, 'font-mono text-xs')}
          />
          <Button size="sm" disabled={!manual.trim()} onClick={() => onChange({ id: manual.trim(), name: null })}>Выбрать</Button>
        </div>
        <p className="text-[10px] text-slate-600">Поиск по компаниям требует права «Список пользователей». Введите ID компании.</p>
      </div>
    )
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setCursor((c) => (hits.length ? (c + 1) % hits.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (hits.length ? (c - 1 + hits.length) % hits.length : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[cursor]; if (h) void pick(h) }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false) } }
  }

  const showList = open && dq.length >= 2

  return (
    <div className="relative">
      <label className="relative block">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setError(null) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="Компания, имя или email клиента…"
          role="combobox"
          aria-label={label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[cursor] ? `${listId}-${hits[cursor].id}` : undefined}
          className={cx(inputClass, 'pl-8 pr-8 text-xs')}
        />
        {(searching || resolving) && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-500" />}
      </label>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-[95] mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0a1024] py-1 shadow-2xl"
        >
          {searchError && <li className="px-3 py-2 text-[11px] text-red-300">{searchError}</li>}
          {!searchError && !searching && hits.length === 0 && <li className="px-3 py-2 text-[11px] text-slate-500">Ничего не найдено</li>}
          {hits.map((h, i) => {
            const disabled = !h.company_name
            return (
              <li
                key={h.id}
                id={`${listId}-${h.id}`}
                role="option"
                aria-selected={i === cursor}
                aria-disabled={disabled}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => { e.preventDefault(); void pick(h) }}
                className={cx(
                  'flex items-center gap-2 px-3 py-1.5',
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  i === cursor && !disabled && 'bg-blue-500/15',
                )}
              >
                <Building2 size={13} className="shrink-0 text-slate-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-slate-100">{h.company_name || h.organization || h.full_name || h.email || h.id.slice(0, 8)}</span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {disabled ? 'нет карточки компании' : [h.full_name, h.email].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                {resolving === h.id && <Loader2 size={12} className="animate-spin text-slate-500" />}
              </li>
            )
          })}
        </ul>
      )}
      {dq.length === 1 && open && <p className="mt-1 text-[10px] text-slate-600">Введите ещё символ…</p>}
      {error && <p role="alert" className="mt-1 text-[11px] text-red-300">{error}</p>}
    </div>
  )
}
