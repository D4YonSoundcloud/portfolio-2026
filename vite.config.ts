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

export default defineConfig(({ command }) => {
  /**
   * The scene editor switch (see `src/editor/`).
   *
   * On during `vite dev` (`command === 'serve'`), off for every build UNLESS
   * `SCENE_EDITOR=1` is set explicitly:
   *
   *   npm run build                    production — editor stripped
   *   SCENE_EDITOR=1 npm run build     tuning build — editor included
   *
   * The opt-in build exists because the values worth tuning most are the ones that only
   * misbehave on real hardware — bloom cost on a phone GPU, how the light theme reads in
   * daylight — and `npm run dev` on a laptop cannot show you either. Deploy that build
   * somewhere private, never to the live site.
   *
   * Substituted as a bare identifier rather than exposed through `import.meta.env`, on
   * purpose: Vite only statically replaces `import.meta.env.VITE_*` when the variable is
   * actually set, so an unset flag would leave the guard live at runtime and ship the
   * editor. A `define` is replaced unconditionally. See `src/vite-env.d.ts`.
   */
  const sceneEditor = command === 'serve' || process.env['SCENE_EDITOR'] === '1';

  return {
    base,
    plugins: [react()],

    define: {
      __SCENE_EDITOR__: JSON.stringify(sceneEditor),
    },

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
  };
});