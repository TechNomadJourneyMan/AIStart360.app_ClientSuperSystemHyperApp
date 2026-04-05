'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-red-500/10 flex items-center justify-center">
          <span className="material-symbols-rounded text-red-400 text-2xl">warning</span>
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Что-то пошло не так</h2>
        <p className="text-gray-400 text-sm mb-6">
          Не удалось загрузить содержимое страницы. Пожалуйста, попробуйте ещё раз.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-600 mb-4 font-mono">Код: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            Повторить
          </button>
          <a
            href="/dashboard"
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
          >
            На главную
          </a>
        </div>
      </div>
    </div>
  )
}
