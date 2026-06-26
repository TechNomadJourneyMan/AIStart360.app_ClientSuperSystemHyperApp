/**
 * deck.gl ScatterplotLayer factory for individual company points.
 *
 * Renders one dot per company, colored by industry section, sized
 * logarithmically by revenue. Used by `MapShell` only when the user is
 * zoomed in past the cluster cutoff (zoom >= 7) or the bbox contains
 * few enough points that clustering is unnecessary.
 *
 * The layer is intentionally framework-free (no React) so it can be
 * recreated cheaply on every overlay update.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';

import { industryColor, revenueRadius, type RGBA, type Theme } from '../../lib/colorScheme';

export interface CompanyFeatureProps {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  industry_code?: string | null;
  industry_label?: string | null;
  region_kato?: string | null;
  region_name?: string | null;
  revenue_usd?: number | null;
  size_category?: string | null;
}

export interface CreateCompanyLayerOptions {
  data: CompanyFeatureProps[];
  onCompanyClick?: (id: string) => void;
  onCompanyHover?: (feature: CompanyFeatureProps | null, x: number, y: number) => void;
  theme?: Theme;
  /** Layer id (must be unique within an overlay). */
  id?: string;
  /** Highlighted company id (renders a stronger outline). */
  highlightedId?: string | null;
}

const LIGHT_OUTLINE: RGBA = [255, 255, 255, 230];
const DARK_OUTLINE: RGBA = [15, 23, 42, 230];
const HIGHLIGHT_OUTLINE: RGBA = [250, 204, 21, 255];

export function createCompanyLayer(
  options: CreateCompanyLayerOptions,
): ScatterplotLayer<CompanyFeatureProps> {
  const {
    data,
    onCompanyClick,
    onCompanyHover,
    theme = 'light',
    id = 'companies-points',
    highlightedId = null,
  } = options;

  const outline = theme === 'dark' ? DARK_OUTLINE : LIGHT_OUTLINE;

  return new ScatterplotLayer<CompanyFeatureProps>({
    id,
    data,
    pickable: true,
    stroked: true,
    filled: true,
    radiusUnits: 'pixels',
    lineWidthUnits: 'pixels',
    radiusMinPixels: 3,
    radiusMaxPixels: 18,
    lineWidthMinPixels: 1,
    getPosition: (d: CompanyFeatureProps): [number, number] => [d.longitude, d.latitude],
    getRadius: (d: CompanyFeatureProps): number => revenueRadius(d.revenue_usd ?? 0, 4, 12),
    getFillColor: (d: CompanyFeatureProps): RGBA => industryColor(d.industry_code, theme),
    getLineColor: (d: CompanyFeatureProps): RGBA =>
      highlightedId && d.id === highlightedId ? HIGHLIGHT_OUTLINE : outline,
    getLineWidth: (d: CompanyFeatureProps): number =>
      highlightedId && d.id === highlightedId ? 2.5 : 1,
    updateTriggers: {
      getFillColor: [theme],
      getLineColor: [theme, highlightedId],
      getLineWidth: [highlightedId],
    },
    onClick: (info: PickingInfo): boolean => {
      const obj = info.object as CompanyFeatureProps | undefined;
      if (obj?.id) {
        onCompanyClick?.(obj.id);
        return true;
      }
      return false;
    },
    onHover: (info: PickingInfo): void => {
      if (!onCompanyHover) return;
      const obj = (info.object as CompanyFeatureProps | undefined) ?? null;
      onCompanyHover(obj, info.x, info.y);
    },
  });
}

export default createCompanyLayer;
