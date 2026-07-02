export default function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background animate-pulse">
      <div className="w-full max-w-md p-8">
        <div className="h-8 w-40 bg-surface-container-low rounded mx-auto mb-8" />
        <div className="space-y-4">
          <div className="h-12 bg-surface-container-low rounded-lg" />
          <div className="h-12 bg-surface-container-low rounded-lg" />
          <div className="h-12 bg-surface-container-low/60 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
