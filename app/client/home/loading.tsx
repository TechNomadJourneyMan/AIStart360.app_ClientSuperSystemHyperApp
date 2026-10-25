export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6" aria-busy="true" aria-labelledby="profile-loading-title">
      <h1 id="profile-loading-title" className="text-2xl font-bold text-on-surface">Загружаем ваш кабинет</h1>
      <p role="status" className="text-base text-on-surface-variant">Подготавливаем профиль компании и результаты диагностики…</p>
      <div aria-hidden="true" className="h-40 animate-pulse rounded-3xl bg-white/[0.03]" />
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.03]" />)}
      </div>
      <div aria-hidden="true" className="h-72 animate-pulse rounded-3xl bg-white/[0.03]" />
    </main>
  )
}
