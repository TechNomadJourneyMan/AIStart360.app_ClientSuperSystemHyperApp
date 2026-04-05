export default function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 animate-pulse">
      <div className="w-full max-w-md p-8">
        <div className="h-8 w-40 bg-gray-800 rounded mx-auto mb-8" />
        <div className="space-y-4">
          <div className="h-12 bg-gray-800 rounded-lg" />
          <div className="h-12 bg-gray-800 rounded-lg" />
          <div className="h-12 bg-gray-800/60 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
