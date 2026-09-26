import { defineConfig, devices } from '@playwright/test';
import { WEB_PORT, repoRoot, webUrl } from './env.js';

// Needs a built repo (`pnpm build`, with NEXT_PUBLIC_API_URL=http://localhost:4000) and
// Postgres, Redis and MinIO running. See e2e/README.md.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: './.artifacts/results',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The standalone server is what the web image runs; it needs the static assets next to it.
    command:
      'cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/ && ' +
      'node apps/web/.next/standalone/apps/web/server.js',
    env: { PORT: String(WEB_PORT), HOSTNAME: '127.0.0.1' },
    cwd: repoRoot,
    url: `${webUrl}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
