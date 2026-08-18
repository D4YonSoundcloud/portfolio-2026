import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * §2 — "Vitest shares Vite's config/transform pipeline (no separate babel setup)."
 *
 * Deliberately a separate config file from vite.config.ts: the app build's manualChunks
 * and base-path handling are irrelevant here and only cause confusion.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    css: {
      // CSS Modules resolve to real class-name maps so `styles.foo` isn't undefined in
      // assertions that check rendered classes.
      modules: { classNameStrategy: 'non-scoped' },
    },
  },
});
