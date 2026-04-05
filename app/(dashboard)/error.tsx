'use client'

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex items-center justify-center min-h-[40vh] p-4">
      <div className="bg-surface-container rounded-xl p-6 max-w-lg w-full border border-outline-variant/30 text-center">
        <h2 className="font-headline text-xl font-bold text-on-surface mb-2">Что-то пошло не так</h2>
        <p className="text-sm text-on-surface-variant mb-5">Не удалось загрузить данные страницы. Попробуйте снова.</p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm hover:opacity-90"
        >
          Попробовать снова
        </button>
      </div>
    </div>
  )
}
