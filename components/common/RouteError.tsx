'use client'

/**
 * Shared route-segment error boundary UI (FE-08).
 *
 * Re-exported as the default from each route group's `error.tsx` so a thrown
 * error renders INSIDE that group's layout (keeping its nav/chrome) instead of
 * bubbling to the root `app/error.tsx` and blanking the whole shell.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-error/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-error text-2xl">warning</span>
        </div>
        <h2 className="text-xl font-semibold text-on-surface mb-2">Что-то пошло не так</h2>
        <p className="text-on-surface-variant text-sm mb-6">
          Не удалось загрузить содержимое. Пожалуйста, попробуйте ещё раз.
        </p>
        {error.digest && (
          <p className="text-xs text-on-surface-variant/60 mb-4 font-mono">Код: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] transition-transform"
          >
            Повторить
          </button>
          <a
            href="/"
            className="px-5 py-2.5 border border-outline-variant/40 text-on-surface-variant text-sm rounded-lg hover:bg-surface-container transition-colors"
          >
            На главную
          </a>
        </div>
      </div>
    </div>
  )
}
