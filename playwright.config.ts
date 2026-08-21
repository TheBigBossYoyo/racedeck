import { defineConfig } from '@playwright/test'

/**
 * Playwright is configured for Electron end-to-end smoke tests.
 * Run `npm run build` first, then `npm run test:e2e`.
 * These tests launch the built Electron app and verify the shell renders,
 * layouts switch, and the demo provider loads. They intentionally do NOT
 * touch TOD / DRM surfaces.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry'
  }
})
