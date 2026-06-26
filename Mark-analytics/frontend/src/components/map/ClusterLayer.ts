/**
 * deck.gl factory for cluster bubbles produced by supercluster.
 *
 * Renders a filled circle per cluster with the abbreviated point count
 * stacked on top via a TextLayer. On click, the host map zooms to the
 * expansion zoom returned by the supercluster index.
 *
 * Kept framework-free so it can be recomposed inside the `MapShell`
 * effect that rebuilds layers on every viewport / data change.
 */
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';

import type { RGBA, Theme } from '../../lib/colorScheme';
import { formatCompactCount } from '../../lib/format';

export interface ClusterFeatureProps {
  /** supercluster-assigned numeric id (when feature is a cluster). */
  cluster_id: number;
  /** Number of original points contained in this cluster. */
  point_count: number;
  /** Pre-abbreviated count from supercluster (e.g. "1.2k"). */
  point_count_abbreviated?: number | string;
  /** Cluster centroid. */
  longitude: number;
  latitude: number;
}

export interface CreateClusterLayerOptions {
  data: ClusterFeatureProps[];
  onClusterClick?: (clusterId: number, longitude: number, latitude: number) => void;
  theme?: Theme;
  /** Optional id prefix; produces `${idPrefix}-bubbles` + `${idPrefix}-labels`. */
  idPrefix?: string;
}

const BUBBLE_LIGHT: RGBA = [79, 70, 229, 210]; // indigo-600
const BUBBLE_DARK: RGBA = [129, 140, 248, 220]; // indigo-400
const RING_LIGHT: RGBA = [255, 255, 255, 230];
const RING_DARK: RGBA = [15, 23, 42, 230];
const TEXT_LIGHT: RGBA = [255, 255, 255, 240];
const TEXT_DARK: RGBA = [15, 23, 42, 240];

/**
 * Cluster radius in pixels scaled by point count (log-ish).
 * 10 pts ≈ 14px, 100 ≈ 20px, 1000 ≈ 28px, 10k ≈ 36px.
 */
function clusterRadius(count: number): number {
  if (count <= 1) return 8;
  const r = 10 + Math.log10(count) * 8;
  return Math.min(40, Math.max(12, r));
}

export function createClusterLayers(
  options: CreateClusterLayerOptions,
): Layer[] {
  const { data, onClusterClick, theme = 'light', idPrefix = 'companies-clusters' } = options;

  const bubbleColor = theme === 'dark' ? BUBBLE_DARK : BUBBLE_LIGHT;
  const ringColor = theme === 'dark' ? RING_DARK : RING_LIGHT;
  const textColor = theme === 'dark' ? TEXT_DARK : TEXT_LIGHT;

  const bubbles = new ScatterplotLayer<ClusterFeatureProps>({
    id: `${idPrefix}-bubbles`,
    data,
    pickable: true,
    stroked: true,
    filled: true,
    radiusUnits: 'pixels',
    lineWidthUnits: 'pixels',
    radiusMinPixels: 8,
    radiusMaxPixels: 44,
    lineWidthMinPixels: 1.5,
    getPosition: (d: ClusterFeatureProps): [number, number] => [d.longitude, d.latitude],
    getRadius: (d: ClusterFeatureProps): number => clusterRadius(d.point_count),
    getFillColor: (): RGBA => bubbleColor,
    getLineColor: (): RGBA => ringColor,
    updateTriggers: {
      getFillColor: [theme],
      getLineColor: [theme],
    },
    onClick: (info: PickingInfo): boolean => {
      const obj = info.object as ClusterFeatureProps | undefined;
      if (obj && typeof obj.cluster_id === 'number') {
        onClusterClick?.(obj.cluster_id, obj.longitude, obj.latitude);
        return true;
      }
      return false;
    },
  });

  const labels = new TextLayer<ClusterFeatureProps>({
    id: `${idPrefix}-labels`,
    data,
    pickable: false,
    sizeUnits: 'pixels',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontWeight: 600,
    getPosition: (d: ClusterFeatureProps): [number, number] => [d.longitude, d.latitude],
    getText: (d: ClusterFeatureProps): string =>
      typeof d.point_count_abbreviated === 'string' || typeof d.point_count_abbreviated === 'number'
        ? String(d.point_count_abbreviated)
        : formatCompactCount(d.point_count),
    getSize: (d: ClusterFeatureProps): number => {
      const r = clusterRadius(d.point_count);
      return Math.max(10, Math.min(16, Math.round(r * 0.7)));
    },
    getColor: (): RGBA => textColor,
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    updateTriggers: {
      getColor: [theme],
    },
  });

  return [bubbles, labels];
}

export default createClusterLayers;
