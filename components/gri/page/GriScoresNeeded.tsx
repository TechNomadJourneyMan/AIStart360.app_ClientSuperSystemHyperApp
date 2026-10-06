// components/gri/page/GriScoresNeeded.tsx — вкладка «AI-аналитик» до того,
// как у клиента есть оценки GRI: стратегия не строится по стартовым
// значениям ползунков, вместо неё — переход к диагностике или калькулятору.

/** AI tab before the client has scores: no strategy from template values. */
export default function GriScoresNeeded({ onGoAssess, onGoCalc }: { onGoAssess: () => void; onGoCalc: () => void }) {
  return (
    <div
      data-testid="gri-scores-needed"
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-center space-y-3"
    >
      <p className="text-sm text-on-surface">Стратегия роста строится по вашим оценкам GRI.</p>
      <p className="text-xs text-on-surface-variant">
        Пройдите диагностику или задайте оценки в калькуляторе — тогда здесь можно будет сгенерировать стратегию.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onGoAssess}
          className="rounded-lg bg-primary/15 px-3.5 py-2 text-sm font-semibold text-primary hover:bg-primary/25"
        >
          Пройти диагностику
        </button>
        <button
          type="button"
          onClick={onGoCalc}
          className="rounded-lg px-3.5 py-2 text-sm text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface"
        >
          Открыть калькулятор
        </button>
      </div>
    </div>
  )
}
