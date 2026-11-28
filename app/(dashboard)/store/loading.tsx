export default function StoreLoading() {
  return (
    <div className="space-y-6" aria-label="Загрузка магазина" aria-busy="true">
      <div className="h-64 animate-pulse rounded-3xl bg-surface-container-low" />
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl bg-surface-container-low" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="h-72 animate-pulse rounded-2xl bg-surface-container-low" />
        <div className="h-72 animate-pulse rounded-2xl bg-surface-container-low" />
      </div>
    </div>
  )
}
