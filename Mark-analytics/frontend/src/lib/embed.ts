/**
 * Embed-mode detection for the Mark-analytics SPA.
 *
 * When the AIStart360 portal embeds this SPA in an iframe it appends
 * `?embed=1` to the URL. In that mode the SPA must NOT render its own chrome
 * (logo, primary nav, sign-in button) — the portal renders the surrounding
 * tabs and supplies auth via a postMessage bridge.
 *
 * TanStack Router strips the `embed` search param on client-side navigation,
 * so the very first detection persists a flag in sessionStorage. Every
 * subsequent read (including after in-app navigation like clicking
 * "Подробнее") returns true for the rest of the browser session.
 */

const STORAGE_KEY = 'mk_embed';

/**
 * @returns true when the SPA is running embedded inside the portal iframe.
 *
 * Embed mode is active when either:
 *  - the current URL search string contains `embed=1`, or
 *  - sessionStorage `mk_embed` === '1' (persisted from a prior detection).
 *
 * On first detection via the URL we persist the sessionStorage flag so that
 * router navigations (which drop the search param) keep embed mode sticky.
 */
export function isEmbedMode(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Direct URL signal — authoritative, and persists for the session.
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === '1') {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // sessionStorage may be unavailable (privacy mode); URL signal still wins.
      }
      return true;
    }
  } catch {
    // Malformed search string — fall through to the persisted flag.
  }

  // 2. Persisted flag — survives client-side navigations that strip the param.
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
