'use client'

import { overviewSummary } from '@/lib/point-a/v4/summary'
import type { PointASnapshotView } from '@/lib/point-a/v4/state'
import { CARD, Icon, SectionTitle } from './ui'

function List({ icon, tone, title, items, empty }: { icon: string; tone: string; title: string; items: Array<{ block: string; text: string }>; empty: string }) {
  return (
    <div>
      <p className="text-[11px] font-mono uppercase tracking-wider text-on-surface-variant mb-2">{title}</p>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((i, k) => (
            <li key={k} className="flex gap-2 text-sm text-on-surface">
              <Icon name={icon} className={`text-[16px] mt-0.5 ${tone}`} />
              <span><span className="text-on-surface-variant">{i.block}:</span> {i.text}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-on-surface-variant">{empty}</p>}
    </div>
  )
}

export function OverviewSection({ snapshot }: { snapshot: PointASnapshotView }) {
  const o = overviewSummary(snapshot)
  return (
    <section className={CARD} aria-labelledby="pa-overview">
      <SectionTitle icon="insights"><span id="pa-overview">Главное</span></SectionTitle>
      <p className="text-sm leading-relaxed text-on-surface mb-4">{o.headline}</p>
      <div className="grid gap-4 md:grid-cols-3">
        <List icon="warning" tone="text-amber-300" title="Риски" items={o.risks} empty="Критичных рисков по оценённым блокам нет" />
        <List icon="bolt" tone="text-primary" title="Быстрые шаги" items={o.quickWins} empty="Сначала добавьте данные по блокам без оценки" />
        <List icon="star" tone="text-emerald-300" title="Сильные стороны" items={o.strengths} empty="Пока нет блоков с уверенной высокой оценкой" />
      </div>
    </section>
  )
}
