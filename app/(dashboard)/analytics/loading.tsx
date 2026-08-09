// Skeleton mirrors the real page: header + 4 KPI tiles + two charts + table.
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse" aria-hidden="true">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-surface-container rounded" />
          <div className="h-4 w-72 bg-surface-container rounded" />
        </div>
        <div className="h-9 w-72 bg-surface-container rounded-lg" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 bg-surface-container-low rounded-xl" />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 bg-surface-container rounded-xl" />
        <div className="h-80 bg-surface-container rounded-xl" />
      </div>

      <div className="h-96 bg-surface-container rounded-xl" />
    </div>
  )
}
