/**
 * Left filter rail for the BD-persona Directory page.
 *
 * - Reads filter taxonomy from `useFiltersCatalog` (`GET /api/v1/filters`).
 * - Writes selections into `useDirectoryFilterStore` so other widgets
 *   (heatmap, MK Analyst, the map) see the same filter state.
 * - Collapses to a `w-12` rail via `useUIStore.sidebarCollapsed`-style local
 *   state — kept local on purpose to avoid colliding with the global "My lists"
 *   sidebar.
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  activeFilterCount,
  useDirectoryFilterStore,
  type DirectoryFilterState,
  type NumberRange,
} from '@/stores/directoryFilter';
import {
  useFiltersCatalog,
  type FilterDefinition,
} from '@/hooks/useFiltersCatalog';

// Which filters we render in the rail, in order, with a friendly label. We
// don't render every backend filter — that would overwhelm the UI. The rest
// are still queryable via the API but live in an "Advanced" disclosure.
const PRIMARY_GROUPS: Array<{
  label: string;
  filterKey: string;
  storeKey: keyof DirectoryFilterState;
}> = [
  { label: 'Industry', filterKey: 'industry', storeKey: 'industry_code' },
  { label: 'Region', filterKey: 'region_kato', storeKey: 'region_kato' },
  { label: 'Company size', filterKey: 'company_size', storeKey: 'size_category' },
  { label: 'Ownership', filterKey: 'ownership_type', storeKey: 'ownership_type' },
  { label: 'Status', filterKey: 'status', storeKey: 'status' },
  { label: 'Revenue (USD)', filterKey: 'revenue_usd', storeKey: 'revenue_usd' },
  { label: 'Business age (years)', filterKey: 'business_age_years', storeKey: 'business_age_years' },
];

interface FilterRailProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function FilterRail({ collapsed, onToggleCollapsed }: FilterRailProps): JSX.Element {
  const { data: catalog, isLoading, isError } = useFiltersCatalog();
  const state = useDirectoryFilterStore();
  const activeCount = activeFilterCount(state);

  const catalogByKey = useMemo(() => {
    const m = new Map<string, FilterDefinition>();
    (catalog ?? []).forEach((f) => m.set(f.key, f));
    return m;
  }, [catalog]);

  if (collapsed) {
    return (
      <aside
        aria-label="Filters (collapsed)"
        className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-[color:var(--border)] bg-[color:var(--card)] py-3"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Expand filters"
          onClick={onToggleCollapsed}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="relative">
          <Filter className="h-4 w-4 text-[color:var(--muted-foreground)]" />
          {activeCount > 0 ? (
            <span
              aria-label={`${activeCount} active filters`}
              className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--primary)] px-1 text-[10px] font-medium text-[color:var(--primary-foreground)]"
            >
              {activeCount}
            </span>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Filters"
      className="flex w-72 shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--card)]"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[color:var(--muted-foreground)]" />
          <span className="text-sm font-medium">Filters</span>
          {activeCount > 0 ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {activeCount}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {activeCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => state.clear()}
              aria-label="Clear all filters"
            >
              Clear
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Collapse filters"
            onClick={onToggleCollapsed}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {isLoading ? (
          <RailSkeleton />
        ) : isError ? (
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Couldn&apos;t load filter catalog. Using built-in defaults.
          </p>
        ) : null}

        {PRIMARY_GROUPS.map((g) => (
          <FilterGroup
            key={g.filterKey}
            label={g.label}
            definition={catalogByKey.get(g.filterKey)}
            storeKey={g.storeKey}
          />
        ))}
      </div>
    </aside>
  );
}

function RailSkeleton(): JSX.Element {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

interface FilterGroupProps {
  label: string;
  definition: FilterDefinition | undefined;
  storeKey: keyof DirectoryFilterState;
}

function FilterGroup({ label, definition, storeKey }: FilterGroupProps): JSX.Element {
  // Range filters live under a structured shape in the store; enum / text are
  // scalar strings. Dispatch on the store shape, not the backend type, because
  // a missing catalog entry should still render the right control.
  const isRange = storeKey === 'revenue_usd' || storeKey === 'business_age_years';

  if (isRange) {
    return <RangeFilter label={label} storeKey={storeKey as 'revenue_usd' | 'business_age_years'} />;
  }

  if (definition?.values && definition.values.length > 0) {
    return (
      <EnumFilter
        label={label}
        values={definition.values}
        storeKey={storeKey as keyof Pick<DirectoryFilterState, 'industry_code' | 'region_kato' | 'size_category' | 'status' | 'ownership_type'>}
      />
    );
  }

  return (
    <TextFilter
      label={label}
      placeholder={definition?.description ?? ''}
      storeKey={storeKey as keyof Pick<DirectoryFilterState, 'industry_code' | 'region_kato' | 'size_category' | 'status' | 'ownership_type'>}
    />
  );
}

type ScalarStoreKey =
  | 'industry_code'
  | 'region_kato'
  | 'size_category'
  | 'status'
  | 'ownership_type';

function useScalarFilter(key: ScalarStoreKey): [string | null, (v: string | null) => void] {
  const value = useDirectoryFilterStore((s) => s[key]) as string | null;
  const set = useDirectoryFilterStore((s) => {
    switch (key) {
      case 'industry_code':
        return s.setIndustry;
      case 'region_kato':
        return s.setRegion;
      case 'size_category':
        return s.setSizeCategory;
      case 'status':
        return s.setStatus;
      case 'ownership_type':
        return s.setOwnership;
    }
  });
  return [value, set];
}

function EnumFilter({
  label,
  values,
  storeKey,
}: {
  label: string;
  values: string[];
  storeKey: ScalarStoreKey;
}): JSX.Element {
  const [current, set] = useScalarFilter(storeKey);
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
        {label}
      </legend>
      <div className="space-y-1">
        {values.map((v) => {
          const checked = current === v;
          return (
            <label
              key={v}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm',
                'hover:bg-[color:var(--accent)] hover:text-[color:var(--accent-foreground)]',
                checked && 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]',
              )}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={checked}
                onChange={() => set(checked ? null : v)}
              />
              <span className="capitalize">{v.replace(/_/g, ' ')}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function TextFilter({
  label,
  placeholder,
  storeKey,
}: {
  label: string;
  placeholder: string;
  storeKey: ScalarStoreKey;
}): JSX.Element {
  const [current, set] = useScalarFilter(storeKey);
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
        {label}
      </label>
      <div className="relative">
        <Input
          value={current ?? ''}
          placeholder={placeholder || 'Any'}
          onChange={(e) => set(e.target.value.trim() ? e.target.value : null)}
        />
        {current ? (
          <button
            type="button"
            onClick={() => set(null)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[color:var(--muted-foreground)] hover:bg-[color:var(--accent)]"
            aria-label={`Clear ${label}`}
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RangeFilter({
  label,
  storeKey,
}: {
  label: string;
  storeKey: 'revenue_usd' | 'business_age_years';
}): JSX.Element {
  const value = useDirectoryFilterStore((s) => s[storeKey]);
  const setRevenue = useDirectoryFilterStore((s) => s.setRevenueRange);
  const setAge = useDirectoryFilterStore((s) => s.setAgeRange);
  const set = storeKey === 'revenue_usd' ? setRevenue : setAge;

  // Local input state so the user can type "1000" without the store dropping
  // the value mid-keystroke. We sync on blur / Enter.
  const [gte, setGte] = useState<string>(value.gte == null ? '' : String(value.gte));
  const [lte, setLte] = useState<string>(value.lte == null ? '' : String(value.lte));

  const commit = (nextGte: string, nextLte: string): void => {
    const range: NumberRange = {
      gte: nextGte.trim() === '' ? null : Number(nextGte),
      lte: nextLte.trim() === '' ? null : Number(nextLte),
    };
    if (range.gte != null && !Number.isFinite(range.gte)) range.gte = null;
    if (range.lte != null && !Number.isFinite(range.lte)) range.lte = null;
    set(range);
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          inputMode="numeric"
          placeholder="Min"
          value={gte}
          onChange={(e) => setGte(e.target.value)}
          onBlur={() => commit(gte, lte)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(gte, lte);
          }}
          aria-label={`${label} minimum`}
        />
        <span className="text-xs text-[color:var(--muted-foreground)]">to</span>
        <Input
          inputMode="numeric"
          placeholder="Max"
          value={lte}
          onChange={(e) => setLte(e.target.value)}
          onBlur={() => commit(gte, lte)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(gte, lte);
          }}
          aria-label={`${label} maximum`}
        />
      </div>
    </div>
  );
}

export default FilterRail;
