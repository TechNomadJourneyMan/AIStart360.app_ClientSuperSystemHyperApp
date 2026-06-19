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

import { useCallback, useEffect, useState } from 'react'
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

function sectionLabel(key: string): string {
  return getSection(key)?.label ?? key
}

export function AssistantChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [groups, setGroups] = useState<ScriptGroup[]>([])
  const [loadingScripts, setLoadingScripts] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [answer, setAnswer] = useState<ChatAnswer | null>(null)
  const [answerLoading, setAnswerLoading] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)

  const [escalating, setEscalating] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [escalateError, setEscalateError] = useState<string | null>(null)
  // Locale read after mount (cookie isn't available during SSR); default ru.
  const [locale, setLocale] = useState<Locale>('ru')
  const t = T[locale]

  useEffect(() => {
    setLocale(getClientLocale())
  }, [])

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

  const ask = async (item: ScriptItem) => {
    setActiveId(item.id)
    setAnswer(null)
    setAnswerError(null)
    setAnswerLoading(true)
    try {
      const res = await fetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scriptId: item.id }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string } & Partial<ChatAnswer>
      if (res.ok && json.ok && typeof json.answer_ru === 'string') {
        setAnswer({
          answer_ru: json.answer_ru,
          used_data: json.used_data ?? '',
          section: json.section ?? item.section,
          insufficient: Boolean(json.insufficient),
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
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Active answer */}
          {(answerLoading || answer || answerError) && (
            <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-4">
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
              ) : answer ? (
                <>
                  {answer.insufficient && (
                    <div className="flex items-start gap-2 mb-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2">
                      <span className="material-symbols-outlined text-sm text-amber-400 mt-0.5 flex-shrink-0">
                        info
                      </span>
                      <p className="text-[11px] text-amber-300 leading-snug">
                        {t.insufficient}
                      </p>
                    </div>
                  )}
                  <p className="text-sm text-on-surface leading-relaxed whitespace-pre-line">{answer.answer_ru}</p>
                  {answer.used_data && (
                    <p className="mt-3 pt-3 border-t border-white/[0.06] text-[10px] font-mono text-on-surface-variant">
                      {t.source}: {answer.used_data}
                    </p>
                  )}
                </>
              ) : null}
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
          ) : (
            groups.map((group) => (
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

        {/* Footer — call an expert */}
        <footer className="px-5 py-4 border-t border-white/[0.06] flex-shrink-0 space-y-2">
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
