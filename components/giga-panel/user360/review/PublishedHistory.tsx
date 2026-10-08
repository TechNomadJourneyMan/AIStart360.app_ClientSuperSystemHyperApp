'use client'

import { Badge, Panel, Timeline, fmtDateTime } from '../../kit'
import { pluralComments } from '@/lib/email/templates'
import type { ReviewInfo } from './types'

/** История опубликованных разборов клиента. */
export function PublishedHistory({ reviews }: { reviews: ReviewInfo[] }) {
  return (
    <Panel title="Опубликованные разборы" description="Что клиент уже получил — по одному письму на разбор.">
      <Timeline
        emptyText="Разборов ещё не публиковали"
        items={reviews.map((r) => ({
          id: r.id,
          at: r.published_at ?? r.created_at,
          tone: 'green' as const,
          title: (
            <span className="flex flex-wrap items-center gap-2">
              {r.title || 'Разбор эксперта'}
              <Badge tone="green">{pluralComments(r.comments_count ?? 0)}</Badge>
            </span>
          ),
          subtitle: `${r.author_name ?? 'Эксперт'} · ${fmtDateTime(r.published_at)}${r.summary ? ` · ${r.summary.slice(0, 140)}` : ''}`,
        }))}
      />
    </Panel>
  )
}
