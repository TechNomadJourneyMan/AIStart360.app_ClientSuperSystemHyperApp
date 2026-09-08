/**
 * lib/market/app-config.ts — sanity check for NEXT_PUBLIC_MARKET_APP_URL.
 *
 * The portal sends `frame-ancestors 'none'`, so pointing the Market embed at
 * the portal's own origin (E2E 2026-09: prod var was set to the portal's
 * *.vercel.app domain) or leaving the localhost default in production can
 * never render — the browser shows «refused to connect» while the fetch-based
 * availability probe still succeeds. Detect that up-front so the UI can show
 * an honest configuration card instead of a dead iframe.
 */
export function marketAppMisconfiguration(appUrl: string, portalOrigin: string): string | null {
  let target: URL
  try {
    target = new URL(appUrl)
  } catch {
    return `NEXT_PUBLIC_MARKET_APP_URL не является корректным URL: «${appUrl}».`
  }
  if (target.origin === portalOrigin) {
    return 'NEXT_PUBLIC_MARKET_APP_URL указывает на сам портал. Портал запрещает встраивание себя во фрейм (CSP frame-ancestors), поэтому карта и анализ ниши не могут загрузиться. Укажите адрес отдельно развёрнутого приложения Mark-analytics.'
  }
  const portalIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(portalOrigin)
  const targetIsLocal = /^(localhost|127\.0\.0\.1)$/.test(target.hostname)
  if (targetIsLocal && !portalIsLocal) {
    return 'NEXT_PUBLIC_MARKET_APP_URL не задан на сервере — используется локальный адрес разработки. Задайте адрес развёрнутого приложения Mark-analytics.'
  }
  return null
}
