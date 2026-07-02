export default function ExpertLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-7 w-52 bg-surface-container-high rounded" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-surface-container-low rounded-xl p-5 border border-white/[0.06]">
            <div className="h-3 w-20 bg-surface-container-high rounded mb-3" />
            <div className="h-7 w-16 bg-surface-container-high rounded" />
          </div>
        ))}
      </div>
      <div className="bg-surface-container-low rounded-xl p-5 border border-white/[0.06]">
        <div className="h-5 w-40 bg-surface-container-high rounded mb-4" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-surface-container-high/30 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
