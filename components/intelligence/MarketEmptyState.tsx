/**
 * Honest empty state for the market-intelligence pages (insights, intelligence,
 * competitors) when the account has no real data and demo mode is off.
 * Replaces the fabricated Choco/Kaspi fixtures that used to be shown to everyone.
 */
export function MarketEmptyState({
  title = 'Рыночная аналитика пока недоступна',
  hint = 'Сигналы, конкуренты и тренды появятся после загрузки данных компании и подключения источников рынка.',
  icon = 'radar',
}: {
  title?: string
  hint?: string
  icon?: string
}) {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-3 block">{icon}</span>
      <h3 className="text-sm font-bold text-on-surface mb-1">{title}</h3>
      <p className="text-xs text-on-surface-variant max-w-md mx-auto leading-relaxed">{hint}</p>
    </div>
  )
}
