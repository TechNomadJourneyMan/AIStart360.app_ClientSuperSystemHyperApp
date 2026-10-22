'use client'

/**
 * components/point-b/VersionCompare.tsx — the versions of the plan and «что изменилось и почему» between two of them
 * (plan Ф6b, spec §15.2, MVP level): the list (status, who approved, when, the reason of the change) and a pick of two
 * versions → the changed goals, pace, key assumptions, trajectory totals, the strategy nodes added / removed / renamed
 * and the reason of the newer version. The client has the content of the approved version only: a comparison with a
 * superseded one shows the reasons of the changes (what the expert wrote), not the old numbers.
 * Project tokens only — the PO will replace the design.
 */
import { useState } from 'react'
import { CARD, CARD_TITLE, CHIP, Icon } from '@/components/point-a-v4/ui'
import type { VersionDiffEntry, VersionSummary } from '@/lib/point-b/planfact/types'
import { cn } from '@/lib/utils'
import { TONE_CLASS } from './overviewModel'
import { compareView, defaultPair, STRATEGY_KIND, versionItems, type CompareView } from './planFactModel'

function DiffList({ title, entries }: { title: string; entries: VersionDiffEntry[] }) {
  if (!entries.length) return null
  return (
    <div className="min-w-0">
      <h4 className={CARD_TITLE}>{title}</h4>
      <ul className="mt-1 space-y-1">
        {entries.map((e) => (
          <li key={e.field} className="break-words text-sm text-on-surface">
            <span className="text-on-surface-variant">{e.label}:</span> <s className="text-on-surface-variant">{e.before}</s>
            <Icon name="arrow_forward" className="mx-1 align-middle text-sm text-on-surface-variant" />
            <span className="font-medium">{e.after}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CompareResult({ view }: { view: CompareView }) {
  if (view.mode === 'reasons') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-on-surface-variant">Содержание прежних версий хранится у эксперта. Здесь — что изменилось по его словам.</p>
        <ol className="space-y-1">
          {view.items.map((i) => (
            <li key={i.title} className="break-words text-sm text-on-surface"><span className="font-medium">{i.title}:</span> {i.reason}</li>
          ))}
        </ol>
      </div>
    )
  }
  const d = view.diff
  return (
    <div className="space-y-3">
      <p className="text-sm text-on-surface">
        <span className="font-medium">Версия {d.from.version} → версия {d.to.version}.</span>{' '}
        {d.reason ? <>Причина: {d.reason}</> : 'Причина изменений не указана.'}
      </p>
      {d.unchanged ? (
        <p className="text-sm text-on-surface-variant">Цели, темп, допущения, итоги и стратегия не изменились.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <DiffList title="Цели" entries={d.goals} />
          <DiffList title="Темп" entries={d.pace} />
          <DiffList title="Ключевые допущения" entries={d.assumptions} />
          <DiffList title="Итоги траектории" entries={d.totals} />
          {(d.strategyAdded.length > 0 || d.strategyRemoved.length > 0 || d.strategyRenamed.length > 0) && (
            <div className="min-w-0 md:col-span-2">
              <h4 className={CARD_TITLE}>Стратегия</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {d.strategyAdded.map((n) => <li key={`a-${n.key}`} className="break-words text-on-surface"><span className="text-primary">+ добавлено</span> · {STRATEGY_KIND[n.kind] ?? n.kind}: {n.title}</li>)}
                {d.strategyRemoved.map((n) => <li key={`r-${n.key}`} className="break-words text-on-surface"><span className="text-error">− убрано</span> · {STRATEGY_KIND[n.kind] ?? n.kind}: {n.title}</li>)}
                {d.strategyRenamed.map((n) => <li key={`n-${n.key}`} className="break-words text-on-surface"><span className="text-on-surface-variant">переименовано</span> · {n.before} → {n.after}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function VersionList({ versions }: { versions: VersionSummary[] }) {
  const items = versionItems({ versions })
  return (
    <ol className="space-y-2">
      {items.map((v) => (
        <li key={v.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-on-surface">{v.title}</span>
            <span className={cn(CHIP, 'normal-case tracking-normal', TONE_CLASS[v.tone].bg, TONE_CLASS[v.tone].text)}>{v.status}</span>
            {v.system && <span className={cn(CHIP, 'normal-case tracking-normal bg-white/[0.06] text-on-surface-variant')}>по план-факту</span>}
          </div>
          {v.meta && <p className="mt-1 text-xs text-on-surface-variant">{v.meta}</p>}
          {v.reason && <p className="mt-1 break-words text-sm text-on-surface-variant">Причина: {v.reason}</p>}
        </li>
      ))}
    </ol>
  )
}

export default function VersionCompare({ versions, initialPair }: { versions: VersionSummary[]; initialPair?: [string, string] | null }) {
  const pair = initialPair ?? defaultPair({ versions })
  const [a, setA] = useState(pair?.[0] ?? '')
  const [b, setB] = useState(pair?.[1] ?? '')
  const view = a && b ? compareView({ versions }, a, b) : null
  const option = (v: VersionSummary) => <option key={v.id} value={v.id}>Версия {v.version}</option>
  return (
    <section aria-labelledby="pb-versions" className={cn(CARD, 'space-y-4')}>
      <div>
        <h2 id="pb-versions" className="font-headline text-lg font-bold text-on-surface">Версии плана</h2>
        <p className="mt-1 text-sm text-on-surface-variant">Каждое изменение плана — новая версия с причиной. Сравните две, чтобы увидеть, что изменилось.</p>
      </div>
      {versions.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Версий пока нет.</p>
      ) : (
        <VersionList versions={versions} />
      )}
      {versions.length >= 2 && (
        <div className="space-y-3 border-t border-white/[0.06] pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 text-xs text-on-surface-variant">
              Было
              <select value={a} onChange={(e) => setA(e.target.value)} className="mt-1 block rounded-xl border border-white/[0.1] bg-surface-container px-3 py-2 text-sm text-on-surface">
                {versions.map(option)}
              </select>
            </label>
            <label className="min-w-0 text-xs text-on-surface-variant">
              Стало
              <select value={b} onChange={(e) => setB(e.target.value)} className="mt-1 block rounded-xl border border-white/[0.1] bg-surface-container px-3 py-2 text-sm text-on-surface">
                {versions.map(option)}
              </select>
            </label>
          </div>
          {view ? <CompareResult view={view} /> : <p className="text-sm text-on-surface-variant">Выберите две разные версии.</p>}
        </div>
      )}
    </section>
  )
}
