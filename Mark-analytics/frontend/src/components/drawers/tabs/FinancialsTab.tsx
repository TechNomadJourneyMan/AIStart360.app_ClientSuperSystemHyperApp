import { useCompany } from '../../../hooks/useCompany';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { formatCurrencyWithCode as formatCurrency, formatPercent } from '../../../lib/format';
import type { CompanyDetail } from '../../../types/company';

export interface FinancialsTabProps {
  companyId: string;
}

interface Metric {
  key: string;
  label: string;
  value: string;
  hint?: string;
  /** Numeric value if present, used to detect "any data" state. */
  raw: number | null;
}

export function FinancialsTab({ companyId }: FinancialsTabProps): JSX.Element {
  const { data, isLoading } = useCompany(companyId);

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const metrics = buildMetrics(data);
  const hasAny = metrics.some((m) => m.raw !== null);

  if (!hasAny) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Data unavailable for this company.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {metrics.map((m) => (
        <Card key={m.key}>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
              {m.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">{m.value}</p>
            {m.hint ? (
              <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">{m.hint}</p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function buildMetrics(c: CompanyDetail): Metric[] {
  const revenueRaw = toNumber(c.revenue_usd);
  const capRaw = toNumber(c.capitalization_usd);
  const shareCapRaw = toNumber(c.share_capital_kzt);
  const govShareRaw = toNumber(c.government_share_pct);

  return [
    {
      key: 'revenue',
      label: 'Revenue',
      value: revenueRaw !== null ? formatCurrency(revenueRaw, 'USD') : '—',
      raw: revenueRaw,
    },
    {
      key: 'capitalization',
      label: 'Capitalization',
      value: capRaw !== null ? formatCurrency(capRaw, 'USD') : '—',
      raw: capRaw,
    },
    {
      key: 'share_capital',
      label: 'Share capital',
      value: shareCapRaw !== null ? formatCurrency(shareCapRaw, 'KZT') : '—',
      raw: shareCapRaw,
    },
    {
      key: 'gov_share',
      label: 'Government share',
      value: govShareRaw !== null ? formatPercent(govShareRaw) : '—',
      raw: govShareRaw,
      hint: govShareRaw && govShareRaw > 0 ? 'State-affiliated' : undefined,
    },
  ];
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export default FinancialsTab;
