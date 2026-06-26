import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Widget } from './Widget';
import { Sparkline } from './Sparkline';
import { EconomyIndicatorsModal } from './EconomyIndicatorsModal';
import { getIndicator, type MacroIndicatorEntry } from '@/data/kzMacroIndicators';

/**
 * Tiles shown on the compact macro widget. Numbers come from the curated
 * registry (kzMacroIndicators); sparkline shapes below are ILLUSTRATIVE only
 * (no live history series yet) — hence the «динамика иллюстративна» note.
 *
 * `indicatorId` maps the tile to a curated entry so the displayed value is
 * always honest (or «—» when the registry has null).
 */
interface MacroTile {
  indicatorId: string;
  labelKey: string;
  /** Illustrative sparkline shape — NOT real history. */
  series: number[];
}

const MACRO_TILES: MacroTile[] = [
  {
    indicatorId: 'nbk_base_rate',
    labelKey: 'widget.macro.rate',
    series: [16.5, 16.5, 16.0, 16.0, 16.0, 16.25, 16.75, 17.0, 17.25, 17.5, 17.75, 18.0, 18.0, 18.0, 18.0],
  },
  {
    indicatorId: 'cpi_yoy',
    labelKey: 'widget.macro.inflation',
    series: [8.4, 8.6, 8.9, 9.2, 9.5, 9.8, 10.1, 10.4, 10.7, 10.9, 11.0, 11.1, 11.2, 11.3, 11.3],
  },
  {
    indicatorId: 'usd_kzt',
    labelKey: 'widget.macro.fx',
    series: [498, 500, 503, 505, 508, 510, 512, 515, 517, 519, 521, 522, 523, 524, 525],
  },
  {
    indicatorId: 'gdp_yoy',
    labelKey: 'widget.macro.gdp',
    series: [4.2, 4.3, 4.4, 4.5, 4.6, 4.6, 4.7, 4.8, 4.8, 4.9, 4.9, 5.0, 5.0, 5.0, 5.0],
  },
  {
    indicatorId: 'brent',
    labelKey: 'widget.macro.oil',
    series: [82, 81.5, 81, 80.5, 80, 79.5, 80, 80.5, 81, 81.5, 82, 82.5, 82, 81.5, 82],
  },
];

function formatValue(entry: MacroIndicatorEntry | undefined): {
  value: string;
  unit: string | null;
} {
  if (!entry || entry.latest_value === null) {
    return { value: '—', unit: null };
  }
  const v = entry.latest_value;
  const value = Number.isInteger(v)
    ? v.toLocaleString('ru-RU')
    : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return { value, unit: entry.unit };
}

export function MacroDashboardWidget(): JSX.Element {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <Widget
        title={t('widget.macro.title')}
        subtitle="динамика иллюстративна"
        actions={
          <button
            type="button"
            data-no-drag
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <span>Все показатели</span>
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        }
      >
        <div className="grid h-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {MACRO_TILES.map((tile) => (
            <MacroCard key={tile.indicatorId} tile={tile} label={t(tile.labelKey)} />
          ))}
        </div>
      </Widget>
      <EconomyIndicatorsModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}

interface MacroCardProps {
  tile: MacroTile;
  label: string;
}

function MacroCard({ tile, label }: MacroCardProps): JSX.Element {
  const entry = getIndicator(tile.indicatorId);
  const { value, unit } = formatValue(entry);
  const hasData = Boolean(entry && entry.latest_value !== null);

  return (
    <div className="flex min-w-0 flex-col rounded-md border border-neutral-100 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="truncate text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className={`text-lg font-semibold tabular-nums ${
            hasData
              ? 'text-neutral-900 dark:text-neutral-50'
              : 'text-neutral-400 dark:text-neutral-500'
          }`}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">{unit}</span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-between gap-1">
        {hasData ? (
          <span className="text-neutral-400 dark:text-neutral-500">
            <Sparkline values={tile.series} width={70} height={20} />
          </span>
        ) : (
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500">нет данных</span>
        )}
      </div>
    </div>
  );
}

export default MacroDashboardWidget;
