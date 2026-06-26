/**
 * Color scale helpers for choropleth layers.
 *
 * Uses d3-scale-chromatic interpolators when available, with a small built-in
 * fallback so this module can render without the runtime dep installed.
 *
 * All scale functions return RGBA tuples that deck.gl consumes directly via
 * `getFillColor`. We use log-scale on values to compress long-tail distributions
 * (region.count, region.revenue both follow ~power-law).
 */

import {
  interpolateYlOrRd,
  interpolateViridis,
  interpolateRdBu,
  interpolateReds,
} from 'd3-scale-chromatic';

export type RGBA = [number, number, number, number];
export type Theme = 'light' | 'dark';
export type ScaleFn = (value: number | null | undefined) => RGBA;

const EMPTY_LIGHT: RGBA = [229, 231, 235, 60]; // neutral-200
const EMPTY_DARK: RGBA = [55, 65, 81, 60]; // neutral-700

interface ScaleOptions {
  /** Opacity 0-255 applied to interpolator output. */
  alpha?: number;
  /** Color for null/undefined values. */
  emptyColor?: RGBA;
}

function parseInterpolatorColor(css: string): RGBA {
  // d3-scale-chromatic returns "rgb(r, g, b)" strings.
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return [127, 127, 127, 255];
  const parts = (m[1] ?? '').split(',').map((s) => parseFloat(s.trim()));
  const r = Math.round(parts[0] ?? 0);
  const g = Math.round(parts[1] ?? 0);
  const b = Math.round(parts[2] ?? 0);
  const a = parts[3] !== undefined ? Math.round(parts[3] * 255) : 255;
  return [r, g, b, a];
}

function logNormalize(v: number, min: number, max: number): number {
  // Map [min, max] -> [0, 1] in log space; clamp to [0, 1].
  if (!isFinite(v) || !isFinite(min) || !isFinite(max)) return 0;
  if (max <= min) return 0.5;
  const logMin = Math.log1p(Math.max(0, min));
  const logMax = Math.log1p(Math.max(0, max));
  const logV = Math.log1p(Math.max(0, v));
  const t = (logV - logMin) / (logMax - logMin);
  return Math.max(0, Math.min(1, t));
}

function minMax(values: number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min) || !isFinite(max)) {
    min = 0;
    max = 1;
  }
  return { min, max };
}

/**
 * Sequential log-scaled color ramp.
 * Light theme: YlOrRd (cool -> warm).
 * Dark theme: Viridis (high-contrast on dark bg).
 */
export function sequentialScale(
  values: number[],
  theme: Theme,
  options: ScaleOptions = {},
): ScaleFn {
  const { alpha = 180, emptyColor } = options;
  const empty = emptyColor ?? (theme === 'dark' ? EMPTY_DARK : EMPTY_LIGHT);
  const { min, max } = minMax(values);
  const interp = theme === 'dark' ? interpolateViridis : interpolateYlOrRd;

  return (value) => {
    if (value === null || value === undefined || !isFinite(value)) return empty;
    const t = logNormalize(value, min, max);
    const rgba = parseInterpolatorColor(interp(t));
    return [rgba[0], rgba[1], rgba[2], alpha];
  };
}

/**
 * Linear (non-log) red ramp for risk index 0..100.
 *
 * The risk score is already a normalised 0..100 composite — we do NOT want a
 * log compression on top of that. Empty (null) cells use the same neutral as
 * the sequential scale so they sit visually behind the rest of the choropleth.
 */
export function riskScale(theme: Theme, options: ScaleOptions = {}): ScaleFn {
  const { alpha = 200, emptyColor } = options;
  const empty = emptyColor ?? (theme === 'dark' ? EMPTY_DARK : EMPTY_LIGHT);

  return (value) => {
    if (value === null || value === undefined || !isFinite(value)) return empty;
    const t = Math.max(0, Math.min(1, value / 100));
    const rgba = parseInterpolatorColor(interpolateReds(t));
    return [rgba[0], rgba[1], rgba[2], alpha];
  };
}

/**
 * Diverging scale centered at zero. Use for metrics with positive/negative
 * deltas (e.g., yoy growth).
 */
export function divergingScale(
  values: number[],
  _theme: Theme,
  options: ScaleOptions = {},
): ScaleFn {
  const { alpha = 180, emptyColor } = options;
  const empty = emptyColor ?? (_theme === 'dark' ? EMPTY_DARK : EMPTY_LIGHT);
  // Symmetric extent around 0.
  let extent = 0;
  for (const v of values) {
    if (!isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > extent) extent = a;
  }
  if (extent === 0) extent = 1;

  return (value) => {
    if (value === null || value === undefined || !isFinite(value)) return empty;
    // Map [-extent, +extent] -> [0, 1]. RdBu goes red->white->blue, so flip
    // so that positive => warm.
    const t = 0.5 + (value / extent) * 0.5;
    const tt = 1 - Math.max(0, Math.min(1, t));
    const rgba = parseInterpolatorColor(interpolateRdBu(tt));
    return [rgba[0], rgba[1], rgba[2], alpha];
  };
}

export const __test = { logNormalize, minMax, parseInterpolatorColor };
