export default function PageLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 bg-gray-700 rounded" />
        <div className="h-9 w-24 bg-gray-700/60 rounded-lg" />
      </div>
      {/* Content */}
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-10 w-10 bg-gray-700 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-700/70 rounded w-3/4" />
                <div className="h-3 bg-gray-700/40 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
