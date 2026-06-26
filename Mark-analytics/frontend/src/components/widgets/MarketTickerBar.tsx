import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

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

/**
 * Slim, full-width market ticker pinned to the top of the dashboard, directly
 * below the global header. Reuses the scrolling marquee (CSS-only loop,
 * pause-on-hover) previously housed in `MarketTickerWidget`.
 *
 * ~32px tall, `shrink-0` friendly, themed with CSS-var tokens.
 */
export function MarketTickerBar({ className }: { className?: string }): JSX.Element {
  const { t } = useTranslation();

  // Duplicate the list once for a seamless CSS-only loop.
  const looped = [...DEMO_TICKERS, ...DEMO_TICKERS];

  return (
    <div
      role="region"
      aria-label={t('widget.ticker.title')}
      className={cn(
        'flex h-8 w-full shrink-0 items-center overflow-hidden border-b',
        'border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--card-foreground)]',
        className,
      )}
    >
      <style>{`
        @keyframes mk-ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .mk-ticker-bar-track {
          animation: mk-ticker-scroll 30s linear infinite;
        }
        .mk-ticker-bar-track:hover {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .mk-ticker-bar-track { animation: none; }
        }
      `}</style>

      <span className="hidden shrink-0 select-none px-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)] sm:inline">
        {t('widget.ticker.title')}
      </span>

      <div className="relative flex-1 overflow-hidden">
        <div className="mk-ticker-bar-track flex w-max items-center gap-6 whitespace-nowrap pl-3 will-change-transform">
          {looped.map((item, idx) => {
            const positive = item.delta > 0;
            const negative = item.delta < 0;
            const color = positive
              ? 'text-emerald-600 dark:text-emerald-400'
              : negative
                ? 'text-red-600 dark:text-red-400'
                : 'text-[color:var(--muted-foreground)]';
            return (
              // eslint-disable-next-line react/no-array-index-key -- doubled static list for seamless loop
              <span key={`${item.symbol}-${idx}`} className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-semibold tracking-wider text-[color:var(--card-foreground)]">
                  {item.symbol}
                </span>
                <span className="text-[12px] tabular-nums text-[color:var(--card-foreground)]">
                  {item.price}
                </span>
                <span className={cn('text-[11px] tabular-nums', color)}>
                  {positive ? '+' : ''}
                  {item.delta.toFixed(2)}%
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default MarketTickerBar;
