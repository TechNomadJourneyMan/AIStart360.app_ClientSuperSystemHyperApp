export default function ClientLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background animate-pulse">
      <div className="text-center max-w-lg p-8">
        <div className="w-16 h-16 bg-surface-container-low rounded-full mx-auto mb-6" />
        <div className="h-6 w-48 bg-surface-container-low rounded mx-auto mb-4" />
        <div className="h-4 w-64 bg-surface-container-low/60 rounded mx-auto mb-8" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-surface-container-low/40 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
