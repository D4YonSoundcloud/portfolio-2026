import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * §10 — Base path.
 *
 * GitHub Pages serves a project repo at `https://<user>.github.io/<repo>/` unless a
 * custom domain is configured in Settings → Pages. Vite's `base` must match:
 *
 *   /<repo>/   default project-page subpath
 *   /          custom domain, or a <user>.github.io user/org-page repo
 *
 * Every generated asset reference (ast-graph.json, snippets.json, fonts, poster images)
 * resolves against this via `import.meta.env.BASE_URL` — which is exactly why §10 calls
 * it the one config value that silently breaks every asset link if it's wrong. Confirm
 * it on the FIRST deploy, not after the rest is built out.
 *
 * Set through the environment so the deploy workflow can supply it without editing
 * source: `BASE_PATH=/my-repo/ npm run build`.
 */
const base = normalizeBase(process.env['BASE_PATH']);

/**
 * Coerces whatever `BASE_PATH` holds into a value Vite accepts.
 *
 * Two cases make this more than a default. `actions/configure-pages` emits an EMPTY
 * STRING for a custom domain, which `?? '/'` does not catch — nullish coalescing only
 * catches null and undefined — and Vite reads `base: ''` as "resolve assets relatively",
 * which breaks the prerendered HTML (§10). It also emits `/repo` with no trailing slash,
 * which Vite needs in order to join asset paths correctly.
 *
 * Both produce a site that builds cleanly and then 404s every asset in production, which
 * is exactly the silent failure §10 warns about. Normalising here means the deploy
 * workflow can pass the output through verbatim.
 */
function normalizeBase(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}/`;
}

export default defineConfig({
  base,
  plugins: [react()],

  build: {
    target: 'es2022',
    // §11 — Lighthouse CI watches the budget; this surfaces a regression at build time
    // rather than waiting for the CI step to fail.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          // §4.7 — Three.js/R3F/postprocessing are code-split behind React.lazy, but
          // splitting them again here keeps the scene chunk from re-downloading in full
          // whenever unrelated scene code changes.
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
        },
      },
    },
  },

  // The AST pipeline writes into public/ before the build (`prebuild`), so these are
  // ordinary static assets by the time Vite runs.
  publicDir: 'public',
});