// Dev-only, read-only preview of the Point B page on a fixture (no database, no
// API calls) — for visual audits without signing in. 404 in production, like
// /dev/point-a-preview. ?variant=full | no-goal | stale-base
import { notFound } from 'next/navigation'
import PointBView from '@/components/point-b/PointBView'
import { fixturePointB, isPointBFixtureVariant, POINT_B_FIXTURE_VARIANTS } from '@/lib/point-b/fixtures'

export const dynamic = 'force-dynamic'

const VARIANT_LABEL: Record<(typeof POINT_B_FIXTURE_VARIANTS)[number], string> = {
  full: 'Полные данные',
  'no-goal': 'Нет цели',
  'stale-base': 'Устаревшая база',
}

export default function PointBPreviewPage({ searchParams }: { searchParams?: { variant?: string } }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const variant = isPointBFixtureVariant(searchParams?.variant) ? searchParams.variant : 'full'
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <nav aria-label="Варианты фикстуры" className="flex flex-wrap gap-2 text-sm">
        {POINT_B_FIXTURE_VARIANTS.map((v) => (
          <a
            key={v}
            href={`?variant=${v}`}
            aria-current={v === variant ? 'page' : undefined}
            className={`rounded-lg border px-3 py-1.5 ${v === variant ? 'border-primary/40 text-primary' : 'border-white/[0.08] text-on-surface-variant'}`}
          >
            {VARIANT_LABEL[v]}
          </a>
        ))}
      </nav>
      <PointBView pointB={fixturePointB(variant)} previewMode />
    </main>
  )
}
