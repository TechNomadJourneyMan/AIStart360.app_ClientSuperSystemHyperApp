'use client'

export default function StoreError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <div className="max-w-lg rounded-3xl border border-error/20 bg-error/[0.05] p-7 text-center">
        <span className="material-symbols-outlined text-4xl text-error">storefront</span>
        <h1 className="mt-4 font-headline text-xl font-bold text-on-surface">Не удалось открыть Магазин</h1>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          Данные остались в безопасности. Повторите загрузку — если источник временно недоступен, экран восстановится автоматически.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary"
        >
          <span className="material-symbols-outlined text-lg">refresh</span>
          Попробовать снова
        </button>
      </div>
    </div>
  )
}
