/**
 * mapFilterStore — local, map-scoped filter state owned by the map module.
 *
 * Holds the set of industry section letters (A..U) the user has toggled on via
 * the {@link MapLegend}. Kept separate from the global `directoryFilter` store
 * (which drives the Directory page and accepts a single industry_code) so the
 * map can support MULTI-industry selection without coupling to other surfaces.
 *
 * Empty set = no industry filter (show everything). Any selection filters the
 * company / cluster layers to companies whose ОКЭД section letter is selected.
 */

import { create } from 'zustand';

export interface MapFilterState {
  /** Selected ОКЭД section letters (e.g. {"G","J"}). Empty = all industries. */
  selectedIndustries: Set<string>;
  /** Toggle a single section letter in/out of the selection. */
  toggleIndustry: (section: string) => void;
  /** Clear all industry filters. */
  clearIndustries: () => void;
  /** Whether any industry filter is active. */
  hasIndustryFilter: () => boolean;
}

export const useMapFilterStore = create<MapFilterState>((set, get) => ({
  selectedIndustries: new Set<string>(),
  toggleIndustry: (section) =>
    set((s) => {
      const next = new Set(s.selectedIndustries);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return { selectedIndustries: next };
    }),
  clearIndustries: () => set({ selectedIndustries: new Set<string>() }),
  hasIndustryFilter: () => get().selectedIndustries.size > 0,
}));
