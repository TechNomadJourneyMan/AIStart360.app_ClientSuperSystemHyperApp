/**
 * Formatting helpers for numeric / currency / count / date display.
 *
 * Keep this module free of React imports so it can be reused inside deck.gl
 * layer factories and worker code.
 */

import { format, parseISO } from 'date-fns';

const COMPACT_THRESHOLDS: ReadonlyArray<readonly [number, string]> = [
  [1_000_000_000, 'B'],
  [1_000_000, 'M'],
  [1_000, 'K'],
];

function normalizeLocale(locale: string | undefined): string {
  if (!locale) return 'en-US';
  switch (locale) {
    case 'kz':
      return 'kk-KZ';
    case 'ru':
      return 'ru-RU';
    case 'en':
      return 'en-US';
    default:
      return locale;
  }
}

/**
 * Format a USD amount with a short suffix: `$1.2M`, `$45K`, `$842`.
 * For very small / negative numbers falls back to plain locale formatting.
 */
export function formatCurrency(usd: number, locale: string = 'en'): string {
  if (!Number.isFinite(usd)) return '—';
  const sign = usd < 0 ? '-' : '';
  const abs = Math.abs(usd);

  for (const [threshold, suffix] of COMPACT_THRESHOLDS) {
    if (abs >= threshold) {
      const value = abs / threshold;
      const formatted = value >= 100
        ? value.toFixed(0)
        : value >= 10
          ? value.toFixed(1)
          : value.toFixed(2);
      // Strip trailing zeros after decimal: `1.20` -> `1.2`, `10.0` -> `10`.
      const trimmed = formatted.replace(/\.0+$|(\.\d*?)0+$/, '$1');
      return `${sign}$${trimmed}${suffix}`;
    }
  }

  const nf = new Intl.NumberFormat(normalizeLocale(locale), {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  return nf.format(usd);
}

/**
 * Format an amount with explicit currency code (used by the deep drawer
 * financial tables where rows can be in different currencies).
 */
export function formatCurrencyWithCode(
  value: number | string | null | undefined,
  currency: 'USD' | 'KZT' | string = 'USD',
  locale: string = 'en',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(normalizeLocale(locale), {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Locale-aware grouped integer: `1,234,567` (en) or `1 234 567` (ru/kz).
 */
export function formatNumber(
  value: number | string | null | undefined,
  locale: string = 'en',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(normalizeLocale(locale)).format(n);
}

/**
 * Compact count for clusters / badges: 1234 -> "1.2k", 45 -> "45".
 */
export function formatCompactCount(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.round(n)));
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}k`;
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000;
    return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}M`;
  }
  const v = n / 1_000_000_000;
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}B`;
}

export function formatPercent(
  value: number | string | null | undefined,
  fractionDigits = 1,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(fractionDigits)}%`;
}

export function formatDate(value: string | null | undefined, pattern = 'dd MMM yyyy'): string {
  if (!value) return '—';
  try {
    return format(parseISO(value), pattern);
  } catch {
    return value;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  return formatDate(value, 'dd MMM yyyy HH:mm');
}
