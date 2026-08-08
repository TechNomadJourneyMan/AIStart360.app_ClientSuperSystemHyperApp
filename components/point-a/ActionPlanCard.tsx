'use client'

/**
 * ActionPlanCard — a risk or a quick win that opens into a concrete plan.
 *
 * The Point A payload already carries everything needed for the plan: the risk
 * knows its `impact` and `area`, the quick win knows its `timeline`, and the
 * matching block carries the engine's own `top_issues` and `recommendations`.
 * Until now the actions tab rendered risks and quick wins as flat cards with
 * no action at all — «риск должен раскрываться в конкретный план» was the
 * owner's complaint.
 *
 * Everything shown here comes from `/api/v1/point-a/aggregate`. When the
 * matching block is missing, the card says so instead of filling the gap.
 */

import Link from 'next/link'
import { useId, useState } from 'react'
import type { BlockScore, BlockStatus, Risk, QuickWin } from '@/types/onboarding'

export type PointABlocks = {
  finance: BlockScore
  marketing: BlockScore
  operations: BlockScore
  strategy: BlockScore
  sales: BlockScore
}

/** Russian area labels the engine emits → block keys of the payload. */
const AREA_TO_BLOCK: Record<string, keyof PointABlocks> = {
  'Финансы': 'finance',
  'Продажи': 'sales',
  'Операции': 'operations',
  'Маркетинг': 'marketing',
  'Стратегия': 'strategy',
}

const STATUS_RU: Record<BlockStatus, string> = {
  critical: 'критично',
  weak: 'слабо',
  average: 'средне',
  strong: 'сильно',
  excellent: 'отлично',
}

const LEVEL_RU: Record<Risk['level'], string> = {
  critical: 'Критично',
  important: 'Важно',
  moderate: 'Умеренно',
}

type Props =
  | { kind: 'risk'; item: Risk; blocks: PointABlocks | null }
  | { kind: 'quick_win'; item: QuickWin; blocks: PointABlocks | null }

export default function ActionPlanCard(props: Props) {
  const { kind, blocks } = props
  const [open, setOpen] = useState(false)
  const panelId = useId()

  const isRisk = kind === 'risk'
  const area = props.item.area
  const headline = isRisk ? props.item.text : props.item.action
  const level = isRisk ? props.item.level : null
  const impact = isRisk ? props.item.impact : null
  const timeline = isRisk ? null : props.item.timeline

  const blockKey = AREA_TO_BLOCK[area]
  const block = blockKey && blocks ? blocks[blockKey] : null

  const tone = isRisk
    ? level === 'critical'
      ? 'border-error/50 bg-error/[0.06]'
      : level === 'important'
      ? 'border-error/30 bg-error/[0.04]'
      : 'border-amber-400/30 bg-amber-400/[0.04]'
    : 'border-primary/40 bg-primary/[0.06]'

  const iconTone = isRisk
    ? level === 'moderate'
      ? 'text-amber-400'
      : 'text-error'
    : 'text-primary'

  return (
    <div className={`rounded-2xl border ${tone}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${isRisk ? 'Риск' : 'Быстрая победа'}, ${area}: ${headline}. ${
          open ? 'Свернуть план' : 'Показать план действий'
        }`}
        className="w-full text-left p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] truncate">
            {area}
          </span>
          <span className="inline-flex items-center gap-1.5 flex-shrink-0">
            {level && (
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.15em]">
                {LEVEL_RU[level]}
              </span>
            )}
            <span className={`material-symbols-outlined text-lg leading-none ${iconTone}`} aria-hidden>
              {isRisk ? 'warning' : 'bolt'}
            </span>
          </span>
        </div>

        <p className="text-sm text-on-surface leading-relaxed">{headline}</p>
        {impact && <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{impact}</p>}

        <div className="flex items-center gap-2 mt-3">
          {timeline && (
            <span className="text-[11px] font-mono bg-surface-container-high rounded-md px-2 py-0.5 text-on-surface-variant">
              Срок: {timeline}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-mono text-primary/80">
            <span className="material-symbols-outlined text-[14px]">
              {open ? 'expand_less' : 'expand_more'}
            </span>
            {open ? 'Свернуть план' : 'План действий'}
          </span>
        </div>
      </button>

      <div id={panelId} hidden={!open} className="px-4 pb-4">
        <div className="rounded-xl bg-surface-container border border-white/[0.04] p-3.5">
          {block ? (
            <>
              <p className="text-[11px] font-mono text-on-surface-variant mb-3">
                Блок «{area}»: <span className="text-on-surface">{block.score} / 100</span> ·{' '}
                {STATUS_RU[block.status] ?? block.status}
              </p>

              {block.top_issues.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-error/70 mb-1.5">
                    {isRisk ? 'Что за этим стоит' : 'Что это закрывает'}
                  </p>
                  <ul className="space-y-1">
                    {block.top_issues.map((issue, i) => (
                      <li
                        key={`${i}-${issue}`}
                        className="flex items-start gap-1.5 text-[11px] text-on-surface leading-snug"
                      >
                        <span className="w-1 h-1 rounded-full bg-error flex-shrink-0 mt-1.5" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {block.recommendations.length > 0 ? (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/70 mb-1.5">
                    Шаги
                  </p>
                  <ol className="space-y-1.5">
                    {block.recommendations.map((rec, i) => (
                      <li key={`${i}-${rec}`} className="flex items-start gap-2 text-[11px] text-on-surface leading-snug">
                        <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary font-mono text-[9px] flex items-center justify-center mt-px">
                          {i + 1}
                        </span>
                        {rec}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  Движок не сформулировал шагов по этому блоку — значит, ответы по нему
                  либо в норме, либо не заполнены. Проверьте разбор блока «{area}» выше.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              Разбор по направлению «{area}» не пришёл вместе с диагностикой — нажмите
              «Пересчитать», чтобы собрать его заново.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/client/onboarding"
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[14px]">edit_note</span>
              Поправить ответы
            </Link>
            <Link
              href="/point-b"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-on-surface-variant transition-colors hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[14px]">flag</span>
              Точка Б
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
