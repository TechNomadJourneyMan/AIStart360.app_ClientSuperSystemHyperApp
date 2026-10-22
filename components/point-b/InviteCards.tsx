'use client'

/**
 * components/point-b/InviteCards.tsx — up to three personal invite cards on the «Обзор» (plan Ф6a Task 7, spec §12.1):
 * the title, the text, «Почему вы это видите» with the sources, «Открыть», «Позже» (3 / 7 / 30 days) and «Закрыть».
 * Behaviour lives in inviteController.ts; this file only draws it. Project tokens only — the PO will replace the design.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { PopupSnooze } from '@/components/popups/PopupCard'
import { cn } from '@/lib/utils'
import type { InviteView } from '@/lib/point-b/invites/types'
import type { RecSourceRef } from '@/lib/point-b/recs/types'
import { InviteController, previewFetch, type InviteSnoozeDays } from './inviteController'
import type { PointBTabKey } from './overviewModel'
import { INSIGHT_BADGE, SOURCE_TYPE_LABEL, WHY_LABEL, linkTarget, targetLabel } from './recsModel'
import { useGoToTab } from './tabs/PointBTabs'

export const INVITE_BADGE: Record<InviteView['kind'], string> = {
  insight: INSIGHT_BADGE,
  recommendation: 'Рекомендация, проверенная экспертом',
}

/** «Почему вы это видите»: the reason and the data it is built on (native <details>: keyboard friendly, no state). */
export function WhyDetails({ why, sources, label = WHY_LABEL }: { why: string | null; sources: RecSourceRef[]; label?: string }) {
  if (!why && sources.length === 0) return null
  return (
    <details className="group">
      <summary className="inline-flex min-h-[36px] cursor-pointer list-none items-center gap-1 rounded-lg text-xs font-medium text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
        <Icon name="help" className="text-base" />
        {label}
      </summary>
      <div className="mt-1 space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-on-surface-variant">
        {why && <p className="break-words">{why}</p>}
        {sources.length > 0 && (
          <ul className="space-y-0.5" aria-label="Источники">
            {sources.map((s, i) => (
              <li key={`${s.type}-${s.ref}-${i}`} className="break-words">
                <span className="text-on-surface-variant/80">{SOURCE_TYPE_LABEL[s.type]}:</span> <span className="text-on-surface">{s.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}

export interface InviteCardsViewProps {
  invites: InviteView[]
  busy: string | null
  error: string | null
  onOpenTab: (id: string, tab: PointBTabKey) => void
  onOpenLink: (id: string) => void
  onDismiss: (id: string) => void
  onSnooze: (id: string, days: InviteSnoozeDays) => void
}

function InviteCard({ invite, p }: { invite: InviteView; p: InviteCardsViewProps }) {
  const target = linkTarget(invite.href)
  const titleId = `pb-invite-${invite.id}`
  const disabled = p.busy !== null
  return (
    <li>
      <article aria-labelledby={titleId} className={cn(CARD, '!p-4 flex h-full flex-col gap-2')}>
        <div className="flex items-start justify-between gap-2">
          <span className={cn(CHIP, 'normal-case tracking-normal', invite.kind === 'recommendation' ? 'bg-primary/10 text-primary' : 'bg-white/[0.06] text-on-surface-variant')}>
            <Icon name={invite.kind === 'recommendation' ? 'verified' : 'lightbulb'} className="text-[14px]" />
            {INVITE_BADGE[invite.kind]}
          </span>
          <button
            type="button"
            onClick={() => p.onDismiss(invite.id)}
            disabled={disabled}
            aria-label={`Закрыть подсказку «${invite.title}»`}
            className="-mr-1 -mt-1 inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            <Icon name="close" className="text-base" />
          </button>
        </div>
        <h4 id={titleId} className="break-words text-sm font-semibold text-on-surface">{invite.title}</h4>
        {invite.body && <p className="break-words text-sm text-on-surface-variant">{invite.body}</p>}
        <WhyDetails why={invite.why || null} sources={invite.sourceRefs} />
        <div className="mt-auto flex flex-wrap items-start gap-1.5 pt-1">
          {target && 'tab' in target && (
            <button type="button" disabled={disabled} onClick={() => p.onOpenTab(invite.id, target.tab)} className={BTN_PRIMARY}>{targetLabel(target)}</button>
          )}
          {target && 'href' in target && (
            <Link href={target.href} onClick={() => p.onOpenLink(invite.id)} className={BTN_PRIMARY}>Открыть</Link>
          )}
          <PopupSnooze onSnooze={(d) => p.onSnooze(invite.id, d)} />
          <button type="button" disabled={disabled} onClick={() => p.onDismiss(invite.id)} className={BTN_GHOST}>Закрыть</button>
        </div>
      </article>
    </li>
  )
}

export function InviteCardsView(p: InviteCardsViewProps) {
  if (p.invites.length === 0 && !p.error) return null
  return (
    <section aria-labelledby="pb-invites" className="space-y-2">
      <h3 id="pb-invites" className="font-headline text-base font-bold text-on-surface">Подсказки для вас</h3>
      <div aria-live="polite">
        {p.error && <p role="alert" className="rounded-xl border border-error/30 bg-error/[0.06] px-3 py-2 text-xs text-error">{p.error}</p>}
      </div>
      {p.invites.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Подсказки">
          {p.invites.map((i) => <InviteCard key={i.id} invite={i} p={p} />)}
        </ul>
      )}
    </section>
  )
}

/** Stateful wrapper. `preview`: the dev preview — every action «succeeds» in memory, nothing leaves the page. */
export default function InviteCards({ invites, preview = false }: { invites: InviteView[]; preview?: boolean }) {
  const go = useGoToTab()
  // One controller per mount, seeded with the first list (so the server render already has the cards).
  const [ctl] = useState(() => new InviteController(preview ? previewFetch : (input, init) => fetch(input, init), invites))
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)

  // The page state (re)loaded: new cards in, those the user took away stay away.
  useEffect(() => { ctl.setInvites(invites) }, [ctl, invites])
  // Cards actually on the screen are «seen» (once each).
  const shown = snap.invites.map((i) => i.id).join('|')
  useEffect(() => { if (shown) void ctl.markSeen() }, [ctl, shown])

  return (
    <InviteCardsView
      invites={snap.invites}
      busy={snap.busy}
      error={snap.error}
      onOpenTab={(id, tab) => { go(tab); void ctl.act(id) }}
      onOpenLink={(id) => { void ctl.act(id) }}
      onDismiss={(id) => { void ctl.dismiss(id) }}
      onSnooze={(id, days) => { void ctl.snooze(id, days) }}
    />
  )
}
