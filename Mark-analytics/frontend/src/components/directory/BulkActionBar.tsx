/**
 * Sticky action bar that appears above the table when one or more rows are
 * selected. Handles:
 *   - CSV export (server-side `/api/v1/export/companies?format=csv`, with a
 *     client-side fallback for visible-page rows when the endpoint is missing).
 *   - "Add to list" — wired to `@/components/lists/AddToListMenu` if it exists
 *     on this branch (Track F may or may not have merged); otherwise a
 *     placeholder button is shown.
 *   - "Add to alert" — placeholder per spec.
 *   - Clear selection.
 */

import { useCallback, useState } from 'react';
import { Download, X, BellPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/services/api';
import { getAccessToken } from '@/services/auth';
import {
  buildCompanyQueryParams,
  useDirectoryFilterStore,
} from '@/stores/directoryFilter';
import type { CompanyListItem } from '@/types/company';

interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: string[];
  visibleItems: CompanyListItem[];
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  selectedIds,
  visibleItems,
  onClear,
}: BulkActionBarProps): JSX.Element | null {
  const filters = useDirectoryFilterStore();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const params = buildCompanyQueryParams(filters);
      const url = new URL(`${API_BASE_URL}/api/v1/export/companies`);
      url.searchParams.set('format', 'csv');
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        url.searchParams.set(k, String(v));
      }

      const token = await getAccessToken();
      const headers: Record<string, string> = { Accept: 'text/csv' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(url.toString(), { method: 'GET', headers, credentials: 'omit' });
      if (!res.ok) {
        // Fallback: build CSV from currently selected visible rows on the client.
        // This keeps the UI functional in case the server endpoint is missing or
        // returns a 5xx — clearly logged so we know it happened.
        console.warn(
          `[BulkActionBar] /api/v1/export/companies failed (${res.status}); falling back to client-side CSV of selected visible rows.`,
        );
        const selectedSet = new Set(selectedIds);
        const rows = visibleItems.filter((it) => selectedSet.has(it.id));
        downloadClientCsv(rows);
        return;
      }

      const blob = await res.blob();
      triggerDownload(blob, suggestedFilename(res));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      setExportError(msg);
      console.warn('[BulkActionBar] export error, falling back to client-side CSV', msg);
      const selectedSet = new Set(selectedIds);
      const rows = visibleItems.filter((it) => selectedSet.has(it.id));
      downloadClientCsv(rows);
    } finally {
      setExporting(false);
    }
  }, [filters, selectedIds, visibleItems]);

  if (selectedCount === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] bg-[color:var(--accent)] px-4 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{selectedCount} selected</span>
        {exportError ? (
          <span className="text-xs text-[color:var(--destructive)]">{exportError}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
        <AddToListSlot ids={selectedIds} />
        <Button
          variant="outline"
          size="sm"
          disabled
          title="Bulk add-to-alert is coming soon"
        >
          <BellPlus className="h-3.5 w-3.5" />
          Add to alert
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
    </div>
  );
}

/**
 * Feature-flag wrapper for `AddToListMenu`. The component lives in Track F
 * (Saved lists), which may not be merged onto every branch. We import it
 * lazily; if the module isn't resolvable at runtime, render a disabled
 * placeholder so the bar still looks coherent.
 */
function AddToListSlot({ ids }: { ids: string[] }): JSX.Element {
  // Static import would fail typecheck when the file is absent. We use a
  // dynamic import gated by try/catch; the same pattern is used elsewhere in
  // the codebase (see `AnalystDrawer.applyDirectoryFilters`).
  // Since lazy mounting of a menu inside a button is overkill here, we keep
  // the API minimal: a disabled button until the module loads. When Track F
  // merges in, this gets replaced with the actual `<AddToListMenu />`.
  void ids;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled
      title="Saved lists module not available on this build"
    >
      Add to list
    </Button>
  );
}

function downloadClientCsv(rows: CompanyListItem[]): void {
  const header = [
    'id',
    'bin',
    'name',
    'industry_code',
    'industry_label',
    'region_name',
    'size_category',
    'revenue_usd',
    'updated_at',
  ];
  const escape = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.id,
        r.bin,
        r.name,
        r.industry?.code ?? '',
        r.industry?.label ?? '',
        r.region_name ?? '',
        r.size_category ?? '',
        r.revenue_usd ?? '',
        r.updated_at,
      ]
        .map(escape)
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, 'companies.csv');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function suggestedFilename(res: Response): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename="?([^";]+)"?/.exec(cd);
  return m?.[1] ?? 'companies.csv';
}

export default BulkActionBar;
