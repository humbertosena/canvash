import { defineConfig, devices } from '@playwright/test';

/** Um servidor por exemplo, cada um na própria porta (strictPort no vite.config de cada um). */
const EXAMPLES = [
  { filter: '@canvash/example-vanilla', port: 5173 },
  { filter: '@canvash/example-react', port: 5174 },
  { filter: '@canvash/example-vue', port: 5175 },
  { filter: '@canvash/example-web-components', port: 5176 },
] as const;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  // Um `.only` esquecido desligaria o resto da suíte com tudo verde, também fora do CI.
  forbidOnly: true,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: EXAMPLES.map(({ filter, port }) => ({
    command: `pnpm --filter ${filter} dev`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  })),
});
