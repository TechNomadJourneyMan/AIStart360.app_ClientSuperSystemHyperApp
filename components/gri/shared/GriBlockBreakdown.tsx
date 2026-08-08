'use client'

// components/gri/shared/GriBlockBreakdown.tsx — «Средние по блокам», которые
// раскрываются в разбор.
//
// Один и тот же список используют вкладка «Диагностика» (результаты опросника)
// и вкладка «Результат» (серверный итог). Строка блока — <button> с
// aria-expanded: раскрывается в список критериев с баллом, «что улучшить» и
// ценой отставания. Блок без ответов показывает честное «нет данных» и кнопку
// «Пройти блок» — вместо 0.0 с красной полосой.
//
// Разбор строится из данных, уже лежащих в памяти (sections.ts + ответы), —
// MetricDrillDownModalV2 здесь не подходит: он тянет временной ряд метрики из
// /api/v1/metrics/:id/timeseries, которого у критериев GRI нет.

import { useId, useState } from 'react'
import { avgBarTone, type GriBlockRow, type GriCriterionRow } from './blocks'

function critTone(score: number): string {
  return score >= 8
    ? 'bg-primary/15 text-primary'
    : score >= 6
      ? 'bg-amber-400/15 text-amber-300'
      : 'bg-red-400/15 text-red-300'
}

function CriterionItem({ crit }: { crit: GriCriterionRow }) {
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1 text-sm leading-snug text-on-surface">{crit.text}</span>
        <span
          className={`shrink-0 rounded px-2 py-0.5 font-mono text-xs font-bold tabular-nums ${
            crit.score == null ? 'bg-white/[0.06] text-on-surface-variant' : critTone(crit.score)
          }`}
        >
          {crit.score == null ? '—' : `${crit.score}/10`}
        </span>
      </div>
      {crit.score == null ? (
        <p className="mt-1.5 text-xs leading-snug text-on-surface-variant">
          Нет ответа на этот вопрос.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-xs leading-snug text-on-surface-variant">
            <span className="text-on-surface/70">Что улучшить:</span> {crit.whatToImprove}
          </p>
          {crit.score < 7 && (
            <p className="mt-1 text-xs leading-snug text-red-300/80">
              <span className="text-red-300">Чем это стоит бизнесу:</span> {crit.businessLoss}
            </p>
          )}
        </>
      )}
    </li>
  )
}

function BlockRowItem({
  row,
  expanded,
  onToggle,
  onGoToBlock,
}: {
  row: GriBlockRow
  expanded: boolean
  onToggle: () => void
  onGoToBlock?: (blockId: string) => void
}) {
  const panelId = useId()
  const hasData = row.avg != null
  const partial = hasData && row.answered < row.total

  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.01]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={
          hasData
            ? `${row.label}: ${row.avg!.toFixed(1)} из 10, отвечено ${row.answered} из ${row.total}. Показать критерии блока`
            : `${row.label}: нет данных. Показать критерии блока`
        }
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-on-surface">{row.label}</span>
          {partial && (
            <span className="block font-mono text-[10px] uppercase tracking-wide text-amber-300/80">
              отвечено {row.answered}/{row.total}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.08] sm:w-28"
        >
          <span
            className={`block h-full rounded-full ${hasData ? avgBarTone(row.avg!) : 'bg-white/[0.12]'}`}
            style={{ width: hasData ? `${(row.avg! / 10) * 100}%` : '100%' }}
          />
        </span>
        <span
          className={`w-9 shrink-0 text-right font-mono text-sm tabular-nums ${
            hasData ? 'text-on-surface' : 'text-on-surface-variant'
          }`}
        >
          {hasData ? row.avg!.toFixed(1) : '—'}
        </span>
        <span
          aria-hidden
          className={`material-symbols-outlined shrink-0 text-[18px] text-on-surface-variant transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          expand_more
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="space-y-2 border-t border-white/[0.06] px-3 pb-3 pt-3">
          <p className="text-xs leading-snug text-on-surface-variant">{row.description}</p>
          {!hasData && (
            <p className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-xs leading-snug text-on-surface-variant">
              Блок ещё не пройден — оценок по нему нет. Ноль здесь не показывается,
              потому что вы его не ставили.
            </p>
          )}
          <ul className="space-y-2">
            {row.criteria.map((c) => (
              <CriterionItem key={c.id} crit={c} />
            ))}
          </ul>
          {onGoToBlock && (
            <button
              type="button"
              onClick={() => onGoToBlock(row.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/[0.08] px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/[0.16] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden>
                edit
              </span>
              {hasData ? 'Обновить ответы блока' : 'Пройти блок'}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

export default function GriBlockBreakdown({
  rows,
  onGoToBlock,
  title = 'Средние по блокам',
  hint = 'Нажмите на блок — покажем, из каких критериев сложился балл.',
}: {
  rows: GriBlockRow[]
  /** Переход к блоку опросника. Не передан — кнопка «Пройти блок» не рисуется. */
  onGoToBlock?: (blockId: string) => void
  title?: string
  hint?: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div>
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
        {title}
      </div>
      <p className="mb-3 text-xs text-on-surface-variant/80">{hint}</p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <BlockRowItem
            key={row.id}
            row={row}
            expanded={openId === row.id}
            onToggle={() => setOpenId((prev) => (prev === row.id ? null : row.id))}
            onGoToBlock={onGoToBlock}
          />
        ))}
      </ul>
    </div>
  )
}
