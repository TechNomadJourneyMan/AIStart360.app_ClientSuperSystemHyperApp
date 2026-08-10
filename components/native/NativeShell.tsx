'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Wires the native behaviours the WebView shell needs, and does nothing at all
 * in a normal browser.
 *
 * The Android/iOS apps are a Capacitor shell pointing at this same deployment,
 * so this component ships with the web app rather than with the shell — that is
 * the only place the portal's own router is reachable. Every Capacitor module
 * is imported dynamically: pulling them in statically would add the bridge to
 * every web visitor's bundle and break the server render.
 *
 * Roots that must keep working after this mounts:
 * - hardware Back on Android should walk the app's history, not close the app
 *   on the first press (the default when nothing handles the event);
 * - the splash must hide once React has painted, otherwise it sits over a ready
 *   screen for its full timeout;
 * - auth deep links (Supabase magic links, OAuth callbacks) arrive as
 *   appUrlOpen and have to be handed to the router instead of opening a second
 *   browser window outside the session.
 */
export default function NativeShell() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let disposed = false
    const cleanups: Array<() => void> = []

    async function wire() {
      const { Capacitor } = await import('@capacitor/core')
      if (!Capacitor.isNativePlatform() || disposed) return

      const [{ App }, { SplashScreen }, { StatusBar, Style }] = await Promise.all([
        import('@capacitor/app'),
        import('@capacitor/splash-screen'),
        import('@capacitor/status-bar'),
      ])
      if (disposed) return

      // The cabinet is dark-only; a light status bar renders invisible on it.
      await StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: '#0A0B0F' }).catch(() => {})
      }
      await SplashScreen.hide().catch(() => {})

      const backHandle = await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) router.back()
        else App.exitApp()
      })
      cleanups.push(() => void backHandle.remove())

      const urlHandle = await App.addListener('appUrlOpen', ({ url }) => {
        try {
          const target = new URL(url)
          // Keep in-app: strip the origin so the router handles it and the
          // Supabase session cookie stays attached.
          router.push(`${target.pathname}${target.search}${target.hash}`)
        } catch {
          // A malformed deep link is not worth crashing the shell over.
        }
      })
      cleanups.push(() => void urlHandle.remove())
    }

    void wire()

    return () => {
      disposed = true
      cleanups.forEach((fn) => fn())
    }
  }, [router])

  // Route changes repaint the whole shell on native; make sure a splash left
  // over from a cold start never survives the first navigation.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { Capacitor } = await import('@capacitor/core')
      if (cancelled || !Capacitor.isNativePlatform()) return
      const { SplashScreen } = await import('@capacitor/splash-screen')
      await SplashScreen.hide().catch(() => {})
    })()
    return () => {
      cancelled = true
    }
  }, [pathname])

  return null
}
