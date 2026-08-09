/**
 * MarketSkeleton — единый скелетон раздела «Рынок».
 *
 * Используется в двух местах, где раньше пользователь видел пустоту или
 * непохожую заглушку:
 *   - loading.tsx (навигация на /market и /market/analysis);
 *   - <Suspense> вокруг MarketAppEmbed (он читает useSearchParams, поэтому
 *     саспенд срабатывает реально, а не «на всякий случай»).
 *
 * Форма повторяет то, что появится после загрузки: строка табов + рабочая
 * область. Иначе при переходе вёрстка «прыгает».
 */
export function MarketSkeleton() {
  return (
    <div className="p-6 space-y-4" aria-hidden="true">
      {/* Заголовок раздела */}
      <div className="h-7 w-40 rounded bg-surface-container animate-pulse" />

      {/* Строка табов: Карта · Анализ ниши · Чек-лист 50 · Новости */}
      <div className="flex flex-wrap gap-2">
        {[88, 128, 116, 96].map((w, i) => (
          <div
            key={i}
            className="h-9 rounded-xl bg-surface-container animate-pulse"
            style={{ width: w }}
          />
        ))}
      </div>

      {/* Рабочая область */}
      <div className="h-[420px] rounded-2xl bg-surface-container animate-pulse" />
    </div>
  )
}
