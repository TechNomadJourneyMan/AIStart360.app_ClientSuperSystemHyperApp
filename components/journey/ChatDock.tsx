'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronUp,
  FileText,
  LoaderCircle,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { FactReview } from './FactReview'
import type { JourneySuggestionView, JourneyWorkspaceView } from './model'
import { SuggestionPills } from './SuggestionPills'

interface ChatDockProps {
  state: JourneyWorkspaceView
  busy: boolean
  expanded: boolean
  mode?: 'desktop' | 'mobile'
  statusMessage: string
  actionError?: string
  draftSeed?: string
  onExpandedChange: (expanded: boolean) => void
  onSend: (text: string) => void
  onFiles: (files: File[]) => void
  onFactConfirm: (id: string) => void
  onFactsConfirmAll: () => void
  onFactEdit: (id: string, value: string) => void
  onFactReject: (id: string) => void
  onFactRestore: (id: string) => void
  onSuggestionAccept: (suggestion: JourneySuggestionView) => void
  onSuggestionReject: (id: string) => void
  onSuggestionHide: (id: string) => void
}

export function ChatDock({
  state,
  busy,
  expanded,
  mode = 'desktop',
  statusMessage,
  actionError,
  draftSeed,
  onExpandedChange,
  onSend,
  onFiles,
  onFactConfirm,
  onFactsConfirmAll,
  onFactEdit,
  onFactReject,
  onFactRestore,
  onSuggestionAccept,
  onSuggestionReject,
  onSuggestionHide,
}: ChatDockProps) {
  const reduceMotion = useReducedMotion()
  const [draft, setDraft] = useState('')
  const [fileError, setFileError] = useState('')
  const historyRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!draftSeed) return
    setDraft(draftSeed)
  }, [draftSeed])

  useEffect(() => {
    if (!expanded && mode === 'desktop') return
    const history = historyRef.current
    if (!history) return
    history.scrollTo({ top: history.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [expanded, mode, reduceMotion, state.messages.length, state.facts.length])

  const send = () => {
    const text = draft.trim()
    if (!text || busy) return
    onSend(text)
    setDraft('')
  }

  const selectFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setFileError('')
    onFiles(files)
  }

  const showHistory = mode === 'mobile' || expanded

  return (
    <section
      aria-label="AI-диалог о бизнесе"
      className={cn(
        'flex min-h-0 flex-col overflow-hidden border border-white/10 bg-surface-container-lowest shadow-modal',
        mode === 'desktop'
          ? 'w-[min(760px,calc(100vw-2rem))] rounded-2xl'
          : 'size-full border-0 bg-background',
      )}
    >
      <header className="flex min-h-12 items-center gap-3 border-b border-white/5 px-3 sm:px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-xs font-semibold text-on-surface">AI-партнёр по развитию</h2>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px]',
              state.provider.mode === 'live'
                ? 'bg-primary/10 text-primary'
                : state.provider.mode === 'demo'
                  ? 'bg-tertiary-container/10 text-tertiary-container'
                  : 'bg-error/10 text-error',
            )}>
              {state.provider.label}
            </span>
          </div>
          <p className="truncate text-[10px] text-on-surface-variant">Один вопрос за раз · факты подтверждаете вы</p>
        </div>
        {mode === 'desktop' && (
          <button
            type="button"
            aria-label={expanded ? 'Свернуть историю диалога' : 'Раскрыть историю диалога'}
            aria-expanded={expanded}
            onClick={() => onExpandedChange(!expanded)}
            className="flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-xs text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
          >
            История
            {expanded ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
          </button>
        )}
      </header>

      <AnimatePresence initial={false}>
        {showHistory && (
          <motion.div
            key="history"
            initial={mode === 'desktop' && !reduceMotion ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={mode === 'desktop' && !reduceMotion ? { opacity: 0, y: 8 } : undefined}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
            className={cn('min-h-0 flex-1', mode === 'desktop' ? 'h-[min(54vh,540px)]' : '')}
          >
            <div ref={historyRef} className="h-full overflow-y-auto px-3 py-4 sm:px-4" aria-label="История сообщений">
              <div className="space-y-4">
                {state.messages.map((message) => (
                  <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed text-pretty',
                      message.role === 'user'
                        ? 'rounded-br-md bg-primary text-on-primary'
                        : message.role === 'system'
                          ? 'border border-white/10 bg-white/[0.025] text-on-surface-variant'
                          : 'rounded-bl-md bg-surface-container text-on-surface',
                    )}>
                      {message.text}
                    </div>
                  </div>
                ))}

                {!!state.files.length && <FileQueue files={state.files} />}

                <FactReview
                  facts={state.facts}
                  onConfirm={onFactConfirm}
                  onConfirmAll={onFactsConfirmAll}
                  onEdit={onFactEdit}
                  onReject={onFactReject}
                  onRestore={onFactRestore}
                />

                {mode === 'mobile' && (
                  <SuggestionPills
                    suggestions={state.suggestions}
                    onAccept={onSuggestionAccept}
                    onReject={onSuggestionReject}
                    onHide={onSuggestionHide}
                  />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="border-t border-white/5 p-2.5 sm:p-3">
        <div className="flex items-end gap-1.5 rounded-xl border border-white/10 bg-surface-container px-1.5 py-1.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
          <input
            ref={fileInputRef}
            data-testid="journey-file-input"
            type="file"
            multiple
            accept=".pdf,.docx,.csv,.txt"
            onChange={selectFiles}
            className="sr-only"
          />
          <button
            type="button"
            aria-label="Прикрепить файл"
            title="PDF · DOCX · CSV · TXT до 4 МБ. Excel временно отключён проверкой безопасности."
            onClick={() => fileInputRef.current?.click()}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-primary"
          >
            <Paperclip className="size-4" aria-hidden />
          </button>
          <textarea
            aria-label="Сообщение AI"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Расскажите о бизнесе или задайте цель…"
            className="max-h-28 min-h-10 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:ring-0"
          />
          <button
            type="button"
            aria-label="Отправить сообщение"
            onClick={send}
            disabled={!draft.trim() || busy}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
          </button>
        </div>

        <div className="mt-2 flex min-h-4 items-start justify-between gap-3 px-1 text-[10px] text-on-surface-variant">
          <p aria-live="polite" className="flex min-w-0 items-center gap-1.5">
            {busy ? <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden /> : <Sparkles className="size-3 shrink-0 text-primary" aria-hidden />}
            <span className="truncate">{statusMessage}</span>
          </p>
          <span className="hidden shrink-0 sm:inline">Enter — отправить</span>
        </div>
        <p className="mt-1.5 flex items-start gap-1.5 px-1 text-[10px] leading-relaxed text-on-surface-variant/80">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
          Файл обрабатывается на сервере; AI увидит только факты после вашего подтверждения.
        </p>

        {(actionError || fileError) && (
          <p role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-error/10 px-2.5 py-2 text-xs text-error">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {actionError || fileError}
          </p>
        )}
      </div>
    </section>
  )
}

function FileQueue({ files }: { files: JourneyWorkspaceView['files'] }) {
  return (
    <section aria-label="Загруженные файлы" className="space-y-2 rounded-2xl border border-white/10 bg-surface-container-lowest p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
        <FileText className="size-3.5 text-primary" aria-hidden />
        База знаний
      </div>
      {files.slice(-5).map((file) => (
        <div key={file.id} data-testid="journey-file-status" className="flex items-center gap-2 text-xs">
          <StatusDot status={file.status} />
          <span className="min-w-0 flex-1 truncate text-on-surface">{file.name}</span>
          <span className={cn('shrink-0 text-[10px]', file.status === 'error' ? 'text-error' : file.status === 'ready' ? 'text-primary' : 'text-on-surface-variant')}>
            {file.statusLabel}
          </span>
        </div>
      ))}
    </section>
  )
}

function StatusDot({ status }: { status: JourneyWorkspaceView['files'][number]['status'] }) {
  if (status === 'uploading' || status === 'analyzing' || status === 'queued') {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-tertiary-container" aria-hidden />
  }
  if (status === 'error') return <AlertCircle className="size-3.5 shrink-0 text-error" aria-hidden />
  return <span className={cn('size-2 shrink-0 rounded-full', status === 'ready' ? 'bg-primary' : 'bg-on-surface-variant')} />
}
