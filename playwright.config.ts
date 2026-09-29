import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3108',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    actionTimeout: 10000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
  },
  reporter: 'list',
})
