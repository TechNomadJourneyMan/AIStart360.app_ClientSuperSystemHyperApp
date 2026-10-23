'use client'

/**
 * «Диагностическая беседа с ИИ» — the chat mode of the questionnaire (spec
 * §8.1): desktop — the chat (≈60 %) and the «Анкета» panel; phone — the chat
 * full screen, the panel as a drawer from the header. The honest first line,
 * the scope choice («быстрый набор» / «вся анкета», PO §18.3 item 1), quick
 * buttons, cards «Записать», «Позвать эксперта». Not «Гри»: its own surface.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CHAT_HONEST_LINE } from '@/lib/survey/chat/ask'
import { enabledSurveyModes, SURVEY_MODE_INFO, type SurveyMode, type SurveyPreference } from '@/lib/survey/modes'
import { loadSurveyPreference, patchSurveyPreference, switchSurveyMode } from '@/lib/survey/mode-switch'
import { track } from '@/lib/events/client'
import { SurveyModeSwitch } from '@/components/onboarding/modes/SurveyModeSwitch'
import type { ChatButton, ChatMessageDTO, ChatQuestionDTO, ChatProgressDTO } from '@/lib/survey/chat/types'
import { ChatInput, ChatMessages, QuickActions } from './ChatMessages'
import { useSurveyChat, type ChatTransport } from './useSurveyChat'

const MODES = enabledSurveyModes()

export function SurveyChat({ transport }: { transport?: ChatTransport }) {
  const chat = useSurveyChat({ transport })
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [panel, setPanel] = useState(false)
  const [online, setOnline] = useState(true)
  const [pref, setPref] = useState<SurveyPreference>({})
  useEffect(() => { void loadSurveyPreference().then(setPref) }, [])

  // Switching remembers the choice and writes SURVEY_MODE_CHOSEN (lib/survey/mode-switch.ts),
  // like the express and the full questionnaire — otherwise /client/onboarding would
  // open the saved «chat» again. Nothing to save first: cards are written by the server.
  const switchMode = (mode: SurveyMode) => void switchSurveyMode({ to: mode, preference: pref }, {
    save: async () => ({ ok: true }),
    patchPreferences: patchSurveyPreference,
    track: (name, metadata) => track(name, { metadata }),
    navigate: (href) => router.push(href),
  })

  useEffect(() => {
    const up = () => setOnline(navigator.onLine)
    up()
    window.addEventListener('online', up)
    window.addEventListener('offline', up)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up) }
  }, [])

  const send = async () => {
    const text = draft.trim()
    if (!text || !online) return
    if (await chat.send(text)) setDraft('') // the unsent text stays on failure
  }
  const onButton = (b: ChatButton) => {
    if (b.action === 'start') void chat.start(b.scope)
    else if (b.action === 'approx' || b.action === 'unknown' || b.action === 'skip' || b.action === 'next') void chat.quick(b.action)
  }
  const escalateCurrent = () => {
    const last = [...chat.messages].reverse().find((m) => m.role === 'user')
    void chat.escalate(chat.question?.key ?? null, last?.content ?? '')
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0c0e14]">
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#0c0e14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/client/home" aria-label="В кабинет" className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant hover:text-primary">
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/60">Анкета</p>
            <h1 className="truncate text-base font-bold text-on-surface">{SURVEY_MODE_INFO.chat.title}</h1>
          </div>
          <div className="hidden sm:block">
            <SurveyModeSwitch current="chat" enabled={MODES} onSwitch={switchMode} />
          </div>
          <button type="button" onClick={() => setPanel((v) => !v)} aria-expanded={panel} aria-controls="survey-chat-panel"
            className="flex h-10 items-center gap-1 rounded-lg border border-white/[0.08] px-3 text-xs text-on-surface-variant lg:hidden">
            <span className="material-symbols-outlined text-base" aria-hidden="true">assignment</span> Анкета
          </button>
        </div>
        {/* Phone: the switch under the title (spec §5.2 — the mode menu in the header). */}
        <div className="mx-auto max-w-6xl px-4 pb-2 sm:hidden">
          <SurveyModeSwitch current="chat" enabled={MODES} onSwitch={switchMode} />
        </div>
        {chat.progress && <ProgressLine progress={chat.progress} />}
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="flex min-h-0 flex-col py-4">
          {chat.loading ? (
            <div aria-busy="true" className="space-y-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-12 w-2/3 animate-pulse rounded-2xl bg-white/[0.04]" />)}
            </div>
          ) : (
            <>
              {!chat.messages.length && <p className="mb-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-on-surface-variant">{CHAT_HONEST_LINE}</p>}
              <ChatMessages
                messages={chat.messages}
                typing={chat.sending}
                handlers={{
                  onApply: (m: ChatMessageDTO, v?: unknown) => { void chat.decide(m, 'apply', v) },
                  onReject: (m: ChatMessageDTO) => { void chat.decide(m, 'reject') },
                  onButton,
                  onEscalate: (m: ChatMessageDTO) => { void chat.escalate(m.escalate?.key ?? null, m.escalate?.text ?? '') },
                }}
              />
              {chat.needsScope && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <ScopeCard title="Быстрый набор" text="26 главных вопросов — первичная Точка А за 10–15 минут" onPick={() => void chat.start('express')} disabled={chat.sending} />
                  <ScopeCard title="Вся анкета" text="Сначала главное, потом блоки: финансы, продажи, команда… Таблицы и файлы — в форме" onPick={() => void chat.start('full')} disabled={chat.sending} />
                </div>
              )}
            </>
          )}

          {chat.error && <p role="alert" className="mt-3 rounded-xl border border-error/30 bg-error/[0.06] px-3 py-2 text-xs text-error">{chat.error}</p>}
          {!online && <p role="status" className="mt-3 text-xs text-on-surface-variant">Нет связи — беседа продолжится, когда сеть вернётся. Можно заполнить в форме: ответы сохранятся на устройстве.</p>}

          {!chat.needsScope && !chat.loading && (
            <div className="sticky bottom-0 mt-auto space-y-2 bg-[#0c0e14] pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
              <QuickActions disabled={chat.sending || !online} onAction={(a) => void chat.quick(a)} onEscalate={escalateCurrent} />
              <ChatInput value={draft} onChange={setDraft} onSend={() => void send()} disabled={chat.sending || !online} />
            </div>
          )}
        </main>

        <aside id="survey-chat-panel" aria-label="Анкета"
          className={`${panel ? 'fixed inset-x-0 bottom-0 z-30 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-white/[0.08] bg-[#11141c] p-4' : 'hidden'} lg:static lg:block lg:max-h-none lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:py-4`}>
          <QuestionPanel question={chat.question} progress={chat.progress} onRestart={() => void chat.restart(chat.scope ?? 'express')} />
          {panel && <button type="button" onClick={() => setPanel(false)} className="mt-3 min-h-[44px] w-full rounded-lg border border-white/[0.08] text-sm text-on-surface-variant lg:hidden">Закрыть</button>}
        </aside>
      </div>
    </div>
  )
}

function ProgressLine({ progress }: { progress: ChatProgressDTO }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 pb-2 text-[11px] text-on-surface-variant">
      <span>Минимум для Точки А: {progress.minimum.done} из {progress.minimum.total}</span>
      <span>Глубина: {progress.depth.percent} %</span>
      <span>Записано в этой беседе: {progress.savedInChat}</span>
    </div>
  )
}

function ScopeCard({ title, text, onPick, disabled }: { title: string; text: string; onPick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onPick} disabled={disabled}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-left hover:border-primary/30 disabled:opacity-50">
      <p className="text-sm font-semibold text-on-surface">{title}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{text}</p>
    </button>
  )
}

export function QuestionPanel({ question, progress, onRestart }: { question: ChatQuestionDTO | null; progress: ChatProgressDTO | null; onRestart?: () => void }) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-on-surface-variant/70">Сейчас вопрос</p>
        {question ? (
          <>
            <p className="mt-1 text-sm font-semibold text-on-surface">{question.label}</p>
            {question.plain && question.plain !== question.label && <p className="mt-1 text-xs text-on-surface-variant">{question.plain}</p>}
            {question.why && <p className="mt-2 text-xs text-on-surface-variant">{question.why}</p>}
            {question.term && <p className="mt-2 text-xs text-on-surface-variant"><strong>{question.term.name}</strong> — {question.term.text}</p>}
            <p className="mt-2 text-[11px] text-on-surface-variant/70">Шаг {question.step} полной анкеты</p>
          </>
        ) : <p className="mt-1 text-sm text-on-surface-variant">Вопрос появится в беседе.</p>}
      </section>
      {progress && (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-on-surface-variant">
          <p>Минимум для Точки А: <strong className="text-on-surface">{progress.minimum.done} из {progress.minimum.total}</strong></p>
          <p className="mt-1">Глубина анкеты: <strong className="text-on-surface">{progress.depth.percent} %</strong></p>
          <p className="mt-1">Записано в этой беседе: <strong className="text-on-surface">{progress.savedInChat}</strong></p>
        </section>
      )}
      <div className="flex flex-col gap-2 text-xs">
        <Link href="/client/onboarding/answers" className="inline-flex min-h-[40px] items-center gap-1 text-primary hover:underline">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">fact_check</span> Мои ответы
        </Link>
        {question && (
          <Link href={`/client/onboarding?step=${question.step}`} className="inline-flex min-h-[40px] items-center gap-1 text-on-surface-variant hover:text-primary">
            <span className="material-symbols-outlined text-sm" aria-hidden="true">edit_note</span> Ответить в форме
          </Link>
        )}
        {onRestart && (
          <button type="button" onClick={onRestart} className="inline-flex min-h-[40px] items-center gap-1 text-left text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined text-sm" aria-hidden="true">restart_alt</span> Начать беседу заново (ответы останутся)
          </button>
        )}
      </div>
    </div>
  )
}
