import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import maplibregl, { Map as MapLibreMap, LngLatBoundsLike } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { GeoJsonLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import Supercluster from 'supercluster';
import { useTranslation } from 'react-i18next';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapStore } from '../../stores/map';
import { useDirectoryFilterStore } from '../../stores/directoryFilter';
import { useCompaniesGeo, type BBox, type CompanyGeoFeature } from '../../hooks/useCompaniesGeo';
import { MapControls } from './MapControls';
import { MapLegend } from './MapLegend';
import { InsightsOverlay } from './InsightsOverlay';
import { MetricSelector } from './MetricSelector';
import { RegionTooltip } from './RegionTooltip';
import { RegionDrawer } from './RegionDrawer';
import { RegionMarketPopup } from './RegionMarketPopup';
import { createCompanyLayer, type CompanyFeatureProps } from './CompanyLayer';
import { createClusterLayers, type ClusterFeatureProps } from './ClusterLayer';
import { createRegionChoroplethLayer } from './RegionChoropleth';
import {
  useRegionsGeo,
  useRegionDistribution,
  type RegionFeatureProperties,
} from '../../hooks/useRegions';
import { industryLabel, sectionFromCode } from '../../lib/colorScheme';
import { formatCurrency } from '../../lib/format';
import { useMapFilterStore } from './mapFilterStore';

// Central Asia bounds — default initial view: covers Kazakhstan plus
// Uzbekistan, Turkmenistan, Kyrgyzstan, Tajikistan, southern Russia, and the
// western fringe of China (Xinjiang). The reset-view button uses these bounds.
const CENTRAL_ASIA_BOUNDS: LngLatBoundsLike = [
  [45.0, 33.0],
  [90.0, 58.0],
];

// Raster basemaps — work everywhere, no API key. We define both as full
// StyleSpecification objects with a bg layer first so MapLibre always has
// something to paint, even before tiles arrive.
//
// LIGHT: CARTO Voyager — more detailed than plain OSM, with labeled streets.
// `{r}` resolves to "@2x" on retina displays for crisp tiles.
const OSM_LIGHT_STYLE = {
  version: 8 as const,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'carto-voyager': {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
      maxzoom: 20,
    },
  },
  layers: [
    {
      id: 'bg',
      type: 'background' as const,
      paint: { 'background-color': '#e8e8e8' },
    },
    { id: 'carto-voyager', type: 'raster' as const, source: 'carto-voyager' },
  ],
};

const OSM_DARK_STYLE = {
  version: 8 as const,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'carto-dark': {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'bg',
      type: 'background' as const,
      paint: { 'background-color': '#0e1116' },
    },
    { id: 'carto-dark', type: 'raster' as const, source: 'carto-dark' },
  ],
};

/** Zoom threshold at which we stop clustering and render raw points. */
const CLUSTER_CUTOFF_ZOOM = 7;

function resolveStyle(theme: 'light' | 'dark'): string | object {
  const key = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_MAPTILER_KEY;
  if (key) {
    return theme === 'dark'
      ? `https://api.maptiler.com/maps/streets-dark/style.json?key=${key}`
      : `https://api.maptiler.com/maps/streets/style.json?key=${key}`;
  }
  return theme === 'dark' ? OSM_DARK_STYLE : OSM_LIGHT_STYLE;
}

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveRegionName(
  props: RegionFeatureProperties | undefined,
  lang: string,
): string {
  if (!props) return '';
  if (lang.startsWith('kz') || lang.startsWith('kk')) {
    return props.name_kz ?? props.name_ru ?? props.name_en ?? props.kato_code;
  }
  if (lang.startsWith('en')) {
    return props.name_en ?? props.name_ru ?? props.kato_code;
  }
  return props.name_ru ?? props.name_en ?? props.kato_code;
}

/**
 * Compute the [west, south, east, north] bounds of a Polygon / MultiPolygon
 * GeoJSON geometry. Returns null for non-polygon geometries. Used by the
 * region double-click → zoom-to-fit interaction (no turf dependency needed).
 */
function geometryBounds(
  geometry: GeoJSON.Geometry | undefined,
): [[number, number], [number, number]] | null {
  if (!geometry) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (coords: unknown): void => {
    if (
      Array.isArray(coords) &&
      coords.length >= 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      const [x, y] = coords as [number, number];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    if (Array.isArray(coords)) for (const c of coords) visit(c);
  };
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    visit(geometry.coordinates);
  } else {
    return null;
  }
  if (!isFinite(minX) || !isFinite(minY)) return null;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

/**
 * Legacy lightweight point shape used by callers that already feed
 * pre-fetched companies via props. Retained for backward compat with
 * existing route code; new callers should rely on the hook-driven path.
 */
export interface CompanyPoint {
  id: string;
  longitude: number;
  latitude: number;
  name?: string;
  industry_code?: string | null;
  industry_label?: string | null;
  region_kato?: string | null;
  region_name?: string | null;
  revenue_usd?: number | null;
}

export interface MapShellProps {
  initialBounds?: LngLatBoundsLike;
  /**
   * If provided, bypasses the `useCompaniesGeo` fetch and uses the
   * caller-supplied points. Useful for tests and SSR snapshots.
   */
  companies?: CompanyPoint[];
  regionsGeoJson?: GeoJSON.FeatureCollection | null;
  onCompanyClick?: (id: string) => void;
  onRegionClick?: (katoCode: string) => void;
  className?: string;
  /**
   * Compact mode — hides controls, legend, and metric selector. Used by
   * the Track G `MapMiniWidget` to embed a chrome-less map inside a
   * dashboard tile.
   */
  compact?: boolean;
}

interface ClusterProperties {
  cluster?: boolean;
  cluster_id?: number;
  point_count?: number;
  point_count_abbreviated?: number | string;
  companyId?: string;
  feature?: CompanyFeatureProps;
}

interface HoverState {
  x: number;
  y: number;
  feature: CompanyFeatureProps;
}

/** Anchored region market popup: which region + where it was clicked. */
interface RegionPopupState {
  kato: string;
  x: number;
  y: number;
}

function toCompanyFeature(p: CompanyPoint): CompanyFeatureProps {
  return {
    id: p.id,
    name: p.name ?? p.id,
    longitude: p.longitude,
    latitude: p.latitude,
    industry_code: p.industry_code ?? null,
    industry_label: p.industry_label ?? null,
    region_kato: p.region_kato ?? null,
    region_name: p.region_name ?? null,
    revenue_usd: p.revenue_usd ?? null,
  };
}

function fromGeoFeature(f: CompanyGeoFeature): CompanyFeatureProps {
  return {
    id: f.id,
    name: f.name,
    longitude: f.longitude,
    latitude: f.latitude,
    industry_code: f.industry_code ?? null,
    industry_label: f.industry_label ?? null,
    region_kato: f.region_kato ?? null,
    region_name: f.region_name ?? null,
    revenue_usd: f.revenue_usd ?? null,
    size_category: f.size_category ?? null,
  };
}

export function MapShell({
  initialBounds = CENTRAL_ASIA_BOUNDS,
  companies,
  regionsGeoJson = null,
  onCompanyClick,
  onRegionClick,
  className,
  compact = false,
}: MapShellProps): JSX.Element {
  const { t, i18n } = useTranslation();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const clusterRef = useRef<Supercluster<ClusterProperties, ClusterProperties> | null>(null);
  // Timestamp of the most recent region pick, used to suppress the map's own
  // background `click` (which fires right after deck.gl's pick handler) so the
  // popup we just opened is not immediately dismissed.
  const lastRegionClickRef = useRef(0);

  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [mapReady, setMapReady] = useState(false);
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [cursorXY, setCursorXY] = useState<{ x: number; y: number } | null>(null);
  const [regionPopup, setRegionPopup] = useState<RegionPopupState | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  const viewState = useMapStore((s) => s.viewState);
  const setViewState = useMapStore((s) => s.setViewState);
  const enabledLayers = useMapStore((s) => s.enabledLayers);
  const selectedCompanyId = useMapStore((s) => s.selectedCompanyId);
  const selectCompany = useMapStore((s) => s.selectCompany);
  const selectRegion = useMapStore((s) => s.selectRegion);
  const hoveredRegionKato = useMapStore((s) => s.hoveredRegionKato);
  const setHoveredRegion = useMapStore((s) => s.setHoveredRegion);
  const selectedRegionKato = useMapStore((s) => s.selectedRegionKato);
  const setRegionDrawerOpen = useMapStore((s) => s.setRegionDrawerOpen);
  const metric = useMapStore((s) => s.metric);

  // Directory drill-down filters — set by widgets such as the industry
  // heatmap. Flowed straight through to the geo query so the map respects
  // the active (industry, region) slice.
  const filterIndustryCode = useDirectoryFilterStore((s) => s.industry_code);
  const filterRegionKato = useDirectoryFilterStore((s) => s.region_kato);

  // Map-scoped multi-industry filter, toggled via the legend. Empty = show all.
  // Applied client-side to the resolved company features so it composes with
  // the server-side (industry_code, region_kato) directory drill-down above.
  const selectedIndustries = useMapFilterStore((s) => s.selectedIndustries);

  // Hook-driven fetch — skipped when caller supplies `companies` prop directly.
  const useRemote = companies === undefined;
  const geoQuery = useCompaniesGeo({
    bbox,
    zoom: viewState.zoom,
    filters: {
      industry_code: filterIndustryCode,
      region_kato: filterRegionKato,
    },
    // Fetch when either the point/cluster layer OR the heatmap needs the data,
    // so toggling Companies off but Heatmap on still renders density.
    enabled: useRemote && (enabledLayers.companies || enabledLayers.heatmap),
  });

  // Region geojson + metric distribution.
  const { data: regionsFromApi } = useRegionsGeo();
  const { data: distribution } = useRegionDistribution({
    metric,
    country: 'KZ',
    enabled: enabledLayers.regions,
  });

  const effectiveRegions = (regionsGeoJson ?? regionsFromApi) as
    | GeoJSON.FeatureCollection
    | null
    | undefined;

  const metricValues = useMemo(() => {
    const m = new Map<string, number>();
    if (distribution?.items) {
      for (const row of distribution.items) m.set(row.kato_code, row.value);
    }
    return m;
  }, [distribution]);

  // Resolved company feature list (either remote or prop-supplied).
  const allFeatures = useMemo<CompanyFeatureProps[]>(() => {
    if (!useRemote) {
      return (companies ?? []).map(toCompanyFeature);
    }
    const fc = geoQuery.data;
    if (!fc?.features) return [];
    return fc.features.map((f) => fromGeoFeature(f.properties));
  }, [useRemote, companies, geoQuery.data]);

  // Apply the legend's multi-industry filter (by ОКЭД section letter). When no
  // industry is selected the full set passes through untouched.
  const features = useMemo<CompanyFeatureProps[]>(() => {
    if (selectedIndustries.size === 0) return allFeatures;
    return allFeatures.filter((f) =>
      selectedIndustries.has(sectionFromCode(f.industry_code)),
    );
  }, [allFeatures, selectedIndustries]);

  // Initialize MapLibre once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: resolveStyle(theme) as any,
      bounds: initialBounds,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);

    const syncBBox = (): void => {
      const b = map.getBounds();
      setBBox({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    };

    map.on('load', () => {
      setMapReady(true);
      // First-paint resize: the container's height may have been 0 at the
      // moment of `new Map()` (Panel mid-layout). Resize once style is loaded
      // so MapLibre picks up the real bounding box.
      map.resize();
      syncBBox();
    });

    // Observe container resizes (panel drag, viewport changes) and keep the
    // map canvas in sync — otherwise the gl context stays frozen at init size.
    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch { /* map may already be removed */ }
      const el = containerRef.current;
      if (el) setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    if (containerRef.current) {
      ro.observe(containerRef.current);
      setContainerSize({
        w: containerRef.current.clientWidth,
        h: containerRef.current.clientHeight,
      });
    }

    // Belt-and-braces: trigger a resize on the next animation frame too,
    // covering the case where ResizeObserver fires before the layout settles.
    requestAnimationFrame(() => {
      try { map.resize(); } catch { /* noop */ }
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      setViewState({
        longitude: c.lng,
        latitude: c.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
      syncBBox();
    });

    // Background click (anywhere not consumed by a deck.gl pick) dismisses the
    // region popup. A region pick records `lastRegionClickRef` first; if that
    // happened within the same tick we keep the freshly-opened popup.
    map.on('click', () => {
      if (Date.now() - lastRegionClickRef.current > 50) {
        setRegionPopup(null);
      }
    });

    map.on('mousemove', (e) => {
      setCursorXY({ x: e.point.x, y: e.point.y });
    });
    map.on('mouseout', () => {
      setCursorXY(null);
      setHoveredRegion(null);
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      ro.disconnect();
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      setMapReady(false);
    };
    // initialBounds intentionally consumed only on first init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme switch -> swap style.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.setStyle(resolveStyle(theme) as any);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('theme', theme);
    }
  }, [theme]);

  // Build / refresh supercluster index whenever the feature set changes.
  useEffect(() => {
    const index = new Supercluster<ClusterProperties, ClusterProperties>({
      radius: 60,
      maxZoom: 14,
    });
    index.load(
      features.map((f) => ({
        type: 'Feature' as const,
        properties: { cluster: false, companyId: f.id, feature: f },
        geometry: { type: 'Point' as const, coordinates: [f.longitude, f.latitude] },
      })),
    );
    clusterRef.current = index;
  }, [features]);

  // Cluster-or-point selection based on current zoom + bbox.
  const { clusters, singles } = useMemo<{
    clusters: ClusterFeatureProps[];
    singles: CompanyFeatureProps[];
  }>(() => {
    const index = clusterRef.current;
    const useClusters = viewState.zoom < CLUSTER_CUTOFF_ZOOM;
    if (!index || !bbox || !useClusters) {
      return { clusters: [], singles: features };
    }
    const z = Math.floor(viewState.zoom);
    const raw = index.getClusters(
      [bbox.west, bbox.south, bbox.east, bbox.north],
      z,
    );
    const cs: ClusterFeatureProps[] = [];
    const ss: CompanyFeatureProps[] = [];
    for (const item of raw) {
      const [lng, lat] = item.geometry.coordinates as [number, number];
      const props = item.properties;
      if (props.cluster && typeof props.cluster_id === 'number') {
        cs.push({
          cluster_id: props.cluster_id,
          point_count: props.point_count ?? 0,
          point_count_abbreviated: props.point_count_abbreviated,
          longitude: lng,
          latitude: lat,
        });
      } else if (props.feature) {
        ss.push(props.feature);
      }
    }
    return { clusters: cs, singles: ss };
  }, [features, viewState.zoom, bbox]);

  const handleClusterClick = useCallback(
    (clusterId: number, lng: number, lat: number): void => {
      const index = clusterRef.current;
      const map = mapRef.current;
      if (!index || !map) return;
      let expansionZoom: number;
      try {
        expansionZoom = index.getClusterExpansionZoom(clusterId);
      } catch {
        expansionZoom = Math.min(14, map.getZoom() + 2);
      }
      map.easeTo({
        center: [lng, lat],
        zoom: Math.max(expansionZoom, map.getZoom() + 1),
        duration: 400,
      });
    },
    [],
  );

  const handleCompanyHover = useCallback(
    (feature: CompanyFeatureProps | null, x: number, y: number): void => {
      if (!feature) {
        setHover(null);
        return;
      }
      setHover({ x, y, feature });
    },
    [],
  );

  const handleCompanyClickInternal = useCallback(
    (id: string): void => {
      selectCompany(id);
      onCompanyClick?.(id);
    },
    [selectCompany, onCompanyClick],
  );

  // Region click -> select region + show the compact anchored popup at the
  // click pixel. The full RegionDrawer no longer auto-opens; it is opened only
  // via the popup's "Подробнее" action (regionDrawerOpen flag).
  const handleRegionClickInternal = useCallback(
    (kato: string, x: number, y: number): void => {
      lastRegionClickRef.current = Date.now();
      selectRegion(kato); // also resets regionDrawerOpen=false in the store
      setRegionPopup({ kato, x, y });
      onRegionClick?.(kato);
    },
    [selectRegion, onRegionClick],
  );

  // Double-click a region → fit the map to its polygon bounds. Cheap: bounds
  // computed straight from the geojson geometry, no extra deps.
  const handleRegionDoubleClick = useCallback(
    (feature: GeoJSON.Feature): void => {
      const map = mapRef.current;
      if (!map) return;
      const bounds = geometryBounds(feature.geometry);
      if (!bounds) return;
      lastRegionClickRef.current = Date.now();
      setRegionPopup(null);
      map.fitBounds(bounds as LngLatBoundsLike, { padding: 48, duration: 600 });
    },
    [],
  );

  const dismissRegionPopup = useCallback((): void => {
    setRegionPopup(null);
  }, []);

  const handleOpenRegionDetails = useCallback((): void => {
    setRegionDrawerOpen(true);
    setRegionPopup(null);
  }, [setRegionDrawerOpen]);

  // Rebuild deck.gl layers whenever data / layer toggles / view change.
  useEffect(() => {
    const overlay = overlayRef.current;
    const map = mapRef.current;
    if (!overlay || !map || !mapReady) return;

    const layers: Layer[] = [];

    // Regions choropleth (UNDER companies). Prefer API-driven choropleth
    // when metric values are available; fall back to a flat GeoJsonLayer.
    if (enabledLayers.regions && effectiveRegions) {
      if (metricValues.size > 0) {
        layers.push(
          createRegionChoroplethLayer({
            geojson: effectiveRegions as unknown as Parameters<
              typeof createRegionChoroplethLayer
            >[0]['geojson'],
            metricValues,
            metric,
            theme,
            hoveredKato: hoveredRegionKato,
            selectedKato: selectedRegionKato,
            onRegionClick: (kato, _feature, pixel) => {
              handleRegionClickInternal(kato, pixel.x, pixel.y);
            },
            onRegionHover: (kato) => {
              setHoveredRegion(kato);
            },
            onRegionDoubleClick: (feature) => {
              handleRegionDoubleClick(feature as GeoJSON.Feature);
            },
          }) as unknown as Layer,
        );
      } else {
        layers.push(
          new GeoJsonLayer({
            id: 'kz-regions',
            data: effectiveRegions,
            pickable: true,
            stroked: true,
            filled: true,
            autoHighlight: true,
            highlightColor: [99, 102, 241, 60],
            // Subtle fill so company markers stay visible on top.
            getFillColor: [99, 102, 241, 22],
            getLineColor: (f) => {
              const props = (f as GeoJSON.Feature | undefined)?.properties as
                | Record<string, unknown>
                | undefined;
              const kato = (props?.kato2 ?? props?.kato_code ?? props?.KATO ?? props?.kato) as
                | string
                | undefined;
              return kato && kato === hoveredRegionKato
                ? [99, 102, 241, 255]
                : [99, 102, 241, 160];
            },
            lineWidthMinPixels: 1,
            updateTriggers: { getLineColor: [hoveredRegionKato] },
            onClick: (info: PickingInfo) => {
              const props = (info.object as GeoJSON.Feature | undefined)?.properties as
                | Record<string, unknown>
                | undefined;
              const kato = (props?.kato2 ?? props?.kato_code ?? props?.KATO ?? props?.kato) as
                | string
                | undefined;
              if (kato) {
                handleRegionClickInternal(kato, info.x, info.y);
              }
            },
            onHover: (info: PickingInfo) => {
              const props = (info.object as GeoJSON.Feature | undefined)?.properties as
                | Record<string, unknown>
                | undefined;
              const kato = (props?.kato2 ?? props?.kato_code ?? props?.KATO ?? props?.kato) as
                | string
                | undefined;
              setHoveredRegion(kato ?? null);
            },
          }),
        );
      }
    }

    // Heatmap density layer — density of companies weighted by revenue. Drawn
    // UNDER the discrete company/cluster markers when both are enabled. Honest:
    // uses the same real company feature set the markers come from.
    if (enabledLayers.heatmap && features.length > 0) {
      layers.push(
        new HeatmapLayer<CompanyFeatureProps>({
          id: 'companies-heatmap',
          data: features,
          getPosition: (d) => [d.longitude, d.latitude],
          getWeight: (d) =>
            d.revenue_usd && d.revenue_usd > 0 ? Math.log10(d.revenue_usd + 10) : 1,
          radiusPixels: 48,
          intensity: 1,
          threshold: 0.05,
          aggregation: 'SUM',
        }) as unknown as Layer,
      );
    }

    if (enabledLayers.companies) {
      if (clusters.length > 0) {
        for (const l of createClusterLayers({
          data: clusters,
          theme,
          onClusterClick: handleClusterClick,
        })) {
          layers.push(l);
        }
      }
      if (singles.length > 0) {
        layers.push(
          createCompanyLayer({
            data: singles,
            theme,
            highlightedId: selectedCompanyId,
            onCompanyClick: handleCompanyClickInternal,
            onCompanyHover: handleCompanyHover,
          }),
        );
      }
    }

    overlay.setProps({ layers });

    // Cursor feedback: pointer when hovering pickable layers (company markers
    // or region polygons).
    const canvas = map.getCanvas();
    canvas.style.cursor = hover || hoveredRegionKato ? 'pointer' : '';
  }, [
    mapReady,
    clusters,
    singles,
    features,
    effectiveRegions,
    enabledLayers,
    metric,
    metricValues,
    theme,
    selectedCompanyId,
    hover,
    hoveredRegionKato,
    selectedRegionKato,
    handleRegionClickInternal,
    handleRegionDoubleClick,
    setHoveredRegion,
    handleClusterClick,
    handleCompanyClickInternal,
    handleCompanyHover,
  ]);

  const handleResetView = useCallback(() => {
    mapRef.current?.fitBounds(initialBounds, { padding: 24, duration: 600 });
  }, [initialBounds]);

  const handleZoom = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: 250 });
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((th) => (th === 'light' ? 'dark' : 'light'));
  }, []);

  // Resolve hovered region's display name from the geojson properties.
  const hoveredRegionName = useMemo(() => {
    if (!hoveredRegionKato || !effectiveRegions) return '';
    const f = effectiveRegions.features.find((feat) => {
      const props = feat.properties as RegionFeatureProperties | undefined;
      // Match on the same key the choropleth joins on (2-digit `kato2`),
      // falling back to the full `kato_code`.
      return (props?.kato2 ?? props?.kato_code) === hoveredRegionKato;
    });
    return resolveRegionName(
      f?.properties as RegionFeatureProperties | undefined,
      i18n.language,
    );
  }, [hoveredRegionKato, effectiveRegions, i18n.language]);

  // Resolve the popup region's display name from the geojson properties.
  const popupRegionName = useMemo(() => {
    if (!regionPopup || !effectiveRegions) return regionPopup?.kato ?? '';
    const f = effectiveRegions.features.find((feat) => {
      const props = feat.properties as RegionFeatureProperties | undefined;
      return (props?.kato2 ?? props?.kato_code) === regionPopup.kato;
    });
    return (
      resolveRegionName(
        f?.properties as RegionFeatureProperties | undefined,
        i18n.language,
      ) || regionPopup.kato
    );
  }, [regionPopup, effectiveRegions, i18n.language]);

  const tooltip = hover ? (
    <div
      className="pointer-events-none absolute z-20 max-w-xs rounded-md border border-neutral-200 bg-white/95 px-2.5 py-1.5 text-xs text-neutral-900 shadow-md backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-50"
      style={{ left: hover.x + 12, top: hover.y + 12 }}
      role="tooltip"
    >
      <div className="font-semibold leading-tight">{hover.feature.name}</div>
      <div className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
        <span>
          {t('map.tooltip.industry')}:{' '}
          {hover.feature.industry_label ?? industryLabel(hover.feature.industry_code)}
        </span>
        {hover.feature.region_name ? (
          <>
            {' • '}
            <span>
              {t('map.tooltip.region')}: {hover.feature.region_name}
            </span>
          </>
        ) : null}
      </div>
      {typeof hover.feature.revenue_usd === 'number' ? (
        <div className="mt-0.5 text-[11px] text-neutral-700 dark:text-neutral-300">
          {t('map.tooltip.revenue')}: {formatCurrency(hover.feature.revenue_usd, i18n.language)}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      className={['relative w-full h-full', className].filter(Boolean).join(' ')}
      style={{ minHeight: 420 }}
    >
      <div
        ref={containerRef}
        style={{
          // MapLibre rewrites this element's classes, so use inline styles
          // it won't override. Without explicit width/height the gl canvas
          // stays at 0px and tiles never paint.
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          background: theme === 'dark' ? '#0e1116' : '#e8e8e8',
        }}
      />
      {!compact && (
        <div className="absolute top-3 left-3 z-10">
          <MapControls
            theme={theme}
            onZoomIn={() => handleZoom(1)}
            onZoomOut={() => handleZoom(-1)}
            onResetView={handleResetView}
            onToggleTheme={handleToggleTheme}
          />
        </div>
      )}
      {!compact && enabledLayers.regions && (
        <div className="absolute top-3 right-14 z-10">
          <MetricSelector />
        </div>
      )}
      {!compact && (
        <div className="absolute bottom-3 right-3 z-10 w-[260px]">
          <MapLegend theme={theme} />
        </div>
      )}
      {/* Market-insights overlay (AIStart360 «Чек-лист 50 вопросов»). Docked
          bottom-left, offset up (bottom-8) so it clears the MapLibre scale bar
          that sits in the bottom-left corner. */}
      {!compact && (
        <div className="absolute bottom-8 left-3 z-10">
          <InsightsOverlay />
        </div>
      )}
      {tooltip}
      {hoveredRegionKato && cursorXY && hoveredRegionKato !== selectedRegionKato && (
        <RegionTooltip
          katoCode={hoveredRegionKato}
          regionName={hoveredRegionName || hoveredRegionKato}
          x={cursorXY.x}
          y={cursorXY.y}
        />
      )}
      {regionPopup && (
        <RegionMarketPopup
          katoCode={regionPopup.kato}
          regionName={popupRegionName}
          x={regionPopup.x}
          y={regionPopup.y}
          containerWidth={containerSize.w}
          containerHeight={containerSize.h}
          onClose={dismissRegionPopup}
          onOpenDetails={handleOpenRegionDetails}
        />
      )}
      <RegionDrawer />
      {useRemote && geoQuery.isLoading && (
        <div className="absolute top-3 right-3 z-10 rounded-md bg-white/90 px-3 py-1 text-xs shadow dark:bg-neutral-900/80">
          Loading companies…
        </div>
      )}
      {useRemote && geoQuery.isError && (
        <div
          role="alert"
          className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 shadow dark:bg-red-950 dark:text-red-200"
        >
          <span>Failed to load companies: {geoQuery.error.message}</span>
          <button
            type="button"
            className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900"
            onClick={() => void geoQuery.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {/* viewState consumed so hooks aren't flagged as unused; useful for
          parent panels listening to map position changes. */}
      <span className="sr-only" data-zoom={viewState.zoom.toFixed(2)} />
    </div>
  );
}

export default MapShell;
