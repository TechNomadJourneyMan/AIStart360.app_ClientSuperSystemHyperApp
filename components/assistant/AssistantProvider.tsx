'use client'

/**
 * components/assistant/AssistantProvider.tsx
 *
 * Global Smart Assistant wiring. Mounted once near the root (app/providers.tsx)
 * so the assistant is reachable from EVERY authenticated page:
 *
 *   • A floating dock button (bottom-right) opens the slide-over assistant panel.
 *   • Any <HelpButton/> ("?" affordance) anywhere in the app opens the same panel
 *     via the `useAssistant()` context — optionally with a contextual `topic`.
 *
 * The dock + panel are hidden on public / marketing routes (login, register,
 * landing, presentation, giga-login) — there is no client session there, so the
 * assistant would have nothing to answer from.
 *
 * One global panel instance = one open/close state, no duplicate script fetches.
 * Copy follows the portal locale (cookie → default Russian); premium dark tokens.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import { AssistantChatPanel } from './AssistantChatPanel'
import { getClientLocale, type Locale } from '@/lib/i18n/locale'

interface OpenOptions {
  /** Short section label shown as a chip in the panel header (e.g. "Анализ рынка"). */
  topic?: string
}

interface AssistantContextValue {
  open: boolean
  openAssistant: (opts?: OpenOptions) => void
  closeAssistant: () => void
  toggleAssistant: () => void
}

const AssistantContext = createContext<AssistantContextValue | null>(null)

/**
 * Access the global assistant. Falls back to a safe no-op when used outside the
 * provider (e.g. on a public page) so a stray <HelpButton/> never crashes.
 */
export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext)
  if (ctx) return ctx
  return {
    open: false,
    openAssistant: () => {},
    closeAssistant: () => {},
    toggleAssistant: () => {},
  }
}

// Routes where the assistant dock + panel must NOT appear (no client session).
const HIDDEN_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/auth',
  '/giga-login',
  '/presentation',
]

const DOCK_LABEL: Record<Locale, { open: string; help: string }> = {
  ru: { open: 'Открыть ассистента', help: 'Ассистент' },
  en: { open: 'Open the assistant', help: 'Assistant' },
}

function AssistantDock({ locale, onOpen }: { locale: Locale; onOpen: () => void }) {
  const t = DOCK_LABEL[locale]
  return (
    <>
      {/* Mobile: vertical tab pinned to the right edge */}
      <button
        onClick={onOpen}
        aria-label={t.open}
        className="md:hidden fixed right-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1.5 rounded-l-2xl bg-gradient-to-b from-primary to-[#00e29e] text-[#003824] py-3 px-1.5 shadow-lg shadow-primary/30 active:scale-95 transition-transform"
      >
        <span className="material-symbols-outlined text-lg">assistant</span>
        <span className="[writing-mode:vertical-rl] text-[11px] font-bold tracking-wide">
          {t.help}
        </span>
        <span
          aria-hidden
          className="w-4 h-4 rounded-full bg-[#003824]/25 text-[9px] font-extrabold flex items-center justify-center"
        >
          ?
        </span>
      </button>

      {/* Desktop: floating pill, bottom-right */}
      <button
        onClick={onOpen}
        aria-label={t.open}
        title={t.open}
        className="hidden md:inline-flex fixed bottom-6 right-6 z-30 items-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm shadow-lg shadow-primary/25 hover:scale-[0.98] active:scale-95 transition-transform"
      >
        <span className="material-symbols-outlined text-lg">assistant</span>
        <span>{t.help}</span>
        <span
          aria-hidden
          className="ml-0.5 w-5 h-5 rounded-full bg-[#003824]/20 text-xs font-extrabold flex items-center justify-center"
        >
          ?
        </span>
      </button>
    </>
  )
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState<string | undefined>(undefined)
  const [locale, setLocale] = useState<Locale>('ru')
  const pathname = usePathname() || '/'

  useEffect(() => {
    setLocale(getClientLocale())
  }, [])

  const openAssistant = useCallback((opts?: OpenOptions) => {
    setTopic(opts?.topic)
    setOpen(true)
  }, [])
  const closeAssistant = useCallback(() => setOpen(false), [])
  const toggleAssistant = useCallback(() => setOpen((v) => !v), [])

  const value = useMemo(
    () => ({ open, openAssistant, closeAssistant, toggleAssistant }),
    [open, openAssistant, closeAssistant, toggleAssistant],
  )

  const isHidden =
    pathname === '/' || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {!isHidden && (
        <>
          <AssistantDock locale={locale} onOpen={() => openAssistant()} />
          <AssistantChatPanel open={open} onClose={closeAssistant} topic={topic} />
        </>
      )}
    </AssistantContext.Provider>
  )
}

export default AssistantProvider
