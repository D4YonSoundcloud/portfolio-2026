import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * §10 — SEO & static output.
 *
 * "Use vite-plugin-ssg (or a minimal custom prerender step) to emit fully-formed HTML
 * for the content layer; the 3D scene still hydrates client-side on top of it."
 *
 * This is the minimal custom step. It's deliberately not a plugin: there is exactly one
 * route (§10 notes the fixed-viewport structure sidesteps the SPA deep-link problem
 * entirely), so the whole job is "render one component to a string and splice it in".
 *
 * Core content ends up in the initial HTML rather than only after the JS bundle
 * evaluates. That falls out of §5.3 for free — every focus item is already in the DOM at
 * all times, only one is visually centred — so there's no separate "make sure
 * scrolled-past content is crawlable" problem to solve.
 */

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PLACEHOLDER = '<!--app-html-->';

async function main(): Promise<void> {
  const template = readFileSync(join(DIST, 'index.html'), 'utf8');

  if (!template.includes(PLACEHOLDER)) {
    throw new Error(
      `dist/index.html is missing the ${PLACEHOLDER} placeholder — prerender has nothing to fill.`,
    );
  }

  // Build the server entry into memory-adjacent output, separate from the client bundle.
  await build({
    root: ROOT,
    logLevel: 'warn',
    // Do NOT inherit vite.config.ts: its `manualChunks` splits `three` into its own
    // chunk, which Rollup rejects here because SSR externalises `three` entirely.
    // The server build shares nothing meaningful with the client build's output config.
    configFile: false,
    plugins: [react()],
    build: {
      ssr: 'src/entry-server.tsx',
      outDir: 'dist-ssr',
      emptyOutDir: true,
      // CSS Modules still need to resolve to class-name maps on the server, but the
      // emitted stylesheet is the client build's job.
      cssCodeSplit: false,
      rollupOptions: {
        output: { entryFileNames: 'entry-server.js' },
      },
    },
  });

  const entry = join(ROOT, 'dist-ssr', 'entry-server.js');
  const { render } = (await import(entry)) as { render: () => string };

  const appHtml = render();
  const output = template.replace(PLACEHOLDER, appHtml);

  writeFileSync(join(DIST, 'index.html'), output);

  console.log(`prerender  ${appHtml.length.toLocaleString()} chars of content HTML inlined`);
}

main().catch((error: unknown) => {
  console.error('\nprerender failed:\n', error);
  process.exit(1);
});
