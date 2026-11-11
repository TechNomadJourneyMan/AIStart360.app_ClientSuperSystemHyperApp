'use client'

/**
 * The floating developer panel: enter the portal as any role, or as any
 * existing account, and switch dev mode — on localhost only.
 *
 * app/layout.tsx mounts it behind the literal NODE_ENV check, so a production
 * build contains neither this file nor its chunk. In development it stays
 * invisible unless the page was opened on a local host AND GET /api/dev/session
 * answers 200 — the routes it talks to are closed by lib/dev/dev-access.ts, the
 * panel only reflects that.
 *
 * The requests are plain functions that take `fetch`, and the markup is a
 * stateless view: the repo tests components without a DOM.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { isLocalHost } from '@/lib/dev/dev-access'
import { safeInternalPath } from '@/lib/safe-redirect'

export interface DevRoleOption {
  role: string
  label: string
}

export interface DevCurrentAccount {
  email: string | null
  role: string | null
  staffRole: string | null
}

export interface DevSession {
  devMode: boolean
  roles: DevRoleOption[]
  current: DevCurrentAccount | null
}

export type DevActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

type FetchFn = typeof fetch

/** What GET /api/dev/session says, or null when the panel has to stay hidden. */
export async function loadDevSession(fetchFn: FetchFn): Promise<DevSession | null> {
  try {
    const res = await fetchFn('/api/dev/session', { cache: 'no-store' })
    if (res.status !== 200) return null
    const json = (await res.json()) as { enabled?: unknown; devMode?: unknown; roles?: unknown; current?: unknown } | null
    if (json?.enabled !== true || !Array.isArray(json.roles)) return null
    return {
      devMode: json.devMode === true,
      roles: json.roles as DevRoleOption[],
      current: (json.current as DevCurrentAccount | null | undefined) ?? null,
    }
  } catch {
    return null
  }
}

/** The session for a page opened on `hostname`; a host that is not local is not even asked. */
export async function resolveDevSession(hostname: string, fetchFn: FetchFn): Promise<DevSession | null> {
  return isLocalHost(hostname) ? loadDevSession(fetchFn) : null
}

async function post<T>(fetchFn: FetchFn, path: string, body: unknown): Promise<DevActionResult<T>> {
  try {
    const res = await fetchFn(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null
    if (!res.ok || json === null) {
      return { ok: false, error: typeof json?.error === 'string' ? json.error : `HTTP ${res.status}` }
    }
    return { ok: true, data: json }
  } catch {
    return { ok: false, error: 'NETWORK' }
  }
}

export function devLogin(fetchFn: FetchFn, target: { role: string } | { email: string }) {
  return post<{ ok: true; redirect: string }>(fetchFn, '/api/dev/login', target)
}

export function devSetMode(fetchFn: FetchFn, on: boolean) {
  return post<{ ok: true; devMode: boolean }>(fetchFn, '/api/dev/mode', { on })
}

export function devLogout(fetchFn: FetchFn) {
  return post<{ ok: true }>(fetchFn, '/api/dev/logout', {})
}

/** Where to go after signing in: a path on this site, whatever the answer said. */
export function safeRedirect(value: unknown): string {
  return safeInternalPath(typeof value === 'string' ? value : null, '/')
}

export function devErrorText(code: string): string {
  return code === 'USER_NOT_FOUND' ? 'Такого пользователя нет' : `Ошибка: ${code}`
}

/** A staff role names the account; otherwise its profile role. */
export function currentRoleLabel(current: DevCurrentAccount, roles: DevRoleOption[]): string {
  const role = current.staffRole ?? current.role
  if (!role) return '—'
  return roles.find((option) => option.role === role)?.label ?? role
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const SECTION = 'mt-4 border-t border-white/[0.08] pt-4'
const SECTION_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-slate-400'
const ACTION = `rounded-lg border border-white/[0.12] px-2.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-primary/50 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
const ALERT = 'mt-2 break-words text-xs text-red-300'

export interface DevPanelViewProps {
  session: DevSession
  open: boolean
  /** A request is in flight: every action is disabled. */
  busy: boolean
  /** The code of the last failure (see devErrorText). */
  error: string | null
  email: string
  onOpenChange: (open: boolean) => void
  onEmailChange: (value: string) => void
  onToggleMode: () => void
  onLoginRole: (role: string) => void
  onLoginEmail: () => void
  onLogout: () => void
}

/**
 * The pill «DEV» and, when open, the card above it. The pill comes first in
 * the document, so Tab goes from it straight into the card, and it never
 * leaves the page, so closing the card (Escape included) returns to it.
 */
export function DevPanelView(props: DevPanelViewProps) {
  const { session, open, busy, error, email } = props
  const id = useId()
  const pillId = `${id}-pill`
  const cardId = `${id}-card`
  const hintId = `${id}-hint`
  const pill = useRef<HTMLButtonElement>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    props.onLoginEmail()
  }
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    props.onOpenChange(false)
    pill.current?.focus()
  }

  return (
    // Bottom-left, clear of the mobile bottom navigation, above everything else.
    <div className="fixed bottom-20 left-3 z-[2147483647] flex flex-col-reverse items-start gap-2 lg:bottom-3">
      <button
        ref={pill}
        id={pillId}
        type="button"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onClick={() => props.onOpenChange(!open)}
        className={`rounded-full border border-primary/40 bg-[#0A0B0F]/90 px-3 py-1.5 text-[11px] font-bold tracking-widest text-primary shadow-lg backdrop-blur ${FOCUS}`}
      >
        DEV
      </button>

      {open && (
        <section
          id={cardId}
          aria-labelledby={pillId}
          onKeyDown={closeOnEscape}
          className="max-h-[calc(100dvh-9rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0A0B0F]/95 p-4 text-slate-200 shadow-2xl backdrop-blur-xl"
        >
          <button
            type="button"
            role="switch"
            aria-checked={session.devMode}
            aria-describedby={hintId}
            disabled={busy}
            onClick={props.onToggleMode}
            className={`flex w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
          >
            <span>Режим разработки</span>
            <span
              aria-hidden
              className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${session.devMode ? 'border-primary bg-primary' : 'border-white/20 bg-white/[0.06]'}`}
            >
              <span
                className={`absolute top-0.5 h-[18px] w-[18px] rounded-full transition-all ${session.devMode ? 'left-[22px] bg-on-primary' : 'left-0.5 bg-slate-300'}`}
              />
            </span>
          </button>
          <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-slate-400">
            Пропускает заглушку техработ и 2FA на этом компьютере
          </p>

          <div className={SECTION}>
            <h2 className={SECTION_TITLE}>Войти как роль</h2>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {session.roles.map((option) => (
                <button key={option.role} type="button" disabled={busy} onClick={() => props.onLoginRole(option.role)} className={ACTION}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={SECTION}>
            <h2 className={SECTION_TITLE}>Войти как пользователь</h2>
            <form onSubmit={submit} className="mt-2 flex gap-1.5">
              <input
                type="email"
                required
                aria-label="Email"
                placeholder="email"
                autoComplete="off"
                spellCheck={false}
                value={email}
                disabled={busy}
                onChange={(event) => props.onEmailChange(event.target.value)}
                className={`min-w-0 flex-1 rounded-lg border border-white/[0.12] bg-white/[0.04] px-2.5 py-2 text-base text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 sm:text-xs ${FOCUS}`}
              />
              <button
                type="submit"
                disabled={busy}
                className={`rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
              >
                Войти
              </button>
            </form>
            {error === 'USER_NOT_FOUND' && <p role="alert" className={ALERT}>{devErrorText(error)}</p>}
          </div>

          <div className={SECTION}>
            {error !== null && error !== 'USER_NOT_FOUND' && <p role="alert" className={`${ALERT} mb-2 mt-0`}>{devErrorText(error)}</p>}
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 break-words text-xs text-slate-300">
                {session.current
                  ? `Сейчас: ${session.current.email ?? '—'} · ${currentRoleLabel(session.current, session.roles)}`
                  : 'Сейчас: без входа'}
              </p>
              {session.current && (
                <button type="button" disabled={busy} onClick={props.onLogout} className={`shrink-0 ${ACTION}`}>
                  Выйти
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

export default function DevPanel() {
  // null until a local host and a 200 from /api/dev/session say otherwise:
  // nothing is rendered on the server or on any other host.
  const [session, setSession] = useState<DevSession | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void resolveDevSession(window.location.hostname, fetch).then((next) => {
      if (mounted.current) setSession(next)
    })
    return () => {
      mounted.current = false
    }
  }, [])

  if (!session) return null

  /**
   * One request at a time; a failure leaves its code on the card. `done`
   * answers 'leave' when the page is going away — the actions then stay
   * disabled until it does.
   */
  const run = async <T,>(action: () => Promise<DevActionResult<T>>, done: (data: T) => 'stay' | 'leave') => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await action()
    if (!mounted.current) return
    if (result.ok) {
      if (done(result.data) === 'leave') return
    } else {
      setError(result.error)
    }
    setBusy(false)
  }

  const openChange = (next: boolean) => {
    setOpen(next)
    // «Сейчас» may be stale: signing in through the ordinary pages does not tell the panel.
    if (next) {
      void loadDevSession(fetch).then((fresh) => {
        if (fresh && mounted.current) setSession(fresh)
      })
    }
  }

  // A full page load on purpose: middleware decides what the new account may open.
  const enter = (target: { role: string } | { email: string }) =>
    run(() => devLogin(fetch, target), (data) => {
      window.location.assign(safeRedirect(data.redirect))
      return 'leave'
    })

  return (
    <DevPanelView
      session={session}
      open={open}
      busy={busy}
      error={error}
      email={email}
      onOpenChange={openChange}
      onEmailChange={setEmail}
      onToggleMode={() => {
        void run(() => devSetMode(fetch, !session.devMode), (data) => {
          setSession({ ...session, devMode: data.devMode === true })
          return 'stay'
        })
      }}
      onLoginRole={(role) => {
        void enter({ role })
      }}
      onLoginEmail={() => {
        void enter({ email: email.trim() })
      }}
      onLogout={() => {
        void run(() => devLogout(fetch), () => {
          window.location.reload()
          return 'leave'
        })
      }}
    />
  )
}
