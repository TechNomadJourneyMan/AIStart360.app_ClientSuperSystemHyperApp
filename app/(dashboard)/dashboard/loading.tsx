export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-surface-container-low rounded-xl p-5 border border-white/[0.06]">
            <div className="h-3 w-20 bg-surface-container-high rounded mb-3" />
            <div className="h-8 w-28 bg-surface-container-high rounded mb-2" />
            <div className="h-3 w-16 bg-surface-container-high/60 rounded" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="bg-surface-container-low rounded-xl p-5 border border-white/[0.06]">
        <div className="h-5 w-40 bg-surface-container-high rounded mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-8 w-8 bg-surface-container-high rounded-full" />
              <div className="h-4 flex-1 bg-surface-container-high/60 rounded" />
              <div className="h-4 w-20 bg-surface-container-high/40 rounded" />
            </div>
          ))}
        </div>
      </div>
      {/* Chart skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-surface-container-low rounded-xl p-5 border border-white/[0.06] h-64">
            <div className="h-5 w-32 bg-surface-container-high rounded mb-4" />
            <div className="h-full bg-surface-container-high/30 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
