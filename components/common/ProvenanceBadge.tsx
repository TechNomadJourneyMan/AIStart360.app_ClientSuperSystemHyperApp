'use client'

/**
 * ProvenanceBadge — small chip that says WHERE a number / finding comes from
 * (docs/platform/04-point-a.md §2.5): ФАКТ · РАСЧЁТ · ВЫВОД · ГИПОТЕЗА ИИ ·
 * РЕКОМЕНДАЦИЯ. Hover / focus shows a tooltip with the meaning of the type and
 * the confidence (0..1) when known.
 *
 * Stateless: safe to render anywhere (no hooks at the top level), so unit
 * tests can call it as a plain function.
 */

import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import type { ProvenanceType } from '@/types/point-a-overview'

export interface ProvenanceMeta {
  label: string
  description: string
  className: string
}

export const PROVENANCE_META: Record<ProvenanceType, ProvenanceMeta> = {
  FACT: {
    label: 'Факт',
    description: 'Значение взято из источника без вычислений: ответ анкеты, поле документа, данные CRM.',
    className: 'text-primary border-primary/30 bg-primary/10',
  },
  CALCULATED: {
    label: 'Расчёт',
    description: 'Детерминированный расчёт по формуле или правилу на ваших данных.',
    className: 'text-secondary border-secondary/30 bg-secondary/10',
  },
  INFERRED: {
    label: 'Вывод',
    description: 'Вывод по правилу из нескольких фактов — без участия ИИ.',
    className: 'text-tertiary border-tertiary/30 bg-tertiary/10',
  },
  AI_HYPOTHESIS: {
    label: 'Гипотеза ИИ',
    description: 'Предположение языковой модели. Проверяйте по ссылкам на исходные данные.',
    className: 'text-purple-300 border-purple-400/30 bg-purple-500/10',
  },
  RECOMMENDATION: {
    label: 'Рекомендация',
    description: 'Предлагаемое действие на основе находок диагностики.',
    className: 'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10',
  },
}

export function provenanceMeta(type: ProvenanceType | string | null | undefined): ProvenanceMeta | null {
  if (!type) return null
  return (PROVENANCE_META as Record<string, ProvenanceMeta>)[type] ?? null
}

/** «Уверенность: 82%» — or null when confidence is unknown / out of range. */
export function confidenceText(confidence: number | null | undefined): string | null {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) return null
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  return `Уверенность: ${pct}%`
}

export interface ProvenanceBadgeProps {
  type: ProvenanceType | string | null | undefined
  /** 0..1 */
  confidence?: number | null
  /** Extra line in the tooltip, e.g. the producer («engine:point_a_v1»). */
  source?: string | null
  size?: 'xs' | 'sm'
  /** false inside an already-interactive parent (card = button) — hover still shows the tooltip. */
  focusable?: boolean
  className?: string
}

export function ProvenanceBadge({
  type,
  confidence,
  source,
  size = 'xs',
  focusable = true,
  className,
}: ProvenanceBadgeProps) {
  const meta = provenanceMeta(type)
  if (!meta) return null
  const conf = confidenceText(confidence)
  const ariaLabel = [`Тип данных: ${meta.label}`, conf].filter(Boolean).join('. ')

  return (
    <Tooltip.Provider delayDuration={150} skipDelayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            role="note"
            tabIndex={focusable ? 0 : undefined}
            aria-label={ariaLabel}
            data-provenance={type}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border font-mono uppercase tracking-[0.12em] whitespace-nowrap cursor-help',
              'focus:outline-none focus:ring-2 focus:ring-primary/40',
              size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5',
              meta.className,
              className,
            )}
          >
            {meta.label}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            className="z-[120] max-w-xs rounded-xl border border-white/10 bg-surface-container-high p-3 text-xs text-on-surface-variant shadow-modal"
          >
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary/70">{meta.label}</p>
            <p className="leading-relaxed">{meta.description}</p>
            {conf && <p className="mt-2 font-mono text-on-surface">{conf}</p>}
            {source && <p className="mt-1 font-mono text-[10px] text-on-surface-variant/70">Источник: {source}</p>}
            <Tooltip.Arrow className="fill-surface-container-high" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

export default ProvenanceBadge
