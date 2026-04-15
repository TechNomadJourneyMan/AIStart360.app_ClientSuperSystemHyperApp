'use client'

import React, { useState } from 'react'
import { LayoutDashboard, Users, Radar, Newspaper, Lightbulb } from 'lucide-react'
import { MarketOverview } from './MarketOverview'
import { Competitors } from './Competitors'
import { Intelligence } from './Intelligence'
import { News } from './News'
import { Insights } from './Insights'

type ViewType = 'overview' | 'competitors' | 'intelligence' | 'news' | 'insights'

/**
 * Market Intelligence Portal — tabbed dashboard shown under /market.
 *
 * The outer DashboardShell (app/(dashboard)/layout.tsx) already provides the
 * main sidebar and authentication gate, so this component only renders the
 * 5-tab content area. The source project's Google sign-in layer has been
 * removed; authorization is handled upstream by AIStart360.
 */
export function MarketPortal() {
  const [activeView, setActiveView] = useState<ViewType>('overview')

  const navItems = [
    { id: 'overview', label: 'Market', icon: LayoutDashboard },
    { id: 'competitors', label: 'Competitors', icon: Users },
    { id: 'intelligence', label: 'Intelligence', icon: Radar },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'insights', label: 'Insights', icon: Lightbulb },
  ] as const

  const renderView = () => {
    switch (activeView) {
      case 'overview':
        return <MarketOverview />
      case 'competitors':
        return <Competitors />
      case 'intelligence':
        return <Intelligence />
      case 'news':
        return <News />
      case 'insights':
        return <Insights />
      default:
        return <MarketOverview />
    }
  }

  return (
    <div className="relative">
      {/* Decorative background glow */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/5 rounded-full blur-[120px]"
        aria-hidden="true"
      />

      <div className="relative z-10 space-y-6">
        {/* Portal header */}
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Radar className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
              Market Intelligence
            </p>
            <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-on-surface">
              Competitor & Market Radar
            </h1>
          </div>
        </div>

        {/* Tab nav */}
        <nav
          role="tablist"
          aria-label="Market Intelligence sections"
          className="flex flex-wrap gap-2 border-b border-white/[0.05] pb-2 -mx-1 px-1"
        >
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeView === item.id
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                  isActive
                    ? 'bg-primary/10 text-primary border-primary/20 shadow-primary-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container border-transparent'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-on-surface-variant/80'}`} />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Active view */}
        <div>{renderView()}</div>
      </div>
    </div>
  )
}
