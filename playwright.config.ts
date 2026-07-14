import { defineConfig, devices } from '@playwright/test'

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
