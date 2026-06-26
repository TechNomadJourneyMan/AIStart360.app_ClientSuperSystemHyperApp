import { create } from 'zustand';

export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

export type LayerKey = 'companies' | 'regions' | 'heatmap';

export interface EnabledLayers {
  companies: boolean;
  regions: boolean;
  heatmap: boolean;
}

export type RegionMetric = 'count' | 'revenue' | 'employees' | 'risk';

export interface MapState {
  viewState: ViewState;
  selectedCompanyId: string | null;
  selectedRegionKato: string | null;
  hoveredRegionKato: string | null;
  /**
   * Controls visibility of the full {@link RegionDrawer} deep-dive. A region
   * click now opens only the compact {@link RegionMarketPopup}; the drawer is
   * opened explicitly via the popup's "Подробнее" action. Kept independent of
   * `selectedRegionKato` so closing the drawer preserves the selection.
   */
  regionDrawerOpen: boolean;
  enabledLayers: EnabledLayers;
  metric: RegionMetric;
  setViewState: (next: Partial<ViewState>) => void;
  selectCompany: (id: string | null) => void;
  selectRegion: (kato: string | null) => void;
  setHoveredRegion: (kato: string | null) => void;
  setRegionDrawerOpen: (open: boolean) => void;
  toggleLayer: (key: LayerKey) => void;
  setLayer: (key: LayerKey, value: boolean) => void;
  setMetric: (m: RegionMetric) => void;
  reset: () => void;
}

// Center of Kazakhstan (approx Astana area for sensible default).
const INITIAL_VIEW: ViewState = {
  longitude: 66.5,
  latitude: 48.0,
  zoom: 4.2,
  bearing: 0,
  pitch: 0,
};

const INITIAL_LAYERS: EnabledLayers = {
  companies: true,
  // Regions on by default: the backend now serves 16 real KZ region polygons.
  // The choropleth fill/outline is kept subtle so company markers stay clearly
  // visible on top (companies are rendered after the regions layer).
  regions: true,
  heatmap: false,
};

const INITIAL_METRIC: RegionMetric = 'count';

export const useMapStore = create<MapState>((set) => ({
  viewState: INITIAL_VIEW,
  selectedCompanyId: null,
  selectedRegionKato: null,
  hoveredRegionKato: null,
  regionDrawerOpen: false,
  enabledLayers: INITIAL_LAYERS,
  metric: INITIAL_METRIC,
  setViewState: (next) =>
    set((s) => ({ viewState: { ...s.viewState, ...next } })),
  selectCompany: (id) => set({ selectedCompanyId: id }),
  // Selecting a different region (or clearing it) closes any open deep-dive.
  selectRegion: (kato) => set({ selectedRegionKato: kato, regionDrawerOpen: false }),
  setHoveredRegion: (kato) => set({ hoveredRegionKato: kato }),
  setRegionDrawerOpen: (open) => set({ regionDrawerOpen: open }),
  toggleLayer: (key) =>
    set((s) => ({
      enabledLayers: { ...s.enabledLayers, [key]: !s.enabledLayers[key] },
    })),
  setLayer: (key, value) =>
    set((s) => ({ enabledLayers: { ...s.enabledLayers, [key]: value } })),
  setMetric: (m) => set({ metric: m }),
  reset: () =>
    set({
      viewState: INITIAL_VIEW,
      selectedCompanyId: null,
      selectedRegionKato: null,
      hoveredRegionKato: null,
      regionDrawerOpen: false,
      enabledLayers: INITIAL_LAYERS,
      metric: INITIAL_METRIC,
    }),
}));
