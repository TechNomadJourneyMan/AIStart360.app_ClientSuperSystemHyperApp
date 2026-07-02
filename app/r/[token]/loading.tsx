import { Skeleton } from '@/components/ui/Skeleton'

/**
 * Branded skeleton for the public shared-report page (/r/<token>). This is an
 * external, "selling" surface reached from a link, so the recipient must see a
 * content-shaped placeholder on the dark theme — not a blank screen — while the
 * server fetches the report by token. Shape: header + gauge + 3 KPI cards.
 */
export default function SharedReportLoading() {
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <div className="skeleton h-3 rounded w-40" />
          <div className="skeleton h-9 rounded w-2/3" />
          <div className="skeleton h-4 rounded w-1/2" />
        </div>

        {/* Gauge + summary */}
        <div className="bg-surface-container-low border border-white/[0.05] rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6">
          <Skeleton variant="circle" className="w-32 h-32 flex-shrink-0" />
          <div className="flex-1 w-full space-y-3">
            <div className="skeleton h-4 rounded w-1/3" />
            <div className="skeleton h-3 rounded w-full" />
            <div className="skeleton h-3 rounded w-5/6" />
            <div className="skeleton h-3 rounded w-2/3" />
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="card" />
          ))}
        </div>
      </div>
    </div>
  )
}
