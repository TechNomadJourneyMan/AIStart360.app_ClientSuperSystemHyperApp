'use client'

// /client/journey — experimental chat-first cabinet.
//
// One screen. One chat. AI drives everything: asks questions, ingests
// files, spawns widgets on the right rail, grows the A→B map at the
// bottom. No forms, no accordions, no 12-step wizards.
//
// Views:
//   • Chat   — full-screen chat + widget rail sidebar
//   • Map    — full-screen Miro-style A → B canvas
// Tab switch keeps chat state hot in memory.

import Link from 'next/link'
import { useState } from 'react'
import { MOCK_JOURNEY_STATE } from '@/lib/journey/mock-state'
import { ChatPane } from '@/components/journey/ChatPane'
import { WidgetRail } from '@/components/journey/WidgetRail'
import { JourneyCanvas } from '@/components/journey/JourneyCanvas'

type View = 'chat' | 'map'

export default function JourneyPage() {
  const [state] = useState(MOCK_JOURNEY_STATE)
  const [view, setView] = useState<View>('chat')
  const [widgets, setWidgets] = useState(state.widgets)

  const toggleWidget = (id: string) => {
    setWidgets((w) =>
      w.map((x) => (x.id === id ? { ...x, collapsed: !x.collapsed } : x)),
    )
  }

  const dismissWidget = (id: string) => {
    setWidgets((w) => w.filter((x) => x.id !== id))
  }

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
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-on-surface-variant/70">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              AI онлайн
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
            />
            <WidgetRail
              widgets={widgets}
              onToggle={toggleWidget}
              onDismiss={dismissWidget}
            />
          </div>
        ) : (
          <div className="p-4 h-[calc(100vh-57px)]">
            <JourneyCanvas state={{ ...state, widgets }} />
          </div>
        )}
      </main>
    </div>
  )
}
