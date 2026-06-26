/**
 * RegionChoropleth — deck.gl GeoJsonLayer factory for the KZ regions choropleth.
 *
 * This is a pure layer factory (no JSX) so MapShell can include it among the
 * deck.gl overlay layers alongside the company scatter / heatmap layers.
 */

import { GeoJsonLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';

import { riskScale, sequentialScale, type RGBA, type Theme } from '../../lib/colorScale';
import type {
  RegionFeatureCollection,
  RegionFeatureProperties,
} from '../../hooks/useRegions';
import type { RegionMetric } from '../../stores/map';

export type RegionPolygonFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  RegionFeatureProperties
>;

export interface RegionChoroplethOptions {
  id?: string;
  geojson: RegionFeatureCollection;
  metricValues: Map<string, number>;
  metric: RegionMetric;
  theme: Theme;
  hoveredKato?: string | null;
  selectedKato?: string | null;
  onRegionClick?: (
    katoCode: string,
    feature: RegionPolygonFeature,
    /** Click pixel position relative to the deck.gl canvas (info.x / info.y). */
    pixel: { x: number; y: number },
  ) => void;
  onRegionHover?: (katoCode: string | null, feature: RegionPolygonFeature | null) => void;
  /** Double-click a region (zoom-to-fit). Receives the picked feature. */
  onRegionDoubleClick?: (feature: RegionPolygonFeature) => void;
  visible?: boolean;
}

/** Max gap (ms) between two clicks on the same region to count as a dbl-click. */
const DOUBLE_CLICK_MS = 350;
// Module-level dbl-click tracking. The layer is recreated on every overlay
// rebuild, so per-instance closures would reset; module scope persists across
// rebuilds for the lifetime of the map.
let lastClickAt = 0;
let lastClickKato: string | null = null;

const HOVER_LINE: RGBA = [255, 255, 255, 220];
const SELECTED_LINE: RGBA = [99, 102, 241, 240]; // indigo-500
const DEFAULT_LINE_LIGHT: RGBA = [148, 163, 184, 160]; // slate-400
const DEFAULT_LINE_DARK: RGBA = [71, 85, 105, 200]; // slate-600

function extractKato(props: RegionFeatureProperties | undefined): string | null {
  if (!props) return null;
  // The region-distribution metric endpoint keys regions by the 2-digit
  // `kato2` (e.g. "75"), so prefer it for the choropleth join. Fall back to the
  // full 9-digit `kato_code` (and legacy KATO/kato spellings) when absent.
  const kato =
    props.kato2 ??
    props.kato_code ??
    (props as Record<string, unknown>).KATO ??
    (props as Record<string, unknown>).kato;
  return typeof kato === 'string' ? kato : null;
}

export function createRegionChoroplethLayer(
  opts: RegionChoroplethOptions,
): GeoJsonLayer<RegionFeatureProperties> {
  const {
    id = 'kz-regions-choropleth',
    geojson,
    metricValues,
    metric,
    theme,
    hoveredKato = null,
    selectedKato = null,
    onRegionClick,
    onRegionHover,
    onRegionDoubleClick,
    visible = true,
  } = opts;

  const values: number[] = [];
  for (const v of metricValues.values()) {
    if (typeof v === 'number' && isFinite(v)) values.push(v);
  }
  // Risk uses an absolute 0..100 red ramp; everything else gets the
  // log-scaled sequential ramp anchored to the data extent. The non-risk
  // fill is kept subtle so company markers stay clearly visible on top of
  // the real region map.
  const scale =
    metric === 'risk'
      ? riskScale(theme, { alpha: 200 })
      : sequentialScale(values, theme, { alpha: 90 });

  const defaultLine = theme === 'dark' ? DEFAULT_LINE_DARK : DEFAULT_LINE_LIGHT;

  return new GeoJsonLayer<RegionFeatureProperties>({
    id,
    data: geojson,
    visible,
    pickable: true,
    stroked: true,
    filled: true,
    extruded: false,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    // Trigger redraws when any of these inputs change.
    updateTriggers: {
      getFillColor: [metric, theme, metricValues],
      getLineColor: [hoveredKato, selectedKato, theme],
      getLineWidth: [hoveredKato, selectedKato],
    },
    getFillColor: (f) => {
      const kato = extractKato((f as RegionPolygonFeature).properties);
      const v = kato ? metricValues.get(kato) : undefined;
      return scale(v);
    },
    getLineColor: (f) => {
      const kato = extractKato((f as RegionPolygonFeature).properties);
      if (kato && kato === selectedKato) return SELECTED_LINE;
      if (kato && kato === hoveredKato) return HOVER_LINE;
      return defaultLine;
    },
    getLineWidth: (f) => {
      const kato = extractKato((f as RegionPolygonFeature).properties);
      if (kato && (kato === selectedKato || kato === hoveredKato)) return 2;
      return 0.75;
    },
    onClick: (info: PickingInfo) => {
      const feature = info.object as RegionPolygonFeature | undefined;
      const kato = extractKato(feature?.properties);
      if (!kato || !feature) return;
      // Manual double-click detection: deck.gl GeoJsonLayer has no dblclick
      // event, so we compare against the last region-click timestamp/kato.
      const now = Date.now();
      const isDouble =
        onRegionDoubleClick != null &&
        now - lastClickAt < DOUBLE_CLICK_MS &&
        lastClickKato === kato;
      lastClickAt = now;
      lastClickKato = kato;
      if (isDouble) {
        onRegionDoubleClick?.(feature);
        return;
      }
      onRegionClick?.(kato, feature, { x: info.x, y: info.y });
    },
    onHover: (info: PickingInfo) => {
      const feature = info.object as RegionPolygonFeature | undefined;
      const kato = extractKato(feature?.properties);
      if (onRegionHover) onRegionHover(kato, feature ?? null);
    },
  });
}

export default createRegionChoroplethLayer;
