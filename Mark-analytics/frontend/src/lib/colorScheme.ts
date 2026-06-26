/**
 * Centralized color palette for industry / NACE / OKED codes.
 *
 * The KZ ОКЭД classifier is aligned with NACE Rev. 2 at the top (letter)
 * level. We map letters A..U to fixed Tailwind palette hues, with both
 * a light-mode and dark-mode variant tuned for legibility on map tiles.
 */

export type RGBA = [number, number, number, number];

export type Theme = 'light' | 'dark';

interface IndustryColor {
  light: RGBA;
  dark: RGBA;
  label: string;
}

/**
 * NACE / ОКЭД section letters with semantically chosen colors.
 *
 * Colors selected from Tailwind palette (500/400 shades) for contrast on
 * both light and dark base maps. Alpha kept at 220 (≈86%) so points
 * remain readable above region fills.
 */
const INDUSTRY_PALETTE: Readonly<Record<string, IndustryColor>> = {
  // A — Agriculture, forestry, fishing → green
  A: { light: [34, 197, 94, 220], dark: [74, 222, 128, 230], label: 'Agriculture' },
  // B — Mining & quarrying → amber
  B: { light: [217, 119, 6, 220], dark: [251, 191, 36, 230], label: 'Mining' },
  // C — Manufacturing → orange
  C: { light: [234, 88, 12, 220], dark: [251, 146, 60, 230], label: 'Manufacturing' },
  // D — Electricity, gas, steam → yellow
  D: { light: [202, 138, 4, 220], dark: [250, 204, 21, 230], label: 'Energy' },
  // E — Water supply, waste → teal
  E: { light: [13, 148, 136, 220], dark: [45, 212, 191, 230], label: 'Utilities' },
  // F — Construction → stone / slate
  F: { light: [120, 113, 108, 220], dark: [168, 162, 158, 230], label: 'Construction' },
  // G — Wholesale & retail trade → blue
  G: { light: [37, 99, 235, 220], dark: [96, 165, 250, 230], label: 'Trade' },
  // H — Transport & storage → sky
  H: { light: [2, 132, 199, 220], dark: [56, 189, 248, 230], label: 'Transport' },
  // I — Accommodation & food service → rose
  I: { light: [225, 29, 72, 220], dark: [251, 113, 133, 230], label: 'Hospitality' },
  // J — Information & communication → indigo
  J: { light: [79, 70, 229, 220], dark: [129, 140, 248, 230], label: 'ICT' },
  // K — Financial & insurance → emerald
  K: { light: [5, 150, 105, 220], dark: [52, 211, 153, 230], label: 'Finance' },
  // L — Real estate → fuchsia
  L: { light: [192, 38, 211, 220], dark: [232, 121, 249, 230], label: 'Real estate' },
  // M — Professional, scientific, technical → violet
  M: { light: [124, 58, 237, 220], dark: [167, 139, 250, 230], label: 'Professional' },
  // N — Administrative & support → cyan
  N: { light: [8, 145, 178, 220], dark: [34, 211, 238, 230], label: 'Admin services' },
  // O — Public administration → zinc
  O: { light: [82, 82, 91, 220], dark: [161, 161, 170, 230], label: 'Public admin' },
  // P — Education → pink
  P: { light: [219, 39, 119, 220], dark: [244, 114, 182, 230], label: 'Education' },
  // Q — Health & social work → red
  Q: { light: [220, 38, 38, 220], dark: [248, 113, 113, 230], label: 'Healthcare' },
  // R — Arts, entertainment → purple
  R: { light: [147, 51, 234, 220], dark: [192, 132, 252, 230], label: 'Arts' },
  // S — Other services → lime
  S: { light: [101, 163, 13, 220], dark: [163, 230, 53, 230], label: 'Other services' },
  // T — Household activities → neutral
  T: { light: [115, 115, 115, 220], dark: [212, 212, 212, 230], label: 'Household' },
  // U — Extraterritorial orgs → slate
  U: { light: [71, 85, 105, 220], dark: [148, 163, 184, 230], label: 'Extraterritorial' },
};

const FALLBACK: IndustryColor = {
  light: [99, 102, 241, 220],
  dark: [129, 140, 248, 230],
  label: 'Other',
};

/**
 * Map an ОКЭД / NACE code (any length) to its section letter.
 * Accepts: "A", "A01", "01.10", "01", numeric strings, etc.
 *
 * If the input starts with a letter we use it directly. Otherwise we
 * fall back to numeric ranges per NACE Rev. 2 division mapping.
 */
export function sectionFromCode(code: string | null | undefined): string {
  if (!code) return '?';
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return '?';

  const firstChar = trimmed.charAt(0);
  if (firstChar >= 'A' && firstChar <= 'Z') return firstChar;

  const division = parseInt(trimmed.slice(0, 2), 10);
  if (!Number.isFinite(division)) return '?';

  if (division >= 1 && division <= 3) return 'A';
  if (division >= 5 && division <= 9) return 'B';
  if (division >= 10 && division <= 33) return 'C';
  if (division === 35) return 'D';
  if (division >= 36 && division <= 39) return 'E';
  if (division >= 41 && division <= 43) return 'F';
  if (division >= 45 && division <= 47) return 'G';
  if (division >= 49 && division <= 53) return 'H';
  if (division >= 55 && division <= 56) return 'I';
  if (division >= 58 && division <= 63) return 'J';
  if (division >= 64 && division <= 66) return 'K';
  if (division === 68) return 'L';
  if (division >= 69 && division <= 75) return 'M';
  if (division >= 77 && division <= 82) return 'N';
  if (division === 84) return 'O';
  if (division === 85) return 'P';
  if (division >= 86 && division <= 88) return 'Q';
  if (division >= 90 && division <= 93) return 'R';
  if (division >= 94 && division <= 96) return 'S';
  if (division >= 97 && division <= 98) return 'T';
  if (division === 99) return 'U';
  return '?';
}

/**
 * Resolve RGBA tuple for a given industry code under the active theme.
 */
export function industryColor(
  code: string | null | undefined,
  theme: Theme = 'light',
): RGBA {
  const section = sectionFromCode(code);
  const entry = INDUSTRY_PALETTE[section] ?? FALLBACK;
  // Return a copy so callers can mutate alpha freely.
  const tuple = theme === 'dark' ? entry.dark : entry.light;
  return [tuple[0], tuple[1], tuple[2], tuple[3]];
}

/**
 * Hex string (`#rrggbb`) for HTML legend / badges.
 */
export function industryHex(
  code: string | null | undefined,
  theme: Theme = 'light',
): string {
  const [r, g, b] = industryColor(code, theme);
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Human label for a section letter; used by the map legend.
 */
export function industryLabel(code: string | null | undefined): string {
  const section = sectionFromCode(code);
  return INDUSTRY_PALETTE[section]?.label ?? FALLBACK.label;
}

export interface IndustryLegendEntry {
  section: string;
  label: string;
  hex: string;
}

/**
 * Ordered list of industry legend entries for the UI.
 * Sorted by section letter for stable display.
 */
export function industryLegend(theme: Theme = 'light'): IndustryLegendEntry[] {
  return Object.keys(INDUSTRY_PALETTE)
    .sort()
    .map((section) => ({
      section,
      label: INDUSTRY_PALETTE[section]?.label ?? FALLBACK.label,
      hex: industryHex(section, theme),
    }));
}

/**
 * Log-scaled point radius in pixels driven by revenue.
 *
 * Maps [0, 1B+] USD logarithmically to [minPx, maxPx].
 */
export function revenueRadius(
  revenueUsd: number | null | undefined,
  minPx: number = 4,
  maxPx: number = 12,
): number {
  if (!revenueUsd || !Number.isFinite(revenueUsd) || revenueUsd <= 0) {
    return minPx;
  }
  // log10(rev). 1 ($1) -> 0; 1M -> 6; 1B -> 9.
  const logRev = Math.log10(revenueUsd);
  // Map logRev in [3, 9] -> [0, 1] then clamp.
  const t = Math.min(1, Math.max(0, (logRev - 3) / 6));
  return minPx + t * (maxPx - minPx);
}
