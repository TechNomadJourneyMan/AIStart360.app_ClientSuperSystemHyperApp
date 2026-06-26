import { useTranslation } from 'react-i18next';
import { Widget } from './Widget';

interface TickerItem {
  symbol: string;
  price: string;
  delta: number;
}

// TODO(real-data): KASE / AIX real-time feeds, NBK daily FX, EIA Brent, LBMA Gold.
const DEMO_TICKERS: TickerItem[] = [
  { symbol: 'KASE', price: '4,820.15', delta: 0.42 },
  { symbol: 'AIX', price: '1,134.80', delta: -0.18 },
  { symbol: 'USD/KZT', price: '498.20', delta: 0.12 },
  { symbol: 'EUR/KZT', price: '538.40', delta: 0.05 },
  { symbol: 'RUB/KZT', price: '5.42', delta: -0.31 },
  { symbol: 'CNY/KZT', price: '68.90', delta: 0.08 },
  { symbol: 'BRENT', price: '82.40', delta: -1.20 },
  { symbol: 'GOLD', price: '2,345.10', delta: 0.55 },
];

export function MarketTickerWidget(): JSX.Element {
  const { t } = useTranslation();

  // Duplicate the list once for a seamless CSS-only loop.
  const looped = [...DEMO_TICKERS, ...DEMO_TICKERS];

  return (
    <Widget
      title={t('widget.ticker.title')}
      subtitle={t('widget.demo')}
      noScroll
    >
      <style>{`
        @keyframes mk-ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .mk-ticker-track {
          animation: mk-ticker-scroll 30s linear infinite;
        }
        .mk-ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>

      <div className="flex h-full items-center overflow-hidden">
        <div className="mk-ticker-track flex w-max items-center gap-6 whitespace-nowrap will-change-transform">
          {looped.map((t, idx) => {
            const positive = t.delta > 0;
            const negative = t.delta < 0;
            const color = positive
              ? 'text-emerald-600 dark:text-emerald-400'
              : negative
                ? 'text-red-600 dark:text-red-400'
                : 'text-neutral-500 dark:text-neutral-400';
            return (
              // eslint-disable-next-line react/no-array-index-key -- doubled static list
              <span key={`${t.symbol}-${idx}`} className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-semibold tracking-wider text-neutral-700 dark:text-neutral-200">
                  {t.symbol}
                </span>
                <span className="text-[12px] tabular-nums text-neutral-900 dark:text-neutral-100">
                  {t.price}
                </span>
                <span className={`text-[11px] tabular-nums ${color}`}>
                  {positive ? '+' : ''}
                  {t.delta.toFixed(2)}%
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </Widget>
  );
}

export default MarketTickerWidget;
