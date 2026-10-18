'use client'

/**
 * components/point-b/tabs/ScenariosTab.tsx — the three paces of the plan (plan Phase 2
 * Task 8, spec §15.2): cards, a comparison table (a list of cards on a phone) and expandable
 * groups of risks, conditions and review points. Shows scenarios of the APPROVED plan version
 * only (the server never sends the others); without them — «Эксперт готовит сценарии».
 * Choosing a pace is the expert's job in Phase 2: there is no «Выбрать темп» here.
 */
import { CARD, CARD_TITLE, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import type { ModelResult } from '@/lib/point-b/model/types'
import DataGapBanner from '../DataGapBanner'
import type { PointBStateSnapshot } from '../pointBStateController'
import {
  TONE_CLASS, comparisonGroups, comparisonRows, fmtLongDate, scenarioCards, scenariosMode,
  type PointBPlanState,
} from '../overviewModel'
import { SectionError, SectionSkeleton } from './OverviewTab'

function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <span key={i} className={cn('block', i > 0 && 'text-xs text-on-surface-variant')}>{l}</span>
      ))}
    </>
  )
}

export function ScenariosPreparing({ result }: { result: ModelResult | null }) {
  const missing = result?.missing ?? []
  return (
    <div className="space-y-4">
      <section aria-labelledby="pb-scn-prep" className={CARD}>
        <div className="flex items-start gap-3">
          <Icon name="hourglass_top" className="mt-0.5 text-2xl text-secondary" />
          <div className="min-w-0">
            <h2 id="pb-scn-prep" className="font-headline text-lg font-bold text-on-surface">Эксперт готовит сценарии</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Три темпа движения к цели — осторожный, умеренный и ускоренный — появятся здесь после того, как эксперт проверит расчёт и одобрит план.
              Пока ориентир — вкладка «Обзор» с автоматическим расчётом.
            </p>
            {missing.length === 0 && (
              <p className="mt-2 text-xs text-on-surface-variant">От вас сейчас ничего не требуется.</p>
            )}
          </div>
        </div>
      </section>
      {/* What the owner can do meanwhile: the same list as on the overview. */}
      <DataGapBanner missing={missing} title="Что поможет эксперту рассчитать сценарии точнее" />
    </div>
  )
}

export function ScenariosReady({ plan, target }: { plan: PointBPlanState; target: number | null }) {
  const cards = scenarioCards(plan.scenarios, plan.selectedScenario, target)
  const rows = comparisonRows(plan.scenarios)
  const groups = comparisonGroups(plan.scenarios)
  const date = fmtLongDate(plan.approvedAt)

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
        <Icon name="verified" className="text-lg text-primary" />
        <span>
          {plan.version !== null ? `План v${plan.version}` : 'План'} одобрен{date ? ` ${date}` : ''}
          {plan.authorName ? ` · подготовил ${plan.authorName}` : ''}
        </span>
      </p>

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3" aria-label="Три темпа">
        {cards.map((c) => (
          <li key={c.key} className={cn(CARD, c.selected && 'border-primary/40')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-headline text-lg font-bold text-on-surface">{c.label}</h3>
              {c.selected && <span className={cn(CHIP, 'bg-primary/[0.12] text-primary')}><Icon name="check_circle" className="text-[14px]" />Выбран экспертом</span>}
            </div>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className={CARD_TITLE}>Срок выхода на цель</dt>
                <dd className="text-base font-semibold text-on-surface">{c.time.main}</dd>
                {c.time.range && <dd className="text-xs text-on-surface-variant">диапазон {c.time.range}</dd>}
              </div>
              <div>
                <dt className={CARD_TITLE}>Выручка к сроку цели</dt>
                <dd className="text-base font-semibold text-on-surface">{c.revenue.main}</dd>
                {c.revenue.range && <dd className="text-xs text-on-surface-variant">диапазон {c.revenue.range}</dd>}
                {c.share && <dd className="text-xs text-on-surface-variant">{c.share}</dd>}
              </div>
            </dl>
            {c.reason && (
              <p role="note" className={cn('mt-3 flex items-start gap-1.5 rounded-xl border px-3 py-2 text-xs', TONE_CLASS.bad.border, TONE_CLASS.bad.bg, TONE_CLASS.bad.text)}>
                <Icon name="warning" className="text-base" />
                <span><b>Не достижим.</b> {c.reason}</span>
              </p>
            )}
          </li>
        ))}
      </ul>

      <section aria-labelledby="pb-scn-compare" className={cn(CARD, '!p-0 overflow-hidden')}>
        <h3 id="pb-scn-compare" className="px-4 pt-4 font-headline text-base font-bold text-on-surface sm:px-5">Сравнение сценариев</h3>

        {/* Wide screens: a table. */}
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Сравнение трёх темпов по срокам, выручке, рычагам и вложениям</caption>
            <thead>
              <tr className="border-y border-white/[0.06] text-xs text-on-surface-variant">
                <th scope="col" className="px-5 py-2 font-medium"><span className="sr-only">Показатель</span></th>
                {cards.map((c) => <th key={c.key} scope="col" className="px-3 py-2 font-semibold text-on-surface">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-white/[0.04] align-top">
                  <th scope="row" className="w-1/4 px-5 py-2.5 text-xs font-medium text-on-surface-variant">{r.label}</th>
                  {r.cells.map((lines, i) => <td key={i} className="px-3 py-2.5 text-on-surface"><Lines lines={lines} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Phone: the same numbers as a card per scenario. */}
        <div className="mt-3 space-y-3 px-4 pb-4 md:hidden">
          {cards.map((c, i) => (
            <article key={c.key} aria-label={`Сценарий «${c.label}»`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <h4 className="text-sm font-semibold text-on-surface">{c.label}</h4>
              <dl className="mt-2 space-y-2">
                {rows.map((r) => (
                  <div key={r.key}>
                    <dt className="text-[11px] text-on-surface-variant">{r.label}</dt>
                    <dd className="text-sm text-on-surface"><Lines lines={r.cells[i]} /></dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section aria-label="Риски, условия и точки пересмотра" className="space-y-2">
        {groups.map((g) => (
          <details key={g.key} className={cn(CARD, '!p-0 group')}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:px-5">
              {g.label}
              <Icon name="expand_more" className="text-xl text-on-surface-variant transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid grid-cols-1 gap-4 border-t border-white/[0.06] px-4 py-3 sm:px-5 md:grid-cols-3">
              {g.columns.map((col) => (
                <div key={col.scenarioKey}>
                  <h4 className={CARD_TITLE}>{col.scenarioLabel}</h4>
                  {col.items.length ? (
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-on-surface">
                      {col.items.map((it, i) => <li key={i}>{it}</li>)}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-xs text-on-surface-variant">—</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </section>

      <p className="text-[11px] text-on-surface-variant">
        Денежные последствия (резерв, кассовый разрыв) здесь не оцениваются: для этого нужны данные о деньгах компании.
      </p>
    </div>
  )
}

export default function ScenariosTab({ snap, onRetry }: { snap: PointBStateSnapshot; onRetry?: () => void }) {
  if (snap.phase === 'loading') return <SectionSkeleton label="Загружаем сценарии" />
  if (snap.phase === 'error' && !snap.result && snap.plan.scenarios.length === 0) return <SectionError message={snap.error ?? 'Нет данных'} onRetry={onRetry} />
  const mode = scenariosMode(snap.plan)
  if (mode === 'ready') return <ScenariosReady plan={snap.plan} target={snap.result?.gap.targetAnnual ?? null} />
  if (mode === 'no_scenarios') {
    return (
      <section className={CARD}>
        <div className="flex items-start gap-3">
          <Icon name="info" className="mt-0.5 text-2xl text-secondary" />
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">В одобренном плане сценариев нет</h2>
            <p className="mt-1 text-sm text-on-surface-variant">Эксперт добавит их в следующей версии плана. Пока ориентир — вкладка «Обзор».</p>
          </div>
        </div>
      </section>
    )
  }
  return <ScenariosPreparing result={snap.result} />
}
