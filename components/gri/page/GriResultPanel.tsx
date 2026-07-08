'use client'

// components/gri/page/GriResultPanel.tsx — ЗАГЛУШКА. Полноценная вкладка
// «Результат» (индекс, средние по блокам, TOP-5, план 90 дней) строится в
// следующем батче. Здесь — минимальная карточка, чтобы shell компилировался.
export default function GriResultPanel(_props: {
  assessment?: unknown
  onGoAssess?: () => void
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
      <p className="text-sm text-on-surface-variant">Раздел появится в следующем обновлении</p>
    </div>
  )
}
