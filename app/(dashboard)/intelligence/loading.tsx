// Mirrors the real /intelligence layout: header plus the source-readiness rows.
// The old skeleton drew a 2-column tile grid the page never rendered, so the
// layout jumped on hydration.
export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Загрузка разведки">
      <div className="space-y-3">
        <div className="h-9 w-52 rounded bg-surface-container" />
        <div className="h-4 w-full max-w-xl rounded bg-surface-container" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-surface-container" />
        ))}
      </div>
    </div>
  )
}
