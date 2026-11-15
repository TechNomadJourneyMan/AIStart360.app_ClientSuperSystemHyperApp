'use client'

/**
 * components/access/Paywall.tsx — the ONE paywall of the platform (Round 2, R2-A).
 *
 * Shown instead of a paid section (Точка А, Точка Б, Рынок, полный GRI — and the
 * Pro extras PDF / AI-чат / бенчмарки) when the server decision says «closed»
 * (lib/access/decision.ts; the API answers 402 by the same rule). It draws no
 * client data and requests none: the only calls are reading / sending the
 * access request (POST/GET /api/v1/upgrade-request).
 *
 * Honest by design: what the section contains, what stays free, and that online
 * payment is not connected (intentional stub) — a manager opens the access.
 *
 * `variant`: 'page' — the full screen of a section; 'compact' — a card inside
 * another page (home, dashboard, a form).
 * `initialRequested`: known on the server (FeatureGate) → no flash; undefined →
 * read once on mount.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import {
  ADD_HINT,
  ADD_LABEL,
  ERROR_TEXT,
  IMPERSONATION_TEXT,
  PAYMENT_NOTE,
  REQUEST_LABEL,
  SENT_TEXT,
  paywallCopy,
  readAccessRequest,
  requestStateFor,
  sendAccessRequest,
  type RequestState,
} from './paywall-model'

export interface PaywallProps {
  feature: string
  variant?: 'page' | 'compact'
  /** THIS section is already in the user's open request (known on the server). */
  initialRequested?: boolean
  /** An open request exists for other sections → «Добавить раздел к заявке». */
  initialOpenOther?: boolean
  /** «От имени» (server-checked): the request is the client's own — no button. */
  impersonating?: boolean
  className?: string
}

function initialState(p: PaywallProps): RequestState {
  if (p.impersonating) return 'impersonation'
  if (p.initialRequested === true) return 'sent'
  if (p.initialRequested === false) return p.initialOpenOther ? 'add' : 'idle'
  return 'checking'
}

export default function Paywall(props: PaywallProps) {
  const { feature, variant = 'page', initialRequested, impersonating, className } = props
  const copy = paywallCopy(feature)
  const [state, setState] = useState<RequestState>(() => initialState(props))

  useEffect(() => {
    if (initialRequested !== undefined || impersonating) return
    let cancelled = false
    void readAccessRequest(fetch).then((info) => {
      if (!cancelled) setState((s) => (s === 'checking' ? requestStateFor(feature, info) : s))
    })
    return () => { cancelled = true }
  }, [initialRequested, impersonating, feature])

  const request = async () => {
    if (state === 'sending' || state === 'sent' || state === 'impersonation' || state === 'checking') return
    setState('sending')
    setState(await sendAccessRequest(fetch, feature))
  }

  const compact = variant === 'compact'
  const headingId = `paywall-${feature}-title`

  const button = (
    <button
      type="button"
      onClick={() => void request()}
      disabled={state === 'sending' || state === 'sent' || state === 'checking' || state === 'impersonation'}
      data-track="pro-upgrade-request"
      data-feature={feature}
      className={BTN_PRIMARY}
    >
      <Icon name={state === 'sent' ? 'check_circle' : 'mail'} className="text-[16px]" />
      {state === 'sending' ? 'Отправляем…' : state === 'sent' ? 'Заявка отправлена' : state === 'add' ? ADD_LABEL : REQUEST_LABEL}
    </button>
  )

  const status = (
    <p role="status" aria-live="polite" className="text-xs">
      {state === 'sent' && <span className="text-primary">{SENT_TEXT}</span>}
      {state === 'add' && <span className="text-on-surface-variant">{ADD_HINT}</span>}
      {state === 'error' && <span className="text-error">{ERROR_TEXT}</span>}
      {state === 'impersonation' && <span className="text-on-surface-variant">{IMPERSONATION_TEXT}</span>}
    </p>
  )

  if (compact) {
    return (
      <section className={cn(CARD, className)} aria-labelledby={headingId} data-paywall={feature}>
        <div className="flex items-start gap-3">
          <Icon name="lock" className="mt-0.5 shrink-0 text-xl text-primary" />
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="text-sm font-semibold text-on-surface">{copy.title}</h2>
            <p className="mt-1 text-xs text-on-surface-variant">{copy.lead}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {button}
              {status}
            </div>
            <p className="mt-2 text-[11px] text-on-surface-variant/70">{PAYMENT_NOTE}</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={cn(CARD, 'mx-auto max-w-2xl', className)} aria-labelledby={headingId} data-paywall={feature}>
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
          <Icon name="lock" className="text-2xl text-primary" />
        </span>
        <div className="min-w-0">
          <span className={`${CHIP} bg-primary/10 text-primary`}>Платный доступ</span>
          <h2 id={headingId} className="mt-1.5 text-lg font-bold text-on-surface">{copy.title}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">{copy.lead}</p>
        </div>
      </div>

      {copy.includes.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant/80">Что входит</p>
          <ul className="mt-2 space-y-2">
            {copy.includes.map((f) => (
              <li key={f.text} className="flex items-start gap-2 text-sm text-on-surface-variant">
                <Icon name={f.icon} className="mt-0.5 text-base text-primary" />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {button}
        {status}
      </div>
      <p className="mt-3 text-xs text-on-surface-variant/80">{PAYMENT_NOTE}</p>

      {copy.free && copy.free.length > 0 && (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-xs text-on-surface-variant">
          Бесплатно доступно:{' '}
          {copy.free.map((f, i) => (
            <span key={f.href}>
              {i > 0 && ', '}
              <Link href={f.href} className="text-primary hover:underline">{f.label}</Link>
            </span>
          ))}
        </p>
      )}
    </section>
  )
}
