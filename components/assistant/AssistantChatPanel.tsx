'use client'

/**
 * components/assistant/AssistantChatPanel.tsx
 *
 * Slide-over assistant panel (overlay, not a route). Launchable from the client
 * landing page / onboarding via the exported <AssistantChatLauncher/> dock button
 * (new file only — not wired into any page by this change).
 *
 * Behaviour:
 *   • GET /api/v1/assistant/scripts → ready-made questions grouped by section
 *     (7.1–7.12). Only safe presentational fields ship to the client.
 *   • Clicking a question → POST /api/v1/assistant/chat { scriptId } → renders the
 *     hydrated Russian answer with an honest "Недостаточно данных" state when the
 *     snapshot lacks the data (the route flips `insufficient`; we never fabricate).
 *   • Footer "Позвать эксперта" → POST /api/v1/assistant/escalate
 *     { trigger_type: 'user_requested_help' }.
 *
 * Tone: calm, professional, business-oriented. Copy follows the portal locale
 * (cookie → default Russian); premium dark tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast, Toaster } from 'sonner'
import { getSection } from '@/lib/assistant/sections'
import { getClientLocale, type Locale } from '@/lib/i18n/locale'

// ─── Localized copy (portal locale; ru is the default surface) ──────────────
const T: Record<Locale, {
  title: string
  subtitle: string
  close: string
  insufficient: string
  source: string
  noScripts: string
  answerFailed: string
  networkError: string
  escalated: string
  sending: string
  callExpert: string
  escalateFailed: string
  disclaimer: string
  openAssistant: string
  searchPlaceholder: string
  noMatches: string
  askPlaceholder: string
  askButton: string
  asking: string
  askToExpert: string
  expertHandoff: string
}> = {
  ru: {
    title: 'Ассистент',
    subtitle: 'Готовые вопросы по вашим данным',
    close: 'Закрыть',
    insufficient: 'Недостаточно данных для точного ответа — заполните анкету или загрузите отчёты.',
    source: 'Источник',
    noScripts: 'Готовые вопросы пока недоступны.',
    answerFailed: 'Не удалось получить ответ',
    networkError: 'Ошибка сети',
    escalated: 'Запрос отправлен — эксперт свяжется с вами',
    sending: 'Отправляем…',
    callExpert: 'Позвать эксперта',
    escalateFailed: 'Не удалось отправить запрос',
    disclaimer: 'Ассистент отвечает только по вашим данным — без догадок.',
    openAssistant: 'Открыть ассистента',
    searchPlaceholder: 'Поиск по вопросам…',
    noMatches: 'Ничего не найдено по запросу.',
    askPlaceholder: 'Задайте свой вопрос…',
    askButton: 'Спросить',
    asking: 'Думаю…',
    askToExpert: 'Передаём эксперту…',
    expertHandoff: 'Вопрос передан эксперту — он свяжется с вами',
  },
  en: {
    title: 'Assistant',
    subtitle: 'Ready-made questions about your data',
    close: 'Close',
    insufficient: 'Not enough data for a precise answer — complete the survey or upload reports.',
    source: 'Source',
    noScripts: 'Ready-made questions are not available yet.',
    answerFailed: 'Could not get an answer',
    networkError: 'Network error',
    escalated: 'Request sent — an expert will be in touch',
    sending: 'Sending…',
    callExpert: 'Call an expert',
    escalateFailed: 'Could not send the request',
    disclaimer: 'The assistant answers only from your data — no guesswork.',
    openAssistant: 'Open the assistant',
    searchPlaceholder: 'Search questions…',
    noMatches: 'No questions match your search.',
    askPlaceholder: 'Ask your own question…',
    askButton: 'Ask',
    asking: 'Thinking…',
    askToExpert: 'Handing to an expert…',
    expertHandoff: 'Your question has been passed to an expert — they will be in touch',
  },
}

interface ScriptItem {
  id: string
  question: string
  section: string
  valueLine: string | null
}
interface ScriptGroup {
  section: string
  scripts: ScriptItem[]
}
interface ChatAnswer {
  answer_ru: string
  used_data: string
  section: string
  insufficient: boolean
}

/**
 * Unified model for the PINNED answer card. It carries either a hydrated
 * prepared-question answer (`kind: 'script'`), a free-text AI answer
 * (`kind: 'free'`), or the expert-handoff state (`kind: 'expert'`) when the AI
 * couldn't answer the free question and the case was created server-side.
 */
type PinnedAnswer =
  | { kind: 'script'; question: string; answer: ChatAnswer }
  | { kind: 'free'; question: string; answer: string }
  | { kind: 'expert'; question: string; answer: string | null }

function sectionLabel(key: string): string {
  return getSection(key)?.label ?? key
}

/** Case-insensitive substring match for the live question filter. */
function matchesQuery(item: ScriptItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    item.question.toLowerCase().includes(q) ||
    (item.valueLine ?? '').toLowerCase().includes(q)
  )
}

export function AssistantChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [groups, setGroups] = useState<ScriptGroup[]>([])
  const [loadingScripts, setLoadingScripts] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  // The single PINNED answer (prepared OR free OR expert-handoff) — sticky at top.
  const [pinned, setPinned] = useState<PinnedAnswer | null>(null)
  const [answerLoading, setAnswerLoading] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)

  // Live filter over the prepared-question list (ask #2).
  const [query, setQuery] = useState('')

  // Free-text question input (ask #4 / #5).
  const [freeQuestion, setFreeQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const [escalating, setEscalating] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [escalateError, setEscalateError] = useState<string | null>(null)
  // Locale read after mount (cookie isn't available during SSR); default ru.
  const [locale, setLocale] = useState<Locale>('ru')
  const t = T[locale]

  useEffect(() => {
    setLocale(getClientLocale())
  }, [])

  // Filtered groups: drop questions that don't match the query, then drop now-
  // empty sections. Memoized so typing stays snappy.
  const filteredGroups = useMemo<ScriptGroup[]>(() => {
    const q = query.trim()
    if (!q) return groups
    return groups
      .map((g) => ({ ...g, scripts: g.scripts.filter((s) => matchesQuery(s, q)) }))
      .filter((g) => g.scripts.length > 0)
  }, [groups, query])

  const loadScripts = useCallback(async () => {
    setLoadingScripts(true)
    try {
      const res = await fetch('/api/v1/assistant/scripts', { cache: 'no-store', credentials: 'include' })
      const json = (await res.json()) as { ok: boolean; groups?: ScriptGroup[] }
      setGroups(res.ok && json.ok ? json.groups ?? [] : [])
    } catch {
      setGroups([])
    } finally {
      setLoadingScripts(false)
    }
  }, [])

  useEffect(() => {
    if (open && groups.length === 0 && !loadingScripts) loadScripts()
    // Only re-run when the panel is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Keep the pinned card in view whenever a new answer starts/arrives.
  const scrollToTop = useCallback(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const ask = async (item: ScriptItem) => {
    setActiveId(item.id)
    setPinned(null)
    setAnswerError(null)
    setAnswerLoading(true)
    scrollToTop()
    try {
      const res = await fetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scriptId: item.id }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string } & Partial<ChatAnswer>
      if (res.ok && json.ok && typeof json.answer_ru === 'string') {
        setPinned({
          kind: 'script',
          question: item.question,
          answer: {
            answer_ru: json.answer_ru,
            used_data: json.used_data ?? '',
            section: json.section ?? item.section,
            insufficient: Boolean(json.insufficient),
          },
        })
      } else {
        setAnswerError(json.error || t.answerFailed)
      }
    } catch {
      setAnswerError(t.networkError)
    } finally {
      setAnswerLoading(false)
    }
  }

  // Free-text question → POST /api/v1/assistant/ask. The answer (or the
  // expert-handoff state) lands in the PINNED card; on escalation a toast also
  // confirms it. The server creates the ExpertCase when it escalates.
  const askFree = async () => {
    const q = freeQuestion.trim()
    if (!q || asking) return
    setActiveId(null)
    setPinned(null)
    setAnswerError(null)
    setAnswerLoading(true)
    setAsking(true)
    scrollToTop()
    try {
      const res = await fetch('/api/v1/assistant/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ question: q }),
      })
      const json = (await res.json()) as {
        ok: boolean
        escalated?: boolean
        answer?: string | null
        error?: string
      }
      if (res.ok && json.ok) {
        if (json.escalated) {
          setPinned({ kind: 'expert', question: q, answer: json.answer ?? null })
          toast.success(t.expertHandoff)
        } else {
          setPinned({ kind: 'free', question: q, answer: json.answer ?? '' })
        }
        setFreeQuestion('')
      } else {
        setAnswerError(json.error || t.answerFailed)
      }
    } catch {
      setAnswerError(t.networkError)
    } finally {
      setAnswerLoading(false)
      setAsking(false)
    }
  }

  const callExpert = async () => {
    setEscalating(true)
    setEscalateError(null)
    try {
      const res = await fetch('/api/v1/assistant/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ trigger_type: 'user_requested_help' }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (res.ok && json.ok) setEscalated(true)
      else setEscalateError(json.error || t.escalateFailed)
    } catch {
      setEscalateError(t.networkError)
    } finally {
      setEscalating(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden
      />

      {/* Slide-over */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md bg-[#0c0e14] border-l border-white/[0.08] shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-base text-primary">assistant</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-on-surface">{t.title}</h2>
              <p className="text-[10px] text-on-surface-variant">{t.subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-white/[0.05] transition-all"
            aria-label={t.close}
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </header>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* PINNED answer — stays at the top while the list below scrolls (ask #1). */}
          {(answerLoading || pinned || answerError) && (
            <div className="sticky top-0 z-10 -mx-5 px-5 pt-0.5 pb-3 bg-[#0c0e14]">
              <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-4 shadow-lg shadow-black/20">
                {answerLoading ? (
                  <div className="space-y-2">
                    <div className="h-2.5 bg-white/[0.06] rounded-full animate-pulse" />
                    <div className="h-2.5 bg-white/[0.05] rounded-full animate-pulse w-3/4" />
                    <div className="h-2.5 bg-white/[0.05] rounded-full animate-pulse w-1/2" />
                  </div>
                ) : answerError ? (
                  <p className="flex items-start gap-2 text-xs text-error">
                    <span className="material-symbols-outlined text-sm mt-0.5">error</span>
                    {answerError}
                  </p>
                ) : pinned ? (
                  <>
                    {/* Echo the question being answered. */}
                    <p className="flex items-start gap-1.5 mb-2.5 text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">
                      <span className="material-symbols-outlined text-xs mt-px text-primary/70">
                        {pinned.kind === 'expert' ? 'support_agent' : 'help'}
                      </span>
                      <span className="normal-case tracking-normal text-[12px] text-on-surface/80 break-words">
                        {pinned.question}
                      </span>
                    </p>

                    {pinned.kind === 'script' ? (
                      <>
                        {pinned.answer.insufficient && (
                          <div className="flex items-start gap-2 mb-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2">
                            <span className="material-symbols-outlined text-sm text-amber-400 mt-0.5 flex-shrink-0">
                              info
                            </span>
                            <p className="text-[11px] text-amber-300 leading-snug">{t.insufficient}</p>
                          </div>
                        )}
                        <p className="text-sm text-on-surface leading-relaxed whitespace-pre-line">
                          {pinned.answer.answer_ru}
                        </p>
                        {pinned.answer.used_data && (
                          <p className="mt-3 pt-3 border-t border-white/[0.06] text-[10px] font-mono text-on-surface-variant">
                            {t.source}: {pinned.answer.used_data}
                          </p>
                        )}
                      </>
                    ) : pinned.kind === 'free' ? (
                      <p className="text-sm text-on-surface leading-relaxed whitespace-pre-line">
                        {pinned.answer}
                      </p>
                    ) : (
                      // Expert handoff — the AI couldn't answer; case created server-side.
                      <>
                        <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5">
                          <span className="material-symbols-outlined text-base text-primary mt-0.5 flex-shrink-0">
                            mark_email_read
                          </span>
                          <p className="text-sm text-primary leading-snug">{t.expertHandoff}</p>
                        </div>
                        {pinned.answer && (
                          <p className="mt-3 text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">
                            {pinned.answer}
                          </p>
                        )}
                      </>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* Search filter over the prepared questions (ask #2). */}
          {!loadingScripts && groups.length > 0 && (
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-base text-on-surface-variant pointer-events-none">
                search
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchPlaceholder}
                className="w-full rounded-xl border border-white/[0.08] bg-surface-container-low pl-9 pr-9 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label={t.close}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06] transition-all"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              )}
            </div>
          )}

          {/* Script catalog */}
          {loadingScripts ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-white/[0.04] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="text-xs text-on-surface-variant text-center py-8">{t.noScripts}</p>
          ) : filteredGroups.length === 0 ? (
            <p className="text-xs text-on-surface-variant text-center py-8">{t.noMatches}</p>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.section}>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
                  {sectionLabel(group.section)}
                </p>
                <div className="space-y-1.5">
                  {group.scripts.map((item) => {
                    const isActive = item.id === activeId
                    return (
                      <button
                        key={item.id}
                        onClick={() => ask(item)}
                        className={`w-full text-left flex items-start gap-2 rounded-xl border px-3 py-2.5 transition-all ${
                          isActive
                            ? 'border-primary/30 bg-primary/10'
                            : 'border-white/[0.06] bg-surface-container-low hover:border-primary/20 hover:bg-white/[0.03]'
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-sm mt-0.5 flex-shrink-0 ${
                            isActive ? 'text-primary' : 'text-on-surface-variant'
                          }`}
                        >
                          help
                        </span>
                        <div className="min-w-0">
                          <p className={`text-xs leading-snug ${isActive ? 'text-primary' : 'text-on-surface'}`}>
                            {item.question}
                          </p>
                          {item.valueLine && (
                            <p className="text-[10px] text-on-surface-variant mt-0.5">{item.valueLine}</p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer — free-text question + call an expert */}
        <footer className="px-5 py-4 border-t border-white/[0.06] flex-shrink-0 space-y-3">
          {/* Free-text question (ask #4 / #5). Enter sends; Shift+Enter = newline. */}
          <div className="rounded-2xl border border-white/[0.08] bg-surface-container-low focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <textarea
              value={freeQuestion}
              onChange={(e) => setFreeQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  askFree()
                }
              }}
              rows={2}
              maxLength={1000}
              disabled={asking}
              placeholder={t.askPlaceholder}
              aria-label={t.askPlaceholder}
              className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none disabled:opacity-60"
            />
            <div className="flex items-center justify-end px-2.5 pb-2.5">
              <button
                onClick={askFree}
                disabled={asking || !freeQuestion.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-[#003824] font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <span className={`material-symbols-outlined text-base ${asking ? 'animate-spin' : ''}`}>
                  {asking ? 'progress_activity' : 'send'}
                </span>
                {asking ? t.asking : t.askButton}
              </button>
            </div>
          </div>

          {escalated ? (
            <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 border border-primary/25 rounded-xl px-4 py-2.5">
              <span className="material-symbols-outlined text-base">mark_email_read</span>
              {t.escalated}
            </div>
          ) : (
            <button
              onClick={callExpert}
              disabled={escalating}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-primary/30 bg-primary/[0.06] text-primary font-semibold text-sm hover:bg-primary/[0.12] transition-colors disabled:opacity-60"
            >
              <span className={`material-symbols-outlined text-base ${escalating ? 'animate-spin' : ''}`}>
                {escalating ? 'progress_activity' : 'support_agent'}
              </span>
              {escalating ? t.sending : t.callExpert}
            </button>
          )}
          {escalateError && <p className="text-xs text-error text-center">{escalateError}</p>}
          <p className="text-[10px] text-on-surface-variant/60 text-center">
            {t.disclaimer}
          </p>
        </footer>
      </aside>

      {/* Local toaster so the expert-handoff confirmation renders even when no
          global <Toaster/> is mounted in a layout. */}
      <Toaster position="bottom-center" theme="dark" richColors />
    </>
  )
}

/**
 * Floating dock button + panel state. Drop this anywhere (e.g. in the client
 * landing page) to get a fixed launcher in the corner that opens the panel.
 */
export function AssistantChatLauncher() {
  const [open, setOpen] = useState(false)
  const [locale, setLocale] = useState<Locale>('ru')
  const t = T[locale]

  useEffect(() => {
    setLocale(getClientLocale())
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[0.98] transition-transform"
        aria-label={t.openAssistant}
      >
        <span className="material-symbols-outlined text-lg">assistant</span>
        <span className="hidden sm:inline">{t.title}</span>
      </button>
      <AssistantChatPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export default AssistantChatPanel
