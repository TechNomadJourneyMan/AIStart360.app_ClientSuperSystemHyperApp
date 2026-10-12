'use client'

/**
 * The blocks of the company (block constructor, spec §2.2/§4.4): score or
 * «данных не хватает» / AI hypothesis, coverage, confidence, discrepancies;
 * expands into checks, missing inputs and the metric values with their source
 * and period. Customize mode (owner): hide / show, reorder, add from the
 * library — the score never depends on it.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { PointAPageState } from '@/hooks/usePointAState'
import { useBlockView } from '@/hooks/usePointAState'
import { BLOCK_LIBRARY, type BlockKey } from '@/lib/point-a/v4/config'
import { CHECK_LABELS } from '@/lib/point-a/v4/check-labels'
import type { V4Block } from '@/lib/point-a/v4/engine'
import { BTN_GHOST, CARD, CHIP, ConfidenceBar, Icon, SectionTitle, fmtValue, toneColor } from './ui'
import { cn } from '@/lib/utils'

type Metric = NonNullable<PointAPageState['snapshot']>['metrics'][number]

function BlockCard({ block, metrics, hidden, customize, onToggle, onMove, first, last }: {
  block: V4Block
  metrics: Metric[]
  hidden: boolean
  customize: boolean
  onToggle: () => void
  onMove: (dir: -1 | 1) => void
  first: boolean
  last: boolean
}) {
  const [open, setOpen] = useState(false)
  const insufficient = block.score === null
  const color = toneColor(block.score)
  const answered = block.checks.filter((c) => c.answered && !c.excluded)
  return (
    <article className={cn(CARD, 'flex flex-col gap-3', hidden && 'opacity-50')} aria-labelledby={`blk-${block.key}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`blk-${block.key}`} className="font-headline text-sm font-bold text-on-surface">{block.title}</h3>
          <p className="text-[11px] text-on-surface-variant line-clamp-2">{BLOCK_LIBRARY[block.key].description}</p>
        </div>
        <div className="text-right flex-shrink-0">
          {insufficient ? (
            block.hypothesis ? (
              <div>
                <span className="font-mono text-2xl font-bold text-on-surface-variant">~{block.hypothesis.score}</span>
                <span className={cn(CHIP, 'block mt-1 bg-violet-400/10 text-violet-200')} title={block.hypothesis.rationale}>гипотеза AI</span>
              </div>
            ) : <span className={cn(CHIP, 'bg-amber-300/10 text-amber-200')}>данных не хватает</span>
          ) : (
            <span className="font-mono text-2xl font-bold" style={{ color }}>{block.score}</span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <ConfidenceBar value={block.coverage} label="Полнота" />
        <ConfidenceBar value={block.confidence} label="Достоверность" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {block.conflicts.length > 0 && <span className={cn(CHIP, 'bg-amber-300/10 text-amber-200')}><Icon name="compare_arrows" className="text-[12px]" />расхождение</span>}
        {block.informational && <span className={cn(CHIP, 'bg-white/[0.04] text-on-surface-variant')}>информационный</span>}
        {!block.informational && <span className={cn(CHIP, 'bg-white/[0.04] text-on-surface-variant')}>вес {Math.round(block.weight * 100)}%</span>}
      </div>

      {insufficient && block.hypothesis && <p className="text-xs text-on-surface-variant">{block.hypothesis.rationale}</p>}
      {!insufficient && block.top_issues.length > 0 && (
        <ul className="space-y-1">
          {block.top_issues.map((t, i) => <li key={i} className="flex gap-1.5 text-xs text-on-surface"><Icon name="arrow_right" className="text-[14px] text-amber-300" />{t}</li>)}
        </ul>
      )}

      {customize ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={BTN_GHOST} onClick={onToggle} aria-pressed={!hidden}>
            <Icon name={hidden ? 'visibility' : 'visibility_off'} className="text-[16px]" />{hidden ? 'Показать' : 'Скрыть'}
          </button>
          <button type="button" className={BTN_GHOST} onClick={() => onMove(-1)} disabled={first} aria-label={`Переместить «${block.title}» выше`}><Icon name="arrow_upward" className="text-[16px]" /></button>
          <button type="button" className={BTN_GHOST} onClick={() => onMove(1)} disabled={last} aria-label={`Переместить «${block.title}» ниже`}><Icon name="arrow_downward" className="text-[16px]" /></button>
        </div>
      ) : (
        <button type="button" className="self-start text-xs font-mono text-primary/80 hover:text-primary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Свернуть' : 'Подробнее'}
        </button>
      )}

      {open && !customize && (
        <div className="space-y-3 border-t border-white/[0.06] pt-3">
          {metrics.length > 0 && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-1.5">Показатели</p>
              <ul className="space-y-1">
                {metrics.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-on-surface">{m.label}</span>
                    <span className="font-mono text-on-surface">{fmtValue(m.value, m.unit)}
                      <span className="ml-1.5 text-[10px] text-on-surface-variant">{[m.period, m.source].filter(Boolean).join(' · ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-1.5">Проверки</p>
            <ul className="space-y-1">
              {answered.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-on-surface">{CHECK_LABELS[c.id] ?? c.id}</span>
                  <span className="font-mono text-on-surface-variant">{c.earned}/{c.max}</span>
                </li>
              ))}
            </ul>
          </div>
          {block.needs.length > 0 && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-1.5">Нужно данных</p>
              <ul className="space-y-1">{block.needs.map((n, i) => <li key={i} className="text-xs text-amber-100/90">• {n}</li>)}</ul>
            </div>
          )}
          {block.recommendations.length > 0 && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-1.5">Что сделать</p>
              <ul className="space-y-1">{block.recommendations.map((r, i) => <li key={i} className="text-xs text-on-surface">• {r}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export function BlocksSection({ state, customize }: { state: PointAPageState; customize: boolean }) {
  const view = useBlockView()
  const snapshot = state.snapshot
  const cfg = state.config.blocks
  const hidden = useMemo(() => new Set(cfg.filter((b) => b.hiddenForClient).map((b) => b.key)), [cfg])
  const order = useMemo(() => cfg.slice().sort((a, b) => a.order - b.order).map((b) => b.key), [cfg])
  if (!snapshot) return null

  const byKey = new Map(snapshot.blocks.map((b) => [b.key, b]))
  const ordered = order.map((k) => byKey.get(k)).filter((b): b is V4Block => !!b)
  const visible = customize ? ordered : ordered.filter((b) => !hidden.has(b.key))
  const notInConfig = state.library.filter((l) => !cfg.some((c) => c.key === l.key))

  const save = async (patch: { hidden?: string[]; order?: string[]; added?: string[] }) => {
    try {
      await view.mutateAsync(patch)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить вид')
    }
  }
  const toggle = (k: BlockKey) => void save({ hidden: hidden.has(k) ? [...hidden].filter((x) => x !== k) : [...hidden, k] })
  const move = (k: BlockKey, dir: -1 | 1) => {
    const next = order.slice()
    const i = next.indexOf(k)
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    void save({ order: next })
  }
  const metricsOf = (k: BlockKey) => snapshot.metrics.filter((m) => BLOCK_LIBRARY[k].metrics.includes(m.id))

  return (
    <section aria-labelledby="pa-blocks">
      <SectionTitle icon="dashboard" aside={<span className="text-[11px] font-mono text-on-surface-variant">Шаблон: {state.config.templateTitle}</span>}>
        <span id="pa-blocks">Блоки бизнеса</span>
      </SectionTitle>
      {customize && (
        <p className="mb-3 text-xs text-on-surface-variant">Скрытый блок пропадает только из вида — в общем балле он участвует. Веса блоков настраивает эксперт.</p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((b, i) => (
          <BlockCard key={b.key} block={b} metrics={metricsOf(b.key)} hidden={hidden.has(b.key)} customize={customize}
            onToggle={() => toggle(b.key)} onMove={(d) => move(b.key, d)} first={i === 0} last={i === visible.length - 1} />
        ))}
      </div>
      {customize && notInConfig.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {notInConfig.map((l) => (
            <button key={l.key} type="button" className={BTN_GHOST} onClick={() => void save({ added: [...state.config.added, l.key] })}>
              <Icon name="add" className="text-[16px]" />{l.title}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
