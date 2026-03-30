export default function Loading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 w-56 bg-surface-container rounded" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-36 bg-surface-container rounded-xl" />
        <div className="h-36 bg-surface-container rounded-xl" />
      </div>
      <div className="h-64 bg-surface-container rounded-xl" />
    </div>
  )
}
