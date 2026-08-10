import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native shell for the AIStart360 cabinet (Android + iOS).
 *
 * The portal is a Next.js App Router app with server components, API routes and
 * cookie-based Supabase auth, so it cannot be statically exported into the
 * bundle — `output: 'export'` would drop every /api route and the whole SSR
 * layer. The shell therefore loads the hosted portal in the WebView and adds
 * the native pieces around it: splash, status bar, hardware back button, push
 * registration and deep links.
 *
 * `webDir` still has to exist: it holds the offline fallback that shows when
 * the device has no connection, instead of the WebView's blank error page.
 *
 * Point the shell at another origin (staging, a local machine on the LAN) with
 * CAP_SERVER_URL — useful for testing a branch before it is deployed.
 */
const serverUrl = process.env.CAP_SERVER_URL ?? 'https://aistart360.vercel.app'

const config: CapacitorConfig = {
  appId: 'kz.aistart360.app',
  appName: 'AIStart360',
  webDir: 'mobile/www',

  server: {
    url: serverUrl,
    // Cookies set by Supabase are Secure; an http:// scheme would make the
    // WebView drop them and every session would die on the first navigation.
    androidScheme: 'https',
    iosScheme: 'https',
    // Anything outside the portal (payment providers, OAuth) opens in the
    // system browser rather than inside the app shell.
    allowNavigation: ['aistart360.vercel.app', '*.supabase.co'],
  },

  android: {
    // Long OpenRouter calls must not be killed by a mixed-content downgrade.
    allowMixedContent: false,
    backgroundColor: '#0A0B0F',
  },

  ios: {
    contentInset: 'never',
    backgroundColor: '#0A0B0F',
    // The cabinet already handles its own pull-to-refresh states; the native
    // bounce on top of that reads as a broken scroll.
    scrollEnabled: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0A0B0F',
      androidSplashResourceName: 'splash',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0A0B0F',
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
