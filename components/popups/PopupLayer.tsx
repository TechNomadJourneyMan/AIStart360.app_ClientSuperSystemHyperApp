'use client'

/**
 * components/popups/PopupLayer.tsx — the global pop-up layer of the client
 * cabinet (spec §12.2). Mounted once in app/client/layout.tsx next to the
 * assistant. Shows ONE window at a time: a card in the corner, or — only for
 * an important expert message — a modal.
 *
 * Placement keeps the assistant «Гри» free (it lives bottom-right, 24 px from
 * the bottom on a desktop, 80 px on a phone, z-30): the card sits bottom-left
 * on a desktop; on a phone it is a bottom sheet that leaves the right 6.5 rem
 * to the assistant and stays above the bottom navigation. Errors and empty
 * answers draw nothing.
 */
import { PopupCard } from './PopupCard'
import { PopupModal } from './PopupModal'
import { usePopups } from './usePopups'

export function PopupLayer() {
  const { current, dismiss, snooze, reply, act } = usePopups()
  // An expert message closes when its conversation opens; an insight / a recommendation is «acted».
  const onOpen = (id: string) => (current?.kind === 'expert_message' ? dismiss(id) : act(id))

  if (current?.display === 'modal') {
    return (
      <PopupModal
        key={current.id}
        popup={current}
        onDismiss={() => dismiss(current.id)}
        onSnooze={(days) => snooze(current.id, days)}
        onReply={(text) => reply(current.id, text)}
        onOpen={() => onOpen(current.id)}
      />
    )
  }

  return (
    <div
      data-popup-layer
      aria-live="polite"
      className="pointer-events-none fixed bottom-20 left-3 right-[6.5rem] z-40 max-w-md lg:bottom-6 lg:left-6 lg:right-auto lg:w-[22rem]"
    >
      {current && (
        <PopupCard
          key={current.id}
          popup={current}
          onDismiss={() => dismiss(current.id)}
          onSnooze={(days) => snooze(current.id, days)}
          onReply={(text) => reply(current.id, text)}
          onOpen={() => onOpen(current.id)}
        />
      )}
    </div>
  )
}

export default PopupLayer
