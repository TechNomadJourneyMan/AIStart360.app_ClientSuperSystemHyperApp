// Skeleton mirrors the real page: header + filter chips + upload form + card grid.
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-8 w-40 bg-surface-container rounded" />
        <div className="h-4 w-80 bg-surface-container rounded" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-24 bg-surface-container rounded-full" />
        ))}
      </div>

      <div className="h-40 bg-surface-container rounded-xl" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-52 bg-surface-container rounded-xl" />
        ))}
      </div>
    </div>
  )
}
