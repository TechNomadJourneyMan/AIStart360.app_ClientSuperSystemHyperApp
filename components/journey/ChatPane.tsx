'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/lib/journey/state'

interface Props {
  messages: ChatMessage[]
  companyName: string
  industry: string
}

export function ChatPane({ messages, companyName, industry }: Props) {
  const [draft, setDraft] = useState('')
  const [local, setLocal] = useState(messages)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [local.length])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setLocal((m) => [
      ...m,
      {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
      },
    ])
    setDraft('')
    // Fake AI echo — real streaming lands in /api/journey/chat (todo)
    setTimeout(() => {
      setLocal((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text:
            'Принял. Пока это lab-версия — AI-стрим подключается следующим шагом. Виджеты справа обновятся после подключения /api/journey/chat.',
          createdAt: new Date().toISOString(),
        },
      ])
    }, 500)
  }

  return (
    <section className="flex flex-col bg-surface-container-low/40 rounded-2xl border border-white/[0.05] overflow-hidden min-h-0">

      {/* Header — subtle company chip */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.04]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-primary text-base">smart_toy</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-on-surface truncate">
              {companyName || 'Новый диалог'}
            </p>
            <p className="text-[10px] text-on-surface-variant truncate">
              {industry || 'AI ждёт первого сообщения'}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-on-surface-variant/60">
          Claude Sonnet 4.5
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-5 scroll-smooth">
        <AnimatePresence initial={false}>
          {local.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
        </AnimatePresence>
      </div>

      {/* Composer */}
      <div className="border-t border-white/[0.04] p-3">
        <div className="flex items-end gap-2 rounded-xl bg-surface-container border border-white/[0.06] focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all p-2">
          <button
            className="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
            title="Прикрепить файл"
          >
            <span className="material-symbols-outlined text-lg">attach_file</span>
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder="Расскажи про бизнес или закинь отчёт…"
            className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none resize-none py-2 max-h-32"
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            className="p-2 rounded-lg bg-primary text-on-primary disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-primary/30 transition-all flex-shrink-0"
          >
            <span className="material-symbols-outlined text-lg">arrow_upward</span>
          </button>
        </div>
        <p className="text-[10px] text-on-surface-variant/40 mt-2 text-center">
          Enter — отправить · Shift + Enter — новая строка
        </p>
      </div>
    </section>
  )
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === 'user'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`max-w-[85%] ${isUser ? 'order-2' : ''}`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-primary text-on-primary rounded-br-md'
              : 'bg-surface-container border border-white/[0.04] text-on-surface rounded-bl-md'
          }`}
        >
          {m.text}
        </div>
        {m.attachments && m.attachments.length > 0 && (
          <div className={`mt-2 flex flex-wrap gap-2 ${isUser ? 'justify-end' : ''}`}>
            {m.attachments.map((a) => (
              <div
                key={a.id}
                className="inline-flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-lg bg-surface-container-low border border-white/[0.06] text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-sm text-primary">description</span>
                {a.name}
                <span className="text-on-surface-variant/50">
                  · {(a.sizeBytes / 1024).toFixed(0)}кб
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
