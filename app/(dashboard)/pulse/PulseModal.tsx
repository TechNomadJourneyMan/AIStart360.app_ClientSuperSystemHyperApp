'use client'

import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

// All three pulse dialogs used to be a hand-rolled `<div onClick>` backdrop:
// no role="dialog", no Escape, no focus trap, no focus return. Radix Dialog is
// already a dependency and is what MetricDrillDownModalV2 uses — same shell here
// so the behaviour matches the rest of the app instead of being re-invented.

export function PulseModal({
  open,
  onClose,
  icon,
  iconClass = 'bg-primary/10 text-primary',
  title,
  subtitle,
  size = 'md',
  children,
}: {
  open: boolean
  onClose: () => void
  icon: string
  /** Tone classes for the icon chip — literal strings, never interpolated. */
  iconClass?: string
  title: string
  subtitle?: string
  size?: 'md' | 'lg'
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={`fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] ${
            size === 'lg' ? 'max-w-lg' : 'max-w-md'
          } max-h-[85vh] overflow-y-auto bg-[#13151c] border border-white/[0.08] rounded-2xl shadow-2xl focus:outline-none`}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconClass}`}>
                <span className="material-symbols-outlined text-lg">{icon}</span>
              </span>
              <div className="min-w-0">
                <Dialog.Title className="text-sm font-semibold text-on-surface truncate">{title}</Dialog.Title>
                {subtitle
                  ? <Dialog.Description className="text-[10px] text-on-surface-variant truncate">{subtitle}</Dialog.Description>
                  : <Dialog.Description className="sr-only">Диалог</Dialog.Description>}
              </div>
            </div>
            <Dialog.Close
              aria-label="Закрыть"
              className="text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </Dialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
