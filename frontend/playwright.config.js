import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --strictPort',
    url: baseURL,
    reuseExistingServer: true,
  },
})
