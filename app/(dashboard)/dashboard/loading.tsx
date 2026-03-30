export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
            <div className="h-3 w-20 bg-gray-700 rounded mb-3" />
            <div className="h-8 w-28 bg-gray-700 rounded mb-2" />
            <div className="h-3 w-16 bg-gray-700/60 rounded" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
        <div className="h-5 w-40 bg-gray-700 rounded mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-8 w-8 bg-gray-700 rounded-full" />
              <div className="h-4 flex-1 bg-gray-700/60 rounded" />
              <div className="h-4 w-20 bg-gray-700/40 rounded" />
            </div>
          ))}
        </div>
      </div>
      {/* Chart skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50 h-64">
            <div className="h-5 w-32 bg-gray-700 rounded mb-4" />
            <div className="h-full bg-gray-700/30 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
