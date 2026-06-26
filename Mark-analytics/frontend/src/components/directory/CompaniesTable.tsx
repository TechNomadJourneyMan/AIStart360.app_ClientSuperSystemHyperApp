/**
 * Server-paginated results table for the Directory page.
 *
 * - Multi-select via the checkbox column (header toggles all on the visible
 *   page; row click opens the deep drawer instead of selecting).
 * - Sticky header with `top-0 sticky`.
 * - "Load more" button at the bottom drives `fetchNextPage`.
 * - Empty / error / loading states all live here so the parent route stays
 *   layout-only.
 */

import { useMemo } from 'react';
import { useMapStore } from '@/stores/map';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { CompanyListItem } from '@/types/company';
import type { UseCompaniesListResult } from '@/hooks/useCompaniesList';

interface CompaniesTableProps {
  query: UseCompaniesListResult;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleAllVisible: () => void;
}

export function CompaniesTable({
  query,
  selected,
  onToggleSelected,
  onToggleAllVisible,
}: CompaniesTableProps): JSX.Element {
  const selectCompany = useMapStore((s) => s.selectCompany);
  const items = query.flatItems;
  const allVisibleSelected = items.length > 0 && items.every((it) => selected.has(it.id));

  if (query.isLoading && items.length === 0) {
    return <TableSkeleton />;
  }

  if (query.isError && items.length === 0) {
    return (
      <div
        role="alert"
        className="m-4 flex flex-col items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        <p className="font-medium">Failed to load companies</p>
        <p className="text-xs opacity-80">{query.error?.message ?? 'Unknown error'}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!query.isLoading && items.length === 0) {
    return (
      <div className="m-6 flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[color:var(--border)] p-10 text-center">
        <p className="text-sm font-medium">No companies match these filters</p>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          Try clearing the filter rail on the left or adjusting your search query.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[color:var(--card)] shadow-[0_1px_0_var(--border)]">
            <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allVisibleSelected}
                  onChange={onToggleAllVisible}
                  className="h-3.5 w-3.5"
                />
              </th>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">BIN</th>
              <th scope="col" className="px-3 py-2">Industry</th>
              <th scope="col" className="px-3 py-2">Region</th>
              <th scope="col" className="px-3 py-2">Size</th>
              <th scope="col" className="px-3 py-2 text-right">Revenue</th>
              <th scope="col" className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <Row
                key={c.id}
                company={c}
                selected={selected.has(c.id)}
                onToggleSelected={() => onToggleSelected(c.id)}
                onOpen={() => selectCompany(c.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-[color:var(--border)] px-3 py-2">
        <p className="text-xs text-[color:var(--muted-foreground)]">
          Showing {items.length}
          {query.totalEstimate != null ? ` of ~${formatNumber(query.totalEstimate)}` : ''}
        </p>
        {query.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        ) : (
          <span className="text-xs text-[color:var(--muted-foreground)]">End of results</span>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  company: CompanyListItem;
  selected: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
}

function Row({ company, selected, onToggleSelected, onOpen }: RowProps): JSX.Element {
  return (
    <tr
      className={cn(
        'cursor-pointer border-b border-[color:var(--border)] hover:bg-[color:var(--accent)]/40 focus-within:bg-[color:var(--accent)]/40',
        selected && 'bg-[color:var(--accent)]/60',
      )}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      tabIndex={0}
    >
      <td
        className="w-10 px-3 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          aria-label={`Select ${company.name}`}
          checked={selected}
          onChange={onToggleSelected}
          className="h-3.5 w-3.5"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{company.name}</span>
          <ConfidencePill confidence={company.confidence} />
          <FreshnessPill updatedAt={company.updated_at} />
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-[color:var(--muted-foreground)]">
        {company.bin ?? '—'}
      </td>
      <td className="px-3 py-2">
        {company.industry?.label ?? company.industry?.code ?? '—'}
      </td>
      <td className="px-3 py-2">{company.region_name ?? company.city_name ?? '—'}</td>
      <td className="px-3 py-2 capitalize">{company.size_category ?? '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {company.revenue_usd != null
          ? formatCurrency(Number(company.revenue_usd))
          : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
        {relativeFromNow(company.updated_at)}
      </td>
    </tr>
  );
}

function ConfidencePill({ confidence }: { confidence: number | null }): JSX.Element | null {
  // TODO(C1): once trust signals land, show colored pill keyed off score.
  if (confidence == null) return null;
  return (
    <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
      {Math.round(confidence * 100)}%
    </Badge>
  );
}

function FreshnessPill({ updatedAt }: { updatedAt: string }): JSX.Element | null {
  const days = useMemo(() => daysSince(updatedAt), [updatedAt]);
  if (days == null) return null;
  const fresh = days <= 30;
  return (
    <Badge
      variant={fresh ? 'secondary' : 'outline'}
      className="px-1.5 py-0 text-[10px]"
      title={`Last updated ${days} day${days === 1 ? '' : 's'} ago`}
    >
      {fresh ? 'fresh' : `${days}d`}
    </Badge>
  );
}

function relativeFromNow(iso: string): string {
  const d = daysSince(iso);
  if (d == null) return '—';
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 3600 * 1000)));
}

function TableSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export default CompaniesTable;
