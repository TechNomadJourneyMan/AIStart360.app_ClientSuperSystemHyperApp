import { defineConfig, devices } from '@playwright/test'

// GIGA panel specs (tests/e2e/giga-*.spec.ts) sign in through the test-only
// E2E auth seam (lib/admin/e2e-auth-seam-edge.ts): they seed a super_admin in
// E2E_DATABASE_URL and send a cookie signed with E2E_AUTH_SEAM_SECRET (≥32
// chars). The dev server started below inherits both from this environment;
// the seam is inert in production builds. See the header of each spec.

const testPort = process.env.PLAYWRIGHT_PORT ?? '3100'
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL
const baseURL = externalBaseURL ?? `http://127.0.0.1:${testPort}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './artifacts/journey/test-results',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `JOURNEY_FORCE_DEMO=1 npm run dev -- --hostname 127.0.0.1 --port ${testPort}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  use: {
    baseURL,
    // A preinstalled browser (e.g. CI images that pin a different build than
    // this @playwright/test version expects): PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
})
