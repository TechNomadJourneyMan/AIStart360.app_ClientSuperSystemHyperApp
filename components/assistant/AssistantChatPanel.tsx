'use client'

/**
 * components/assistant/AssistantChatPanel.tsx — the Гри chat.
 *
 * v1.2: a real multi-turn chat thread (client-side session memory) instead of
 * a single pinned answer. Layout:
 *
 *   header  — title, page-mode subtitle, hamburger (all questions ⇄ this page)
 *   body    — Гри's page tip → collapsible quick questions (page-scoped,
 *             searchable) → the message thread (+ typing indicator)
 *   footer  — ONE universal input + three actions:
 *             [Спросить Гри] → POST /api/v1/assistant/converse (history-aware)
 *             [Инсайт]       → POST /api/v1/assistant/insight
 *             [Эксперт]      → POST /api/v1/assistant/escalate
 *
 * Safety contract stays intact: facts come only from the caller's own curated
 * snapshot server-side; the thread lives in memory only (a reload starts
 * fresh); ready-made questions still go through /chat (deterministic hydrate).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getSection } from '@/lib/assistant/sections'
import { SCREEN_PANEL_SECTIONS, SCREEN_TIPS } from '@/lib/assistant/mascot/hints'
import { MascotAvatar } from '@/components/assistant/mascot/MascotAvatar'
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
  pageTip: string
  onThisPage: string
  showAll: string
  showPageOnly: string
  quickQuestions: string
  typing: string
  welcome: string
  insightBtn: string
  insightLabel: string
  insightFail: string
  askExpertWith: string
  offTopic: string
  expertRouted: string
}> = {
  ru: {
    title: 'Гри',
    subtitle: 'Чат по вашим данным',
    close: 'Закрыть',
    insufficient: 'Недостаточно данных для точного ответа — заполните анкету или загрузите отчёты.',
    source: 'Источник',
    noScripts: 'Готовые вопросы пока недоступны.',
    answerFailed: 'Не удалось получить ответ',
    networkError: 'Ошибка сети',
    escalated: 'Запрос отправлен — эксперт свяжется с вами',
    sending: 'Отправляем…',
    callExpert: 'Эксперт',
    escalateFailed: 'Не удалось отправить запрос',
    disclaimer: 'Гри отвечает только по вашим данным — без догадок.',
    openAssistant: 'Открыть ассистента',
    searchPlaceholder: 'Поиск по вопросам…',
    noMatches: 'Ничего не найдено по запросу.',
    askPlaceholder: 'Спросите Гри о ваших данных…',
    askButton: 'Спросить Гри',
    asking: 'Думаю…',
    pageTip: 'Совет Гри',
    onThisPage: 'По этой странице',
    showAll: 'Показать все вопросы',
    showPageOnly: 'Только по этой странице',
    quickQuestions: 'Быстрые вопросы',
    typing: 'Гри печатает…',
    welcome: 'Мяу! Я Гри 🐾 Спрашивайте про ваш бизнес и диагностику — отвечаю только по вашим данным, без догадок. Ниже есть быстрые вопросы по этой странице.',
    insightBtn: 'Инсайт',
    insightLabel: 'Инсайт Гри',
    insightFail: 'Пока не хватает данных для инсайта — заполните ещё немного анкеты 🐾',
    askExpertWith: 'Позвать эксперта с этим вопросом',
    offTopic: 'не по теме данных',
    expertRouted: 'Запрос передан эксперту — он свяжется с вами 🐾',
  },
  en: {
    title: 'Gree',
    subtitle: 'Chat about your data',
    close: 'Close',
    insufficient: 'Not enough data for a precise answer — complete the survey or upload reports.',
    source: 'Source',
    noScripts: 'Ready-made questions are not available yet.',
    answerFailed: 'Could not get an answer',
    networkError: 'Network error',
    escalated: 'Request sent — an expert will be in touch',
    sending: 'Sending…',
    callExpert: 'Expert',
    escalateFailed: 'Could not send the request',
    disclaimer: 'Gree answers only from your data — no guesswork.',
    openAssistant: 'Open the assistant',
    searchPlaceholder: 'Search questions…',
    noMatches: 'No questions match your search.',
    askPlaceholder: 'Ask Gree about your data…',
    askButton: 'Ask Gree',
    asking: 'Thinking…',
    pageTip: 'Gree’s tip',
    onThisPage: 'On this page',
    showAll: 'Show all questions',
    showPageOnly: 'Only for this page',
    quickQuestions: 'Quick questions',
    typing: 'Gree is typing…',
    welcome: 'Meow! I’m Gree 🐾 Ask about your business and diagnostics — I answer only from your data, no guesswork. Quick questions for this page are below.',
    insightBtn: 'Insight',
    insightLabel: 'Gree’s insight',
    insightFail: 'Not enough data for an insight yet — fill in a bit more of the survey 🐾',
    askExpertWith: 'Ask an expert this question',
    offTopic: 'off-topic for your data',
    expertRouted: 'Handed to an expert — they will be in touch 🐾',
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

/** One thread entry. `system` renders as a centered notice. */
interface ChatMsg {
  id: string
  role: 'user' | 'gree' | 'system'
  text: string
  kind?: 'free' | 'script' | 'insight'
  insufficient?: boolean
  usedData?: string
  needsExpert?: boolean
  offTopic?: boolean
}

let msgSeq = 0
const nextId = () => `m${Date.now().toString(36)}${(msgSeq++).toString(36)}`

function sectionLabel(key: string): string {
  return getSection(key)?.label ?? key
}

function matchesQuery(item: ScriptItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    item.question.toLowerCase().includes(q) ||
    (item.valueLine ?? '').toLowerCase().includes(q)
  )
}

export function AssistantChatPanel({
  open,
  onClose,
  currentScreen,
}: {
  open: boolean
  onClose: () => void
  /** Normalized screen (hints.normalizeScreen) — enables the page-context mode. */
  currentScreen?: string
}) {
  const [groups, setGroups] = useState<ScriptGroup[]>([])
  const [loadingScripts, setLoadingScripts] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [quickOpen, setQuickOpen] = useState(true)
  const [query, setQuery] = useState('')

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [busy, setBusy] = useState<null | 'ask' | 'insight' | 'expert' | 'script'>(null)
  const [input, setInput] = useState('')

  const bodyRef = useRef<HTMLDivElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const welcomedRef = useRef(false)

  const [locale, setLocale] = useState<Locale>('ru')
  const t = T[locale]

  useEffect(() => {
    setLocale(getClientLocale())
  }, [])

  // ── Quick-question catalog (page-scoped + hamburger + search) ──────────────
  const filteredGroups = useMemo<ScriptGroup[]>(() => {
    const q = query.trim()
    if (!q) return groups
    return groups
      .map((g) => ({ ...g, scripts: g.scripts.filter((s) => matchesQuery(s, q)) }))
      .filter((g) => g.scripts.length > 0)
  }, [groups, query])

  const relevantSections = currentScreen ? SCREEN_PANEL_SECTIONS[currentScreen] ?? null : null
  const pageTip = currentScreen ? SCREEN_TIPS[currentScreen] ?? null : null

  const displayGroups = useMemo<ScriptGroup[]>(() => {
    if (query.trim() || showAll || !relevantSections) return filteredGroups
    const relevant = filteredGroups.filter((g) => relevantSections.includes(g.section))
    relevant.sort(
      (a, b) => relevantSections.indexOf(a.section) - relevantSections.indexOf(b.section),
    )
    return relevant.length > 0 ? relevant : filteredGroups
  }, [filteredGroups, query, showAll, relevantSections])

  const pageMode = !!relevantSections && !showAll && !query.trim()

  useEffect(() => {
    setShowAll(false)
  }, [currentScreen])

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

  // Гри greets once per mounted session when the thread is empty.
  useEffect(() => {
    if (open && !welcomedRef.current && messages.length === 0) {
      welcomedRef.current = true
      setMessages([{ id: nextId(), role: 'gree', text: t.welcome, kind: 'free' }])
    }
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

  // Keep the thread pinned to the newest message.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  const push = useCallback((msg: Omit<ChatMsg, 'id'>) => {
    setMessages((prev) => [...prev, { ...msg, id: nextId() }])
  }, [])

  /** Last turns of the thread → the /converse history payload. */
  const historyPayload = useCallback(() => {
    return messages
      .filter((m) => (m.role === 'user' || m.role === 'gree') && m.kind !== 'insight')
      .slice(-8)
      .map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text.slice(0, 600),
      }))
  }, [messages])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const askGree = useCallback(async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    const history = historyPayload()
    push({ role: 'user', text: q, kind: 'free' })
    setBusy('ask')
    try {
      const res = await fetch('/api/v1/assistant/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: q, history, screen: currentScreen }),
      })
      const json = (await res.json()) as {
        ok: boolean
        answer?: string | null
        needs_expert?: boolean
        on_topic?: boolean
        error?: string
      }
      if (res.ok && json.ok) {
        if (json.answer) {
          push({
            role: 'gree',
            text: json.answer,
            kind: 'free',
            needsExpert: !!json.needs_expert,
            offTopic: json.on_topic === false,
          })
        } else {
          push({ role: 'gree', text: t.insufficient, kind: 'free', needsExpert: true })
        }
      } else {
        push({ role: 'system', text: json.error === 'rate_limited' ? '⏳ ' + t.answerFailed : t.answerFailed })
      }
    } catch {
      push({ role: 'system', text: t.networkError })
    } finally {
      setBusy(null)
    }
  }, [input, busy, historyPayload, push, currentScreen, t])

  const askScript = useCallback(
    async (item: ScriptItem) => {
      if (busy) return
      push({ role: 'user', text: item.question, kind: 'script' })
      setBusy('script')
      setQuickOpen(false)
      try {
        const res = await fetch('/api/v1/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ scriptId: item.id }),
        })
        const json = (await res.json()) as {
          ok: boolean
          answer_ru?: string
          used_data?: string
          insufficient?: boolean
          error?: string
        }
        if (res.ok && json.ok && typeof json.answer_ru === 'string') {
          push({
            role: 'gree',
            text: json.answer_ru,
            kind: 'script',
            insufficient: !!json.insufficient,
            usedData: json.used_data || undefined,
          })
        } else {
          push({ role: 'system', text: json.error || t.answerFailed })
        }
      } catch {
        push({ role: 'system', text: t.networkError })
      } finally {
        setBusy(null)
      }
    },
    [busy, push, t],
  )

  const askInsight = useCallback(async () => {
    if (busy) return
    setBusy('insight')
    try {
      const res = await fetch('/api/v1/assistant/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ screen: currentScreen ?? 'chat' }),
      })
      const json = (await res.json()) as { ok: boolean; insight?: string | null }
      push({
        role: 'gree',
        text: json.ok && json.insight ? json.insight : t.insightFail,
        kind: 'insight',
      })
    } catch {
      push({ role: 'system', text: t.networkError })
    } finally {
      setBusy(null)
    }
  }, [busy, push, currentScreen, t])

  const callExpert = useCallback(
    async (question?: string) => {
      if (busy) return
      const userMessage =
        question ??
        input.trim() ??
        undefined
      setBusy('expert')
      try {
        const res = await fetch('/api/v1/assistant/escalate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            trigger_type: 'user_requested_help',
            ...(userMessage ? { userMessage } : {}),
          }),
        })
        const json = (await res.json()) as { ok: boolean; error?: string }
        if (res.ok && json.ok) {
          push({ role: 'system', text: t.expertRouted })
          toast.success(t.escalated)
          if (!question) setInput('')
        } else {
          push({ role: 'system', text: json.error || t.escalateFailed })
        }
      } catch {
        push({ role: 'system', text: t.networkError })
      } finally {
        setBusy(null)
      }
    },
    [busy, input, push, t],
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  const quickCount = displayGroups.reduce((n, g) => n + g.scripts.length, 0)

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
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden">
              <MascotAvatar pose="idle" size={30} headOnly paused />
            </div>
            <div>
              <h2 className="text-sm font-bold text-on-surface">{t.title}</h2>
              <p className="text-[10px] text-on-surface-variant">
                {pageMode ? t.onThisPage : t.subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {relevantSections && (
              <button
                onClick={() => {
                  setShowAll((v) => !v)
                  setQuickOpen(true)
                }}
                aria-pressed={showAll}
                aria-label={showAll ? t.showPageOnly : t.showAll}
                title={showAll ? t.showPageOnly : t.showAll}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                  showAll
                    ? 'text-primary bg-primary/10'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-white/[0.05]'
                }`}
              >
                <span className="material-symbols-outlined text-lg">menu</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-white/[0.05] transition-all"
              aria-label={t.close}
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </header>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Гри's page tip — visible while the thread is fresh. */}
          {pageTip && messages.length <= 1 && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-primary/15 bg-primary/[0.05] px-3.5 py-3">
              <span className="material-symbols-outlined text-base text-primary mt-0.5 flex-shrink-0">
                pets
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-0.5">
                  {t.pageTip}
                </p>
                <p className="text-xs text-on-surface leading-snug">{pageTip}</p>
              </div>
            </div>
          )}

          {/* Quick questions — collapsible, page-scoped, searchable. */}
          <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low/60">
            <button
              onClick={() => setQuickOpen((v) => !v)}
              aria-expanded={quickOpen}
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-left"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-on-surface">
                <span className="material-symbols-outlined text-base text-primary">bolt</span>
                {t.quickQuestions}
                {quickCount > 0 && (
                  <span className="text-[10px] font-mono text-on-surface-variant">{quickCount}</span>
                )}
              </span>
              <span className="material-symbols-outlined text-base text-on-surface-variant">
                {quickOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {quickOpen && (
              <div className="px-3.5 pb-3.5 space-y-3">
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
                      className="w-full rounded-xl border border-white/[0.08] bg-surface-container-low pl-9 pr-9 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all"
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

                {loadingScripts ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-9 bg-white/[0.04] rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : groups.length === 0 ? (
                  <p className="text-xs text-on-surface-variant text-center py-4">{t.noScripts}</p>
                ) : displayGroups.length === 0 ? (
                  <p className="text-xs text-on-surface-variant text-center py-4">{t.noMatches}</p>
                ) : (
                  displayGroups.map((group) => (
                    <div key={group.section}>
                      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5">
                        {sectionLabel(group.section)}
                      </p>
                      <div className="space-y-1.5">
                        {group.scripts.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => askScript(item)}
                            disabled={!!busy}
                            className="w-full text-left flex items-start gap-2 rounded-xl border px-3 py-2 transition-all border-white/[0.06] bg-surface-container-low hover:border-primary/20 hover:bg-white/[0.03] disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-sm mt-0.5 flex-shrink-0 text-on-surface-variant">
                              help
                            </span>
                            <span className="text-xs leading-snug text-on-surface">{item.question}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}

                {pageMode && !loadingScripts && filteredGroups.length > displayGroups.length && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface hover:border-primary/20 hover:bg-white/[0.03] transition-all"
                  >
                    <span className="material-symbols-outlined text-base">menu</span>
                    {t.showAll}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Thread */}
          <div className="space-y-3" aria-live="polite">
            {messages.map((m) =>
              m.role === 'system' ? (
                <p key={m.id} className="text-center text-[11px] text-on-surface-variant px-4">
                  {m.text}
                </p>
              ) : m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md border border-primary/25 bg-primary/10 px-3.5 py-2.5">
                    <p className="text-sm text-on-surface leading-relaxed whitespace-pre-line">{m.text}</p>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex items-end gap-2">
                  <div className="w-7 h-7 rounded-full bg-surface-container-high flex-shrink-0 flex items-center justify-center overflow-hidden">
                    <MascotAvatar pose="idle" size={22} headOnly paused />
                  </div>
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-white/[0.08] bg-surface-container-low px-3.5 py-2.5">
                    {m.kind === 'insight' && (
                      <p className="flex items-center gap-1 text-[10px] font-mono text-primary/80 uppercase tracking-widest mb-1">
                        <span className="material-symbols-outlined text-xs">tips_and_updates</span>
                        {t.insightLabel}
                      </p>
                    )}
                    {m.insufficient && (
                      <p className="flex items-start gap-1.5 mb-2 text-[11px] text-amber-300 leading-snug">
                        <span className="material-symbols-outlined text-sm mt-px flex-shrink-0">info</span>
                        {t.insufficient}
                      </p>
                    )}
                    <p className="text-sm text-on-surface leading-relaxed whitespace-pre-line">{m.text}</p>
                    {m.usedData && (
                      <p className="mt-2 pt-2 border-t border-white/[0.06] text-[10px] font-mono text-on-surface-variant">
                        {t.source}: {m.usedData}
                      </p>
                    )}
                    {m.needsExpert && (
                      <button
                        onClick={() => {
                          const lastUser = [...messages].reverse().find((x) => x.role === 'user')
                          void callExpert(lastUser?.text)
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/[0.12] transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm">support_agent</span>
                        {t.askExpertWith}
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}

            {/* Typing indicator */}
            {busy && busy !== 'expert' && (
              <div className="flex items-end gap-2">
                <div className="w-7 h-7 rounded-full bg-surface-container-high flex-shrink-0 flex items-center justify-center overflow-hidden">
                  <MascotAvatar pose="loading" size={22} headOnly paused />
                </div>
                <div className="rounded-2xl rounded-bl-md border border-white/[0.08] bg-surface-container-low px-3.5 py-2.5">
                  <span className="text-xs text-on-surface-variant inline-flex items-center gap-1.5">
                    {t.typing}
                    <span className="inline-flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-1 h-1 rounded-full bg-primary/70 animate-bounce"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </span>
                  </span>
                </div>
              </div>
            )}
            <div ref={threadEndRef} />
          </div>
        </div>

        {/* Footer — the universal input + three actions. */}
        <footer className="px-5 py-4 border-t border-white/[0.06] flex-shrink-0 space-y-2.5">
          <div className="rounded-2xl border border-white/[0.08] bg-surface-container-low focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void askGree()
                }
              }}
              rows={2}
              maxLength={1000}
              disabled={busy === 'ask'}
              placeholder={t.askPlaceholder}
              aria-label={t.askPlaceholder}
              className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none disabled:opacity-60"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void askGree()}
              disabled={!!busy || !input.trim()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-[#003824] font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className={`material-symbols-outlined text-base ${busy === 'ask' ? 'animate-spin' : ''}`}>
                {busy === 'ask' ? 'progress_activity' : 'send'}
              </span>
              {busy === 'ask' ? t.asking : t.askButton}
            </button>
            <button
              onClick={() => void askInsight()}
              disabled={!!busy}
              title={t.insightLabel}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-primary/30 bg-primary/[0.06] text-primary font-semibold text-xs hover:bg-primary/[0.12] transition-colors disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-base ${busy === 'insight' ? 'animate-spin' : ''}`}>
                {busy === 'insight' ? 'progress_activity' : 'tips_and_updates'}
              </span>
              {t.insightBtn}
            </button>
            <button
              onClick={() => void callExpert()}
              disabled={!!busy}
              title={t.escalated}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-white/[0.1] text-on-surface-variant font-semibold text-xs hover:text-on-surface hover:border-primary/25 hover:bg-white/[0.03] transition-colors disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-base ${busy === 'expert' ? 'animate-spin' : ''}`}>
                {busy === 'expert' ? 'progress_activity' : 'support_agent'}
              </span>
              {t.callExpert}
            </button>
          </div>

          <p className="text-[10px] text-on-surface-variant/60 text-center">{t.disclaimer}</p>
        </footer>
      </aside>
    </>
  )
}

/**
 * Floating dock button + panel state. Kept as the feature-flag/error fallback
 * for the mascot (MascotLauncher) — same panel, no page context.
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
        className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-30 inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[0.98] transition-transform"
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
