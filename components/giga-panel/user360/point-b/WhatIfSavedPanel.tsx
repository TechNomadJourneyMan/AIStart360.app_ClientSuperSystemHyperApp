'use client'

/**
 * components/giga-panel/user360/point-b/WhatIfSavedPanel.tsx — the client's saved «что если» for the expert
 * (plan Ф4 Task 5, spec §15.4): name, date, the changes in words, the key deltas stored with the scenario and the
 * mark «Предложено клиентом». Read-only: a plan changes only through a plan version. Behaviour lives in
 * whatIfSavedController.ts; this file only draws it.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { Badge, EmptyState, ErrorState, Panel, Skeleton, fmtDate } from '../../kit'
import { WhatIfSavedController, savedRowView, type WhatIfSavedSnapshot } from './whatIfSavedController'
import type { SavedWhatIf } from '@/components/point-b/whatIfModel'

function Row({ s }: { s: SavedWhatIf }) {
  const v = savedRowView(s)
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">{s.name}</p>
          <p className="text-[11px] text-slate-500">Сохранён {fmtDate(s.createdAt)}</p>
        </div>
        {s.proposedAt && <Badge tone="violet" title="Клиент отправил этот сценарий эксперту в сообщении">Предложено клиентом · {fmtDate(s.proposedAt)}</Badge>}
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-300">
        {v.changes.length ? v.changes.map((c, i) => <li key={i}>{c}</li>) : <li>Изменения не прочитаны</li>}
      </ul>
      {v.deltas.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-400">
          <span className="text-slate-500">Результат на момент сохранения: </span>
          {v.deltas.join(' · ')}
        </p>
      )}
      {s.note && <p className="mt-1 text-[11px] text-slate-500">Комментарий клиента: {s.note}</p>}
    </li>
  )
}

/** The panel without a controller: the wrapper binds it, the tests render it. */
export function WhatIfSavedPanelView({ snap, onRetry }: { snap: WhatIfSavedSnapshot; onRetry?: () => void }) {
  const title = 'Сохранённые «что если» клиента'
  if (snap.phase === 'loading') return <Panel title={title}><Skeleton className="h-24 w-full" /></Panel>
  if (snap.phase === 'error') return <Panel title={title}><ErrorState error={{ message: snap.error ?? 'Не удалось загрузить сценарии' }} onRetry={onRetry} /></Panel>
  return (
    <Panel
      title={title}
      description="Расчёты клиента на его данных. Только чтение: план меняется только версией плана, предложение клиента — повод его обсудить."
      actions={<Badge tone="neutral">{snap.items.length}</Badge>}
    >
      {snap.items.length === 0 ? (
        <EmptyState title="Клиент пока ничего не сохранил" text="Сценарии появятся здесь, когда клиент сохранит «что если» во вкладке «Точка Б»." />
      ) : (
        <ul aria-label="Сохранённые сценарии" className="space-y-2">
          {snap.items.map((s) => <Row key={s.id} s={s} />)}
        </ul>
      )}
    </Panel>
  )
}

/** Stateful wrapper: the controller bound to the panel. */
export function WhatIfSavedPanel({ userId }: { userId: string }) {
  const ctl = useMemo(() => new WhatIfSavedController(userId, (input, init) => fetch(input, init)), [userId])
  useEffect(() => { void ctl.load() }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return <WhatIfSavedPanelView snap={snap} onRetry={() => void ctl.load()} />
}
