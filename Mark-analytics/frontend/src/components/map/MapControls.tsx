import { useTranslation } from 'react-i18next';

import { useMapStore, type LayerKey } from '../../stores/map';

export interface MapControlsProps {
  theme: 'light' | 'dark';
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onToggleTheme: () => void;
}

const BTN =
  'inline-flex items-center justify-center h-9 min-w-9 px-2 rounded-md border border-neutral-200 bg-white/90 text-neutral-800 text-sm shadow-sm backdrop-blur hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-100 dark:hover:bg-neutral-900';

const ACTIVE =
  'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-600 dark:bg-indigo-500 dark:border-indigo-500';

export function MapControls({
  theme,
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleTheme,
}: MapControlsProps): JSX.Element {
  const { t } = useTranslation();
  const enabledLayers = useMapStore((s) => s.enabledLayers);
  const toggleLayer = useMapStore((s) => s.toggleLayer);

  const layers: { key: LayerKey; label: string }[] = [
    { key: 'companies', label: t('map.layer.companies') ?? 'Компании' },
    { key: 'regions', label: t('map.layer.regions') ?? 'Регионы' },
    { key: 'heatmap', label: 'Тепловая карта' },
  ];

  return (
    <div className="flex flex-col gap-2" role="toolbar" aria-label="Map controls">
      <div className="flex gap-1">
        <button type="button" className={BTN} aria-label="Zoom in" onClick={onZoomIn}>
          +
        </button>
        <button type="button" className={BTN} aria-label="Zoom out" onClick={onZoomOut}>
          −
        </button>
        <button type="button" className={BTN} aria-label="Reset view to Kazakhstan" onClick={onResetView}>
          KZ
        </button>
        <button
          type="button"
          className={BTN}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} map`}
          onClick={onToggleTheme}
        >
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1 max-w-[260px]">
        {layers.map((l) => {
          const active = enabledLayers[l.key];
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={active}
              onClick={() => toggleLayer(l.key)}
              className={[BTN, active ? ACTIVE : ''].join(' ')}
            >
              {l.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MapControls;
