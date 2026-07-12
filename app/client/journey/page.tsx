'use client'

// /client/journey — experimental chat-first cabinet.
//
// One screen. One chat. AI drives everything: asks questions, ingests
// files, spawns widgets on the right rail, grows the A→B map at the
// bottom. No forms, no accordions, no 12-step wizards.
//
// The AI generates ALL widget content per-business (томаты → порча/
// холодильники/локация №2; страховая → пролонгации/убыточность). The
// widget kinds are only rendering primitives.
//
// Modes:
//   default   — live AI via /api/journey/chat, starts empty with greeting
//   ?demo=1   — static mock state for showcasing without an API key
//
// Views: Диалог (chat + rail) | Карта роста (A→B canvas)

import Link from 'next/link'
import { Suspense, useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { MOCK_JOURNEY_STATE } from '@/lib/journey/mock-state'
import { emptyJourneyState, type ChatMessage, type JourneyState } from '@/lib/journey/state'
import { applyEnvelope } from '@/lib/journey/apply'
import { ChatPane } from '@/components/journey/ChatPane'
import { WidgetRail } from '@/components/journey/WidgetRail'
import { JourneyCanvas } from '@/components/journey/JourneyCanvas'

type View = 'chat' | 'map'

const GREETING: ChatMessage = {
  id: 'greet',
  role: 'assistant',
  text: 'Привет. Я AI-навигатор AIStart360. Расскажи про свой бизнес — что делаешь, кому продаёшь, какая цель? Можно сразу закинуть отчёты. По ходу разговора я соберу карту «где ты сейчас → куда идёшь» и подскажу конкретные шаги под твой бизнес.',
  createdAt: new Date(0).toISOString(),
}

function freshState(): JourneyState {
  return { ...emptyJourneyState(), messages: [GREETING] }
}

function JourneyInner() {
  const searchParams = useSearchParams()
  const demo = searchParams.get('demo') === '1'

  const [state, setState] = useState<JourneyState>(() => (demo ? MOCK_JOURNEY_STATE : freshState()))
  const [view, setView] = useState<View>('chat')
  const [typing, setTyping] = useState(false)

  const toggleWidget = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      widgets: s.widgets.map((x) => (x.id === id ? { ...x, collapsed: !x.collapsed } : x)),
    }))
  }, [])

  const dismissWidget = useCallback((id: string) => {
    setState((s) => ({ ...s, widgets: s.widgets.filter((x) => x.id !== id) }))
  }, [])

  const send = useCallback(async (text: string) => {
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    }

    // `typing` gates concurrent sends, so reading `state` from the closure is
    // safe — it is the latest committed state when the user can press send.
    const next: JourneyState = { ...state, messages: [...state.messages, userMsg] }
    const historySnapshot = next.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }))
    setState(next)
    setTyping(true)

    try {
      const res = await fetch('/api/journey/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: historySnapshot,
          state: {
            companyName: next.companyName,
            industry: next.industry,
            pointA: next.pointA,
            pointB: next.pointB,
            milestones: next.milestones,
            widgets: next.widgets,
          },
        }),
      })

      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json() as { ok: boolean; data?: Parameters<typeof applyEnvelope>[1]; error?: string }

      if (!json.ok || !json.data) {
        const friendly =
          json.error === 'no_api_key'
            ? 'AI не подключён на этом окружении (нет OPENROUTER_API_KEY). Попробуй ?demo=1 для витрины.'
            : `AI временно недоступен (${json.error ?? 'unknown'}). Попробуй ещё раз.`
        setState((s) => ({
          ...s,
          messages: [...s.messages, {
            id: `err-${Date.now()}`,
            role: 'assistant',
            text: friendly,
            createdAt: new Date().toISOString(),
          }],
        }))
        return
      }

      const env = json.data
      setState((s) => {
        const merged = applyEnvelope(s, env)
        return {
          ...merged,
          messages: [...s.messages, {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: env.reply,
            createdAt: new Date().toISOString(),
          }],
        }
      })
    } catch {
      setState((s) => ({
        ...s,
        messages: [...s.messages, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: 'Сеть моргнула — сообщение не дошло. Повтори, я на связи.',
          createdAt: new Date().toISOString(),
        }],
      }))
    } finally {
      setTyping(false)
    }
  }, [state])

  return (
    <div className="min-h-screen bg-[#0a0d13] text-on-surface flex flex-col">

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/[0.04] bg-[#0a0d13]/85 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-5 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="material-symbols-outlined text-primary text-lg">graph_2</span>
            <span className="font-headline font-extrabold text-sm">
              AIStart<span className="text-primary">360</span>
            </span>
            <span className="text-[10px] font-mono text-on-surface-variant/60 ml-1">/ journey</span>
            <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-primary/10 border border-primary/25 text-primary ml-2">
              lab
            </span>
            {demo && (
              <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-tertiary-container/10 border border-tertiary-container/30 text-tertiary-container ml-1">
                demo
              </span>
            )}
          </Link>

          {/* View switcher */}
          <div className="flex items-center gap-1 rounded-xl bg-surface-container-low border border-white/[0.06] p-1">
            <button
              onClick={() => setView('chat')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                view === 'chat'
                  ? 'bg-primary/15 text-primary border border-primary/20'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">chat_bubble</span>
              Диалог
            </button>
            <button
              onClick={() => setView('map')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                view === 'map'
                  ? 'bg-primary/15 text-primary border border-primary/20'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">map</span>
              Карта роста
              {(state.pointA.length > 0 || state.pointB.length > 0) && (
                <span className="ml-0.5 text-[9px] font-mono px-1 py-0.5 rounded bg-primary/15 text-primary">
                  {state.pointA.length + state.pointB.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-on-surface-variant/70">
              <span className={`w-1.5 h-1.5 rounded-full ${typing ? 'bg-tertiary-container animate-pulse' : 'bg-primary animate-pulse'}`} />
              {typing ? 'AI думает…' : 'AI онлайн'}
            </div>
            <Link
              href="/client/welcome"
              className="text-xs text-on-surface-variant hover:text-primary transition-colors"
            >
              Обычный кабинет →
            </Link>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto">
        {view === 'chat' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-4 p-4 h-[calc(100vh-57px)]">
            <ChatPane
              messages={state.messages}
              companyName={state.companyName}
              industry={state.industry}
              typing={typing}
              onSend={send}
            />
            <WidgetRail
              widgets={state.widgets}
              onToggle={toggleWidget}
              onDismiss={dismissWidget}
            />
          </div>
        ) : (
          <div className="p-4 h-[calc(100vh-57px)]">
            <JourneyCanvas state={state} />
          </div>
        )}
      </main>
    </div>
  )
}

export default function JourneyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0d13]" />}>
      <JourneyInner />
    </Suspense>
  )
}
