export default function ExpertLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-7 w-52 bg-gray-700 rounded" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
            <div className="h-3 w-20 bg-gray-700 rounded mb-3" />
            <div className="h-7 w-16 bg-gray-700 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
        <div className="h-5 w-40 bg-gray-700 rounded mb-4" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-700/30 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
