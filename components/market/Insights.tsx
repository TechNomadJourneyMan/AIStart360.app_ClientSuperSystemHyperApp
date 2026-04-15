'use client'

import React, { useState } from 'react'
import { Sparkles, ArrowRight, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import {
  MOCK_MARKET_DATA,
  MOCK_COMPETITORS,
  type MarketData,
  type Competitor,
} from './mock-data'

interface Directive {
  title: string
  description: string
  impact: 'High' | 'Medium' | 'Low' | string
  category: 'Opportunity' | 'Risk' | 'Optimization' | string
}

/**
 * Insights view — AI-generated strategic directives.
 *
 * Calls POST /api/market/generate-insights with the user profile, current
 * market overview, and competitor list. The route uses Anthropic via Vercel
 * AI SDK (generateObject) to return a structured JSON schema.
 *
 * TODO(supabase): Replace the in-memory `marketData`/`competitorsData` with
 * reads from Supabase (same tables the other views consume). Pull
 * `userProfile` from the authenticated session + user's company row.
 */
export function Insights() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [directives, setDirectives] = useState<Directive[]>([])
  const [hasGenerated, setHasGenerated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed context — in production, fetched from Supabase. TODO(supabase).
  const marketData: MarketData = MOCK_MARKET_DATA
  const competitorsData: Competitor[] = MOCK_COMPETITORS

  const generateInsights = async () => {
    setLoading(true)
    setError(null)
    try {
      const userProfile = {
        companyName: 'MyTech KZ',
        revenue: 500_000_000,
        focus: 'B2B SaaS',
        targetMarket: 'Kazakhstan',
        customQuery: query,
      }

      const res = await fetch('/api/market/generate-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userProfile, marketData, competitorsData }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate insights')

      if (Array.isArray(data.directives)) {
        setDirectives(data.directives)
        setHasGenerated(true)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate insights'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const removeDirective = (index: number) => {
    setDirectives((prev) => prev.filter((_, i) => i !== index))
  }

  const categoryVariant = (category: string): 'primary' | 'error' | 'secondary' => {
    if (category === 'Opportunity') return 'primary'
    if (category === 'Risk') return 'error'
    return 'secondary'
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex flex-col gap-2">
        <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface flex items-center gap-3">
          AI Directives <Sparkles className="h-6 w-6 text-primary" />
        </h2>
        <p className="text-on-surface-variant text-sm">
          Personalized strategic recommendations based on market data
        </p>
      </div>

      {error && (
        <div className="p-4 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
          {error}
        </div>
      )}

      <div className="relative">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-primary/0 rounded-lg blur opacity-50 pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row gap-2 bg-surface-container-low/90 p-2 rounded-lg border border-primary/20 backdrop-blur-md">
          <Input
            placeholder="Ask Market AI... (e.g., 'How should I position against Kaspi?')"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) generateInsights()
            }}
          />
          <Button onClick={generateInsights} disabled={loading} className="sm:w-auto shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate'}
          </Button>
        </div>
      </div>

      {!hasGenerated && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12 border border-dashed border-white/10 rounded-2xl bg-surface-container-low/50">
          <Sparkles className="h-12 w-12 text-primary/30 mb-4" />
          <h3 className="text-lg font-medium text-on-surface mb-2">Ready for Analysis</h3>
          <p className="text-on-surface-variant max-w-md">
            Enter a specific query above or just click Generate to get strategic directives based on
            your current market position.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center space-y-4 py-12">
          <div className="relative">
            <div className="absolute inset-0 rounded-full blur-md bg-primary/20 animate-pulse" />
            <Loader2 className="h-10 w-10 text-primary animate-spin relative z-10" />
          </div>
          <p className="text-primary/80 text-sm animate-pulse">Synthesizing market data...</p>
        </div>
      )}

      {hasGenerated && !loading && (
        <div className="grid grid-cols-1 gap-4 pb-10">
          {directives.map((dir, i) => (
            <div
              key={`${dir.title}-${i}`}
              className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 transition-colors p-6 relative group"
            >
              <button
                type="button"
                onClick={() => removeDirective(i)}
                className="absolute top-3 right-3 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-container flex items-center justify-center"
                aria-label="Dismiss directive"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="pb-3 pr-10">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={categoryVariant(dir.category)}>{dir.category}</Badge>
                  <Badge variant="default">Impact: {dir.impact}</Badge>
                </div>
                <h3 className="font-headline text-xl font-bold text-on-surface">{dir.title}</h3>
              </div>
              <p className="text-on-surface-variant text-sm leading-relaxed mb-6">
                {dir.description}
              </p>
              <Button variant="outline" className="w-full sm:w-auto">
                Implement Strategy <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          ))}
          {directives.length === 0 && (
            <p className="text-on-surface-variant text-center py-8">All directives dismissed.</p>
          )}
        </div>
      )}
    </div>
  )
}
