/**
 * Top bar of the Directory page: free-text search (debounced 300ms) +
 * "Saved searches" dropdown. Persistence is intentionally LocalStorage-only
 * for v1; real CRUD is its own backend track (see spec §11 PR #7 "out of
 * scope").
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Save, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useDirectoryFilterStore,
  type DirectoryFilterState,
  type NumberRange,
} from '@/stores/directoryFilter';

const LS_KEY = 'mk:directory:saved-searches';
const DEBOUNCE_MS = 300;

interface SavedSearch {
  id: string;
  name: string;
  createdAt: string;
  state: SerializedFilters;
}

interface SerializedFilters {
  q: string;
  industry_code: string | null;
  region_kato: string | null;
  size_category: string | null;
  status: string | null;
  ownership_type: string | null;
  revenue_usd: NumberRange;
  business_age_years: NumberRange;
}

function readSaved(): SavedSearch[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSearch[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSaved(next: SavedSearch[]): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode — silent fallback. The UI still works in-session.
  }
}

function snapshot(s: DirectoryFilterState): SerializedFilters {
  return {
    q: s.q,
    industry_code: s.industry_code,
    region_kato: s.region_kato,
    size_category: s.size_category,
    status: s.status,
    ownership_type: s.ownership_type,
    revenue_usd: s.revenue_usd,
    business_age_years: s.business_age_years,
  };
}

export function SavedSearchesBar(): JSX.Element {
  const q = useDirectoryFilterStore((s) => s.q);
  const setQ = useDirectoryFilterStore((s) => s.setQ);
  const storeRef = useRef(useDirectoryFilterStore.getState);

  // Debounced local input state: the store gets `q` only after typing pauses,
  // so we don't refire the companies query on every keystroke.
  const [localQ, setLocalQ] = useState(q);
  useEffect(() => {
    setLocalQ(q);
  }, [q]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (localQ !== q) setQ(localQ);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [localQ, q, setQ]);

  const [saved, setSaved] = useState<SavedSearch[]>(() => readSaved());
  const [open, setOpen] = useState(false);

  const handleSave = useCallback(() => {
    const name = window.prompt('Name this search:');
    if (!name) return;
    const entry: SavedSearch = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      state: snapshot(storeRef.current()),
    };
    const next = [entry, ...saved].slice(0, 50);
    setSaved(next);
    writeSaved(next);
  }, [saved]);

  const handleApply = useCallback(
    (entry: SavedSearch) => {
      const s = storeRef.current();
      s.setQ(entry.state.q);
      s.setIndustry(entry.state.industry_code);
      s.setRegion(entry.state.region_kato);
      s.setSizeCategory(entry.state.size_category);
      s.setStatus(entry.state.status);
      s.setOwnership(entry.state.ownership_type);
      s.setRevenueRange(entry.state.revenue_usd);
      s.setAgeRange(entry.state.business_age_years);
      setOpen(false);
    },
    [],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const next = saved.filter((s) => s.id !== id);
      setSaved(next);
      writeSaved(next);
    },
    [saved],
  );

  return (
    <div className="flex items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--card)] px-4 py-2">
      <div className="relative flex-1 max-w-xl">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
        <Input
          value={localQ}
          placeholder="Search companies by name, BIN, tag…"
          className="pl-8 pr-8"
          onChange={(e) => setLocalQ(e.target.value)}
          aria-label="Search companies"
        />
        {localQ ? (
          <button
            type="button"
            onClick={() => {
              setLocalQ('');
              setQ('');
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[color:var(--muted-foreground)] hover:bg-[color:var(--accent)]"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          Saved searches
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-[color:var(--border)] bg-[color:var(--popover)] p-1 shadow-md"
            onMouseLeave={() => setOpen(false)}
          >
            {saved.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
                No saved searches yet. Pick filters then click &ldquo;Save current&rdquo;.
              </p>
            ) : (
              <ul className="max-h-72 overflow-y-auto">
                {saved.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => handleApply(s)}
                      className="flex-1 truncate text-left text-sm hover:underline"
                    >
                      {s.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      className="rounded p-1 text-[color:var(--muted-foreground)] hover:bg-[color:var(--accent)]"
                      aria-label={`Delete saved search ${s.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <Button variant="outline" size="sm" onClick={handleSave}>
        <Save className="h-3.5 w-3.5" />
        Save current
      </Button>
    </div>
  );
}

export default SavedSearchesBar;
