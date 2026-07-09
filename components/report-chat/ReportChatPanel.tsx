'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

interface Grounding {
  type: string
  ref: string
  label: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  grounding?: Grounding[]
  confidence?: string
  needs_expert?: boolean
  suggested_next?: string[]
}

const PRESETS = [
  'Что значит мой GRI?',
  'Что делать первым?',
  'Объясни простыми словами',
  '3 самых опасных риска',
]

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
}

function asGrounding(raw: unknown): Grounding[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const items = raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      type: String(s.type ?? ''),
      ref: String(s.ref ?? ''),
      label: String(s.label ?? s.ref ?? ''),
    }))
    .filter((s) => s.label)
  return items.length ? items : undefined
}

/**
 * ReportChatPanel — «Спросить ГРИ об отчёте».
 *
 * Self-contained: renders its own trigger button plus a Modal-based chat, so it
 * drops into a server page with a single tag. On open it loads the last
 * conversation via GET /api/v1/ai/chat?surface=report; sending posts to the same
 * endpoint with surface:'report'. Grounded answers show their used_sources as
 * chips. All fetches are same-origin (cookie session) and degrade gracefully.
 */
export default function ReportChatPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  // Load the last conversation once, when the panel first opens.
  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    setLoadingHistory(true)
    setError(null)
    fetch('/api/v1/ai/chat?surface=report', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.ok && Array.isArray(data.messages)) {
          setMessages(
            (data.messages as Array<Record<string, unknown>>)
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: String(m.content ?? ''),
                grounding: asGrounding(m.grounding),
              })),
          )
        }
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить историю. Можно начать новый вопрос.')
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingHistory(false)
          scrollToBottom()
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, loaded, scrollToBottom])

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || sending) return
      setError(null)
      setInput('')
      setMessages((prev) => [...prev, { role: 'user', content: message }])
      setSending(true)
      scrollToBottom()
      try {
        const res = await fetch('/api/v1/ai/chat', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, surface: 'report' }),
        })
        const data = await res.json()
        if (data?.ok && typeof data.answer === 'string') {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: data.answer,
              grounding: asGrounding(data.used_sources),
              confidence: typeof data.confidence === 'string' ? data.confidence : undefined,
              needs_expert: !!data.needs_expert,
              suggested_next: Array.isArray(data.suggested_next)
                ? (data.suggested_next as unknown[]).map(String).slice(0, 3)
                : undefined,
            },
          ])
        } else {
          setError(data?.error ?? 'Не получилось ответить. Попробуйте ещё раз.')
        }
      } catch {
        setError('Сеть недоступна. Попробуйте ещё раз.')
      } finally {
        setSending(false)
        scrollToBottom()
      }
    },
    [sending, scrollToBottom],
  )

  return (
    <>
      <Button variant="secondary" size="sm" leftIcon="forum" onClick={() => setOpen(true)}>
        Спросить ГРИ об отчёте
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="ГРИ · вопросы по отчёту" size="lg">
        <div className="flex flex-col" style={{ height: 'min(70vh, 560px)' }}>
          {/* Message stream */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto -mx-2 px-2 space-y-4">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-10 text-on-surface-variant">
                <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <span className="material-symbols-outlined text-primary">psychology_alt</span>
                </div>
                <p className="text-sm text-on-surface font-medium">Спросите ГРИ про вашу диагностику</p>
                <p className="text-xs text-on-surface-variant mt-1">
                  Выберите вопрос ниже или напишите свой.
                </p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                        m.role === 'user'
                          ? 'bg-primary/15 text-on-surface border border-primary/20'
                          : 'bg-surface-container border border-white/[0.06] text-on-surface',
                      )}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>

                      {m.role === 'assistant' && m.grounding && m.grounding.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-white/[0.06]">
                          {m.grounding.map((g, gi) => (
                            <span
                              key={gi}
                              className="inline-flex items-center gap-1 rounded-lg bg-surface-container-high px-2 py-0.5 text-[10px] font-mono text-on-surface-variant"
                            >
                              <span className="material-symbols-outlined text-[12px] text-primary/70">
                                database
                              </span>
                              {g.label}
                            </span>
                          ))}
                        </div>
                      )}

                      {m.role === 'assistant' && (m.confidence || m.needs_expert) && (
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] font-mono text-on-surface-variant">
                          {m.confidence && CONFIDENCE_LABEL[m.confidence] && (
                            <span className="uppercase tracking-wider">
                              Уверенность: {CONFIDENCE_LABEL[m.confidence]}
                            </span>
                          )}
                          {m.needs_expert && (
                            <span className="inline-flex items-center gap-1 text-amber-400">
                              <span className="material-symbols-outlined text-[12px]">support_agent</span>
                              стоит спросить эксперта
                            </span>
                          )}
                        </div>
                      )}

                      {m.role === 'assistant' && m.suggested_next && m.suggested_next.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {m.suggested_next.map((s, si) => (
                            <button
                              key={si}
                              type="button"
                              disabled={sending}
                              onClick={() => void send(s)}
                              className="rounded-lg border border-primary/20 text-primary bg-transparent hover:bg-primary/5 px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}

            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-surface-container border border-white/[0.06] px-4 py-3">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.1s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Preset chips */}
          <div className="flex flex-wrap gap-2 pt-3 mt-3 border-t border-white/[0.06]">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={sending}
                onClick={() => void send(p)}
                className="rounded-xl border border-white/[0.08] bg-surface-container hover:border-primary/30 hover:text-primary text-on-surface-variant px-3 py-1.5 text-xs transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {p}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-xs text-error mt-2" role="alert">
              {error}
            </p>
          )}

          {/* Composer */}
          <form
            className="flex items-end gap-2 mt-3"
            onSubmit={(e) => {
              e.preventDefault()
              void send(input)
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              rows={1}
              placeholder="Спросите про ваш отчёт…"
              aria-label="Сообщение для ГРИ"
              className="flex-1 resize-none bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all max-h-32"
            />
            <Button
              type="submit"
              variant="primary"
              size="icon"
              loading={sending}
              disabled={!input.trim()}
              aria-label="Отправить"
            >
              {!sending && <span className="material-symbols-outlined">send</span>}
            </Button>
          </form>

          {/* Disclaimer */}
          <p className="text-[11px] text-on-surface-variant/70 mt-2.5 leading-relaxed">
            ГРИ объясняет вашу диагностику и не даёт юридических или финансовых гарантий.
          </p>
        </div>
      </Modal>
    </>
  )
}
