// Dev-only, read-only preview of the Point B page on a fixture (no database, no
// API calls) — for visual audits without signing in. 404 in production, like
// /dev/point-a-preview.
//   ?variant=full | no-goal | stale-base | level2   — the data (level2: the finmodel is filled in, money is counted)
//   ?tab=overview | scenarios | strategy | roadmap | whatif | finmodel | details    — the open tab (default overview)
//   ?plan=none | preparing | published     — the state of the expert's plan (default per variant)
//   ?strategy=empty    — with a published plan: an approved version without a strategy (default: the fixture tree with progress)
import { notFound } from 'next/navigation'
import PointBView from '@/components/point-b/PointBView'
import FinmodelTab from '@/components/point-b/tabs/FinmodelTab'
import OverviewTab from '@/components/point-b/tabs/OverviewTab'
import PointBTabs from '@/components/point-b/tabs/PointBTabs'
import RoadmapTab from '@/components/point-b/tabs/RoadmapTab'
import ScenariosTab from '@/components/point-b/tabs/ScenariosTab'
import StrategyTab from '@/components/point-b/tabs/StrategyTab'
import WhatIfTab from '@/components/point-b/tabs/WhatIfTab'
import { isTabKey, type PlanStatus } from '@/components/point-b/overviewModel'
import type { PointBStateSnapshot } from '@/components/point-b/pointBStateController'
import { fixtureFinmodel, fixtureFinmodelStatus, fixtureModelResult, fixturePointB, fixtureStrategy, fixtureWhatIf, fixtureWhatIfChanges, fixtureWhatIfSaved, isPointBFixtureVariant, POINT_B_FIXTURE_VARIANTS, type PointBFixtureVariant } from '@/lib/point-b/fixtures'

export const dynamic = 'force-dynamic'

const VARIANT_LABEL: Record<PointBFixtureVariant, string> = {
  full: 'Полные данные',
  'no-goal': 'Нет цели',
  'stale-base': 'Устаревшая база',
  level2: 'Уровень 2 (финмодель)',
}

/** What the owner's plan looks like in each variant, unless `?plan=` overrides it. */
const DEFAULT_PLAN: Record<PointBFixtureVariant, PlanStatus> = { full: 'published', 'no-goal': 'none', 'stale-base': 'preparing', level2: 'published' }

function fixtureState(variant: PointBFixtureVariant, plan: PlanStatus, emptyStrategy = false): PointBStateSnapshot {
  const result = fixtureModelResult(variant)
  return {
    phase: 'ready',
    error: null,
    result,
    finmodel: fixtureFinmodelStatus(variant),
    // The approved version only: none while the plan is not published.
    strategy: plan === 'published' ? (emptyStrategy ? { items: [], milestones: [], progress: {}, matrix: { points: [], unrated: 0 } } : fixtureStrategy()) : null,
    plan: {
      status: plan,
      version: plan === 'published' ? 2 : null,
      selectedScenario: plan === 'published' && result.scenarios.length ? 'moderate' : null,
      scenarios: plan === 'published' ? result.scenarios : [],
      approvedAt: plan === 'published' ? '2026-10-14T10:00:00.000Z' : null,
      authorName: plan === 'published' ? 'Анна Ким' : null,
    },
  }
}

export default function PointBPreviewPage({ searchParams }: { searchParams?: { variant?: string; tab?: string; plan?: string; strategy?: string } }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const variant = isPointBFixtureVariant(searchParams?.variant) ? searchParams.variant : 'full'
  const tab = isTabKey(searchParams?.tab) ? searchParams.tab : 'overview'
  const plan: PlanStatus = searchParams?.plan === 'none' || searchParams?.plan === 'preparing' || searchParams?.plan === 'published'
    ? searchParams.plan
    : DEFAULT_PLAN[variant]
  const snap = fixtureState(variant, plan, searchParams?.strategy === 'empty')
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <nav aria-label="Варианты фикстуры" className="flex flex-wrap gap-2 text-sm">
        {POINT_B_FIXTURE_VARIANTS.map((v) => (
          <a
            key={v}
            href={`?variant=${v}&tab=${tab}`}
            aria-current={v === variant ? 'page' : undefined}
            className={`rounded-lg border px-3 py-1.5 ${v === variant ? 'border-primary/40 text-primary' : 'border-white/[0.08] text-on-surface-variant'}`}
          >
            {VARIANT_LABEL[v]}
          </a>
        ))}
      </nav>
      <PointBTabs
        // A new key per variant / plan: the tab state and the visited panels start over.
        key={`${variant}-${plan}-${tab}`}
        initialTab={tab}
        panels={{
          overview: <OverviewTab snap={snap} />,
          scenarios: <ScenariosTab snap={snap} />,
          strategy: <StrategyTab snap={snap} />,
          roadmap: <RoadmapTab snap={snap} />,
          // «Что если» opens with one pre-computed set of changes (the preview does not run the engine);
          // saving, deleting and proposing work in memory only.
          whatif: <WhatIfTab state={snap} preview={{ result: fixtureWhatIf(variant), baseline: fixtureWhatIf(variant, []), saved: fixtureWhatIfSaved(variant), changes: fixtureWhatIfChanges(variant) }} />,
          // The form works on the fixture: a save is applied in memory, nothing leaves the page.
          finmodel: <FinmodelTab preview={fixtureFinmodel(variant)} />,
          details: <PointBView pointB={fixturePointB(variant)} previewMode />,
        }}
      />
    </main>
  )
}
