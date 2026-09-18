export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6" aria-busy="true" aria-label="Загрузка профиля">
      <div className="h-40 animate-pulse rounded-3xl bg-white/[0.03]" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.03]" />)}
      </div>
      <div className="h-72 animate-pulse rounded-3xl bg-white/[0.03]" />
    </div>
  )
}
