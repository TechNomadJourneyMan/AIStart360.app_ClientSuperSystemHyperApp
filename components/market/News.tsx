'use client'

import React, { useState } from 'react'
import { Newspaper, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { MOCK_NEWS, type NewsItem } from './mock-data'

/**
 * News view — aggregated business news feed.
 *
 * TODO(supabase): Subscribe to the `news` table with a niche+region filter.
 * The Sync button calls /api/market/osint which currently returns mock data;
 * once the Exa pipeline is wired, have it upsert news rows in Supabase.
 */
export function News() {
  const [news, setNews] = useState<NewsItem[]>(
    [...MOCK_NEWS].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
  )
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/market/osint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'news', niche: 'IT Consulting', region: 'Kazakhstan' }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to sync')
      if (Array.isArray(result.data) && result.data.length > 0) {
        const incoming: NewsItem[] = result.data.map(
          (item: Omit<NewsItem, 'id'>, idx: number) => ({
            ...item,
            id: `sync-${Date.now()}-${idx}`,
          }),
        )
        setNews((prev) =>
          [...incoming, ...prev].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          ),
        )
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to sync'
      setError(message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex flex-col gap-2">
          <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">
            Market Feed
          </h2>
          <p className="text-on-surface-variant text-sm">
            Aggregated news and events from business media
          </p>
        </div>
        <Button variant="outline" onClick={handleSync} disabled={syncing} className="shrink-0">
          {syncing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync via Exa OSINT
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
          {error}
        </div>
      )}

      {news.length === 0 ? (
        <div className="text-center p-12 border border-dashed border-white/10 rounded-2xl bg-surface-container-low/50">
          <Newspaper className="h-12 w-12 text-on-surface-variant/40 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-on-surface mb-2">No News Found</h3>
          <p className="text-on-surface-variant">Click the sync button to fetch fresh news.</p>
        </div>
      ) : (
        <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
          {news.map((item) => (
            <div
              key={item.id}
              className="break-inside-avoid bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 transition-colors p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <Badge variant="secondary">{item.source}</Badge>
                <span className="text-xs text-on-surface-variant/70 flex items-center gap-1">
                  <Newspaper className="h-3 w-3" />
                  {formatRelative(item.timestamp)}
                </span>
              </div>
              <h3 className="font-headline text-lg font-bold text-on-surface leading-tight mb-2">
                {item.headline}
              </h3>
              <p className="text-sm text-on-surface-variant mb-4 line-clamp-3">{item.summary}</p>
              <div className="flex flex-wrap gap-1">
                {item.tags?.map((tag) => (
                  <Badge key={tag} variant="default">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' })
}
