'use client'

/**
 * GIGA-CRM UI kit — one visual language for every panel page:
 * dark glass cards, slate text, blue accent, lucide icons.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Inbox, Loader2, RefreshCw, Search, X } from 'lucide-react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ─── Data fetching ───────────────────────────────────────────────────────────

export class GigaApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function gigaFetch<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'include',
      ...rest,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new GigaApiError('Нет связи с сервером. Проверьте соединение и повторите.', 0)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok || (body && body.ok === false)) {
    const msg = (body && (body.error || body.message)) || (res.status === 403 ? 'Недостаточно прав' : `Ошибка сервера (${res.status})`)
    throw new GigaApiError(String(msg), res.status)
  }
  return body as T
}

/** GET with loading / error / reload; ignores stale responses. */
export function useGigaQuery<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<GigaApiError | null>(null)
  const [loading, setLoading] = useState<boolean>(!!url)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!url) return
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const d = await gigaFetch<T>(url)
      if (my === seq.current) setData(d)
    } catch (e) {
      if (my === seq.current) setError(e instanceof GigaApiError ? e : new GigaApiError(String(e), 0))
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [url])

  useEffect(() => { void load() }, [load])
  return { data, error, loading, reload: load, setData }
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export interface Crumb { label: string; href?: string }

export function PageHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: Crumb[] }) {
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Навигация" className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={11} className="text-slate-700" />}
              {c.href ? <Link href={c.href} className="hover:text-slate-300">{c.label}</Link> : <span className="text-slate-400">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-slate-100 md:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Panel({ title, description, actions, children, className, bodyClassName }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string
}) {
  return (
    <section className={cx('rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-200">{title}</h2>}
            {description && <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

const TONES = {
  neutral: 'bg-white/[0.05] text-slate-300 border-white/[0.08]',
  blue: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  red: 'bg-red-500/15 text-red-300 border-red-500/25',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
} as const
export type Tone = keyof typeof TONES

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium', TONES[tone], className)}>
      {children}
    </span>
  )
}

export function StatTile({ label, value, hint, icon, tone = 'blue', href }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone; href?: string
}) {
  const body = (
    <div className="h-full rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 transition-colors hover:border-white/[0.12]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-slate-500">{label}</p>
        {icon && <span className={cx('flex h-7 w-7 items-center justify-center rounded-lg border', TONES[tone])}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}

// ─── Controls ────────────────────────────────────────────────────────────────

const BUTTON = {
  primary: 'bg-blue-500 text-white hover:bg-blue-400 border-blue-400/40',
  secondary: 'bg-white/[0.05] text-slate-200 hover:bg-white/[0.09] border-white/[0.1]',
  ghost: 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] border-transparent',
  danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25 border-red-500/30',
  warning: 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border-amber-500/30',
} as const

export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className, ...props }: {
  variant?: keyof typeof BUTTON; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl border font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-[11px]' : 'px-3.5 py-2 text-xs',
        BUTTON[variant],
        className,
      )}
    >
      {loading ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Поиск…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cx('relative block', className)}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none"
      />
    </label>
  )
}

export function Select<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }>; label: string; className?: string
}) {
  return (
    <label className={cx('flex items-center gap-2 text-[11px] text-slate-500', className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={label}
        className="rounded-xl border border-white/[0.08] bg-[#0b1128] px-3 py-2 text-xs text-slate-200 focus:border-blue-500/40 focus:outline-none"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-slate-600">{hint}</span>}
    </label>
  )
}

export const inputClass = 'w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none'

export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: ReadonlyArray<{ key: T; label: string; count?: number | null; hidden?: boolean }>; value: T; onChange: (v: T) => void; className?: string
}) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.03] p-1', className)}>
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
            value === t.key ? 'border border-blue-500/25 bg-blue-500/15 text-blue-200' : 'border border-transparent text-slate-500 hover:text-slate-300',
          )}
        >
          {t.label}
          {t.count != null && <span className="rounded-full bg-white/[0.08] px-1.5 text-[10px] text-slate-400">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ─── States ──────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-white/[0.05]', className)} />
}

export function EmptyState({ title, text, icon, action }: { title: string; text?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-500">
        {icon ?? <Inbox size={18} />}
      </div>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {text && <p className="mt-1 max-w-sm text-xs text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: { message: string; status?: number } | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3">
      <AlertTriangle size={16} className="text-red-400" />
      <p className="min-w-0 flex-1 text-xs text-red-200">{error.message}</p>
      {onRetry && error.status !== 403 && (
        <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={onRetry}>Повторить</Button>
      )}
    </div>
  )
}

// ─── Table ───────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  sortKey?: string
}

export function DataTable<T>({ columns, rows, rowKey, loading, empty, onRowClick, sort, onSort, skeletonRows = 6 }: {
  columns: Column<T>[]
  rows: T[] | null | undefined
  rowKey: (row: T) => string
  loading?: boolean
  empty?: ReactNode
  onRowClick?: (row: T) => void
  sort?: { key: string; dir: 'asc' | 'desc' }
  onSort?: (key: string) => void
  skeletonRows?: number
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-3 py-2.5 font-medium', c.className)}>
                {c.sortKey && onSort ? (
                  <button type="button" onClick={() => onSort(c.sortKey!)} className="inline-flex items-center gap-1 hover:text-slate-300">
                    {c.header}
                    {sort?.key === c.sortKey && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                  </button>
                ) : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows?.length
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-white/[0.04]">
                  {columns.map((c) => <td key={c.key} className="px-3 py-3"><Skeleton className="h-3.5 w-full max-w-[160px]" /></td>)}
                </tr>
              ))
            : rows?.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cx('border-b border-white/[0.04] transition-colors', onRowClick && 'cursor-pointer hover:bg-white/[0.03]', loading && 'opacity-60')}
                >
                  {columns.map((c) => <td key={c.key} className={cx('px-3 py-2.5 align-middle text-slate-300', c.className)}>{c.render(row)}</td>)}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && (empty ?? <EmptyState title="Ничего не найдено" text="Измените фильтры или поисковый запрос." />)}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return <p className="px-3 py-3 text-[11px] text-slate-600">Всего: {total}</p>
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-3 text-[11px] text-slate-500">
      <span>{from}–{to} из {total}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => onChange(page - 1)} icon={<ChevronLeft size={13} />} />
        <span className="px-2 tabular-nums">{page} / {pages}</span>
        <Button size="sm" variant="ghost" aria-label="Следующая страница" disabled={page >= pages} onClick={() => onChange(page + 1)} icon={<ChevronRight size={13} />} />
      </div>
    </div>
  )
}

// ─── Overlays ────────────────────────────────────────────────────────────────

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  useEscape(open, onClose)
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cx('relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#0a1024] shadow-2xl', wide ? 'max-w-3xl' : 'max-w-md')}
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
              <button type="button" onClick={onClose} aria-label="Закрыть" className="text-slate-500 hover:text-slate-200"><X size={16} /></button>
            </div>
            <div className="px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.07] px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function Drawer({ open, onClose, title, children, width = 'max-w-xl' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string
}) {
  useEscape(open, onClose)
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/50" />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className={cx('absolute right-0 top-0 flex h-full w-full flex-col border-l border-white/[0.08] bg-[#070c1f]', width)}
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <h3 className="min-w-0 truncate text-sm font-semibold text-slate-100">{title}</h3>
              <button type="button" onClick={onClose} aria-label="Закрыть" className="text-slate-500 hover:text-slate-200"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}

/**
 * Confirmation for critical operations. With `requireText` the user must type
 * the given word (e.g. «УДАЛИТЬ») before the action unlocks.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, text, confirmLabel = 'Подтвердить', tone = 'danger', requireText, loading, children }: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  text?: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary' | 'warning'
  requireText?: string
  loading?: boolean
  children?: ReactNode
}) {
  const [typed, setTyped] = useState('')
  useEffect(() => { if (!open) setTyped('') }, [open])
  const locked = !!requireText && typed.trim().toUpperCase() !== requireText.toUpperCase()
  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Отмена</Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} disabled={locked}>{confirmLabel}</Button>
        </>
      }
    >
      {text && <div className="text-xs leading-relaxed text-slate-400">{text}</div>}
      {children && <div className="mt-3">{children}</div>}
      {requireText && (
        <div className="mt-4">
          <Field label={`Для подтверждения введите «${requireText}»`}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className={inputClass} autoFocus />
          </Field>
        </div>
      )}
    </Modal>
  )
}

// ─── Charts (CSS only — light, readable, no extra bundle) ────────────────────

export function BarList({ items, emptyText = 'Нет данных', format = (n: number) => n.toLocaleString('ru-RU') }: {
  items: Array<{ label: ReactNode; value: number; hint?: ReactNode; key?: string }>; emptyText?: string; format?: (n: number) => string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (!items.length) return <p className="py-4 text-center text-xs text-slate-600">{emptyText}</p>
  return (
    <ul className="space-y-2">
      {items.map((i, idx) => (
        <li key={i.key ?? idx} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-xs text-slate-300">{i.label}</span>
          <span className="text-right text-xs tabular-nums text-slate-400">{format(i.value)}{i.hint ? <span className="ml-1 text-slate-600">{i.hint}</span> : null}</span>
          <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full bg-blue-400/70" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ColumnChart({ points, height = 120, label }: { points: Array<{ label: string; value: number }>; height?: number; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.value))
  return (
    <figure aria-label={label}>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {points.map((p) => (
          <div key={p.label} className="group relative flex h-full flex-1 items-end" title={`${p.label}: ${p.value}`}>
            <div className="w-full rounded-t bg-blue-400/60 transition-colors group-hover:bg-blue-300" style={{ height: `${Math.max(p.value ? 4 : 1, (p.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>{points[0]?.label}</span>
        <span>макс. {max}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  )
}

/**
 * Stage counts with the share of the first stage. Journey stages are not a
 * strict chain (Точка А can exist without a finished survey), so a
 * step-over-step "conversion" above 100% would be nonsense — the share of all
 * users is shown instead, and the drop from the previous stage only when it
 * really is a drop.
 */
export function Funnel({ steps }: { steps: Array<{ key: string; label: string; count: number; href?: string }> }) {
  const top = Math.max(1, steps[0]?.count ?? 1)
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].count : null
        const share = Math.round((s.count / top) * 100)
        const drop = prev != null && prev > 0 && s.count < prev ? Math.round(((prev - s.count) / prev) * 100) : null
        const row = (
          <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3">
            <span className="truncate text-xs text-slate-300">{s.label}</span>
            <div className="h-6 overflow-hidden rounded-lg bg-white/[0.04]">
              <div className="flex h-full items-center rounded-lg bg-gradient-to-r from-blue-500/60 to-violet-500/50 px-2 text-[10px] font-semibold text-white" style={{ width: `${Math.max(4, (s.count / top) * 100)}%` }}>
                {s.count}
              </div>
            </div>
            <span className="w-24 text-right text-[11px] tabular-nums" title={drop != null ? `Отсев от предыдущего этапа: ${drop}%` : undefined}>
              <span className={cx(share >= 50 ? 'text-emerald-400' : share >= 20 ? 'text-amber-400' : 'text-red-400')}>{share}%</span>
              {drop != null && <span className="ml-1 text-slate-600">−{drop}%</span>}
            </span>
          </div>
        )
        return <li key={s.key}>{s.href ? <Link href={s.href} className="block rounded-lg hover:bg-white/[0.02]">{row}</Link> : row}</li>
      })}
    </ol>
  )
}

export interface TimelineItem { id: string; at: string; title: ReactNode; subtitle?: ReactNode; tone?: Tone; icon?: ReactNode }

export function Timeline({ items, emptyText = 'Событий нет' }: { items: TimelineItem[]; emptyText?: string }) {
  if (!items.length) return <p className="py-4 text-center text-xs text-slate-600">{emptyText}</p>
  return (
    <ol className="relative space-y-3 border-l border-white/[0.08] pl-5">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span className={cx('absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border', TONES[it.tone ?? 'neutral'])}>
            {it.icon ?? <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-xs font-medium text-slate-200">{it.title}</p>
            <time className="text-[10px] text-slate-600" dateTime={it.at}>{fmtDateTime(it.at)}</time>
          </div>
          {it.subtitle && <div className="mt-0.5 text-[11px] text-slate-500">{it.subtitle}</div>}
        </li>
      ))}
    </ol>
  )
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'никогда'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const m = Math.round(ms / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} дн назад`
  return fmtDate(iso)
}

export function JsonValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-slate-600">—</span>
  if (typeof value === 'string') return <span className="whitespace-pre-wrap break-words">{value}</span>
  if (typeof value === 'number' || typeof value === 'boolean') return <span>{String(value)}</span>
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 text-[10px] text-slate-400">{JSON.stringify(value, null, 2)}</pre>
}

/** Old → new, key by key, for audit entries. */
export function DiffView({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!isObj(oldValue) && !isObj(newValue)) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div><p className="mb-1 text-[10px] uppercase text-red-400/80">Было</p><JsonValue value={oldValue} /></div>
        <div><p className="mb-1 text-[10px] uppercase text-emerald-400/80">Стало</p><JsonValue value={newValue} /></div>
      </div>
    )
  }
  const o = isObj(oldValue) ? oldValue : {}
  const n = isObj(newValue) ? newValue : {}
  const keys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)]))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-[11px]">
        <thead><tr className="text-[10px] uppercase text-slate-600"><th className="py-1 pr-2">Поле</th><th className="py-1 pr-2">Было</th><th className="py-1">Стало</th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t border-white/[0.05] align-top">
              <td className="py-1.5 pr-2 font-mono text-slate-400">{k}</td>
              <td className="py-1.5 pr-2 text-red-200/80"><JsonValue value={o[k]} /></td>
              <td className="py-1.5 text-emerald-200/90"><JsonValue value={n[k]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Навигация" className="mb-3 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={11} className="text-slate-700" />}
          {c.href ? <Link href={c.href} className="hover:text-slate-300">{c.label}</Link> : <span className="text-slate-400">{c.label}</span>}
        </span>
      ))}
    </nav>
  )
}

/**
 * Hover / focus preview. Opens after a short delay near the trigger, stays
 * open while the pointer is over the card, closes on leave or Escape.
 * Rendered in a fixed layer so table overflow never clips it.
 */
export function HoverCard({ trigger, children, openDelay = 300, width = 320 }: {
  trigger: ReactNode
  children: (open: boolean) => ReactNode
  openDelay?: number
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const place = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    const below = r.bottom + 8
    const top = below + 260 > window.innerHeight ? Math.max(8, r.top - 268) : below
    setPos({ top, left })
  }
  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { place(); setOpen(true) }, openDelay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 120)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEscape(open, () => setOpen(false))

  return (
    <span ref={ref} className="inline-block max-w-full" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {trigger}
      {open && pos && (
        <div
          role="tooltip"
          onMouseEnter={() => { if (timer.current) clearTimeout(timer.current) }}
          onMouseLeave={hide}
          style={{ top: pos.top, left: pos.left, width }}
          className="fixed z-[90] rounded-2xl border border-white/[0.1] bg-[#0a1024]/95 p-3 text-left shadow-2xl backdrop-blur-xl"
        >
          {children(open)}
        </div>
      )}
    </span>
  )
}
