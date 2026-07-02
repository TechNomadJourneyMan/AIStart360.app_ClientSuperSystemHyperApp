export default function OwnerLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-7 w-48 bg-surface-container-high rounded" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-surface-container-low rounded-xl p-5 border border-white/[0.06]">
            <div className="h-3 w-20 bg-surface-container-high rounded mb-3" />
            <div className="h-8 w-28 bg-surface-container-high rounded mb-2" />
            <div className="h-3 w-16 bg-surface-container-high/60 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-surface-container-low rounded-xl p-5 border border-white/[0.06] h-52">
        <div className="h-5 w-32 bg-surface-container-high rounded mb-4" />
        <div className="h-full bg-surface-container-high/30 rounded" />
      </div>
    </div>
  )
}
