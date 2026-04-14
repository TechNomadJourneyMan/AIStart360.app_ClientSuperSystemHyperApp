'use client'

import { useTranslations } from 'next-intl'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors')

  return (
    <html lang="ru">
      <body className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
            <span className="material-symbols-rounded text-red-400 text-3xl">error</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">{t('criticalError')}</h1>
          <p className="text-gray-400 mb-6">
            {t('unexpectedError')}
          </p>
          {error.digest && (
            <p className="text-xs text-gray-600 mb-4 font-mono">ID: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            {t('tryAgain')}
          </button>
        </div>
      </body>
    </html>
  )
}
