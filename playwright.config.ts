import { defineConfig, devices } from '@playwright/test';

/**
 * §11 — "Playwright covers focus-navigation behavior (wheel/keyboard/touch) and non-3D
 * visual regressions."
 *
 * §8.3 — "Extend Playwright coverage to mobile-viewport emulation specifically for the
 * gesture-axis-locking behavior — this is the piece most likely to feel wrong on a real
 * device while still passing a desktop-only test suite."
 *
 * Note the caveat §8.3 implies and §13 step 8 states outright: emulation is not a real
 * device. This suite catches regressions; it does not replace QA on actual phones.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // §8.2 — touch is the primary input here, so `hasTouch` matters more than viewport.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],

  // Runs against the built output, so what's tested is what deploys — including the
  // prerendered HTML (§10) that dev mode never produces.
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
