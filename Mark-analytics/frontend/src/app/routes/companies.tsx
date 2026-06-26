/**
 * BD-persona Directory page — `/companies`.
 *
 * Spec: docs/aistart360/07-product-redesign.md §4 "Advanced Directory" + §11
 * PR #7. Layout:
 *   - Top bar: search + saved searches.
 *   - Left rail (collapsible): filter groups.
 *   - Main: bulk-action bar (when selected) + paginated table.
 * Row click opens the existing `CompanyDeepDrawer` (driven by the map store's
 * `selectedCompanyId`).
 */

import { useCallback, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { CompanyDeepDrawer } from '@/components/drawers/CompanyDeepDrawer';
import { FilterRail } from '@/components/directory/FilterRail';
import { CompaniesTable } from '@/components/directory/CompaniesTable';
import { BulkActionBar } from '@/components/directory/BulkActionBar';
import { SavedSearchesBar } from '@/components/directory/SavedSearchesBar';
import { useCompaniesList } from '@/hooks/useCompaniesList';

export const Route = createFileRoute('/companies')({
  component: CompaniesRoute,
});

function CompaniesRoute(): JSX.Element {
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const query = useCompaniesList();

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelected((prev) => {
      const visible = query.flatItems;
      const allVisibleSelected = visible.length > 0 && visible.every((it) => prev.has(it.id));
      const next = new Set(prev);
      if (allVisibleSelected) {
        visible.forEach((it) => next.delete(it.id));
      } else {
        visible.forEach((it) => next.add(it.id));
      }
      return next;
    });
  }, [query.flatItems]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[color:var(--background)] text-[color:var(--foreground)]">
      <SavedSearchesBar />
      <div className="flex min-h-0 flex-1">
        <FilterRail
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((c) => !c)}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <BulkActionBar
            selectedCount={selected.size}
            selectedIds={selectedIds}
            visibleItems={query.flatItems}
            onClear={clearSelection}
          />
          <div className="min-h-0 flex-1">
            <CompaniesTable
              query={query}
              selected={selected}
              onToggleSelected={toggleSelected}
              onToggleAllVisible={toggleAllVisible}
            />
          </div>
        </main>
      </div>
      <CompanyDeepDrawer />
    </div>
  );
}

export default CompaniesRoute;
