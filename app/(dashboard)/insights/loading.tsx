// Mirrors the real /insights layout: header, four filter tiles, feed cards.
// No outer `p-6` — app/(dashboard)/layout.tsx:24 already pads the content area,
// so the old skeleton sat 24px off from the page that replaced it.
export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Загрузка инсайтов">
      <div className="space-y-3">
        <div className="h-3 w-40 rounded bg-surface-container" />
        <div className="h-9 w-56 rounded bg-surface-container" />
        <div className="h-4 w-full max-w-xl rounded bg-surface-container" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-surface-container" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 rounded-2xl bg-surface-container" />
        ))}
      </div>
    </div>
  )
}
