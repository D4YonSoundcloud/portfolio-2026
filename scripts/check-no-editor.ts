import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fails the build if any scene-editor code reached `dist/`.
 *
 * ── Why bother, if the guard already works ───────────────────────────────────────────
 * Because "the guard already works" is an assumption about Rollup's dead-code
 * elimination, and it holds only as long as every reference stays inside a statically
 * false branch. A future refactor that hoists the dynamic `import()` to the top of
 * `main.tsx`, or adds `<SceneEditor />` to `App.tsx` behind a runtime check, would break
 * it silently — the site still works, the bundle is just bigger and ships a dev tool.
 *
 * Nobody notices that by looking. A grep does.
 *
 * Runs as part of `npm run build`, alongside §11's Lighthouse budget check, and for the
 * same reason: the failure mode is invisible without automation.
 *
 * Skipped when SCENE_EDITOR=1, since that build is deliberately including it.
 */

const DIST = 'dist';

/**
 * Strings that should not survive into a production bundle.
 *
 * Chosen to be minification-proof. Identifiers get mangled, so the useful markers are
 * string literals and custom properties, which do not.
 *
 * `--scene-editor-marker` is the important one. A stylesheet import is a side effect, so
 * bundlers never tree-shake it — hoisting the editor import out of its guarded branch
 * can strip the JavaScript while still shipping the panel's CSS. Without a marker in the
 * stylesheet that case passes every JS-only check.
 *
 * Deliberately NOT the panel's visible labels. This is a portfolio ABOUT this codebase —
 * prose describing the scene editor could plausibly end up in a section's copy, and a
 * check that fails on the site's own content is a check that gets disabled.
 */
const SENTINELS: readonly string[] = [
  'portfolio:editor:overrides',
  'scene-editor-root',
  '[scene editor]',
  '--scene-editor-marker',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(js|css|html)$/.test(entry)) out.push(path);
  }
  return out;
}

function main(): void {
  if (process.env['SCENE_EDITOR'] === '1') {
    console.info('check-no-editor: SCENE_EDITOR=1, editor is included on purpose — skipping.');
    return;
  }

  let files: string[];
  try {
    files = walk(DIST);
  } catch {
    console.error(`check-no-editor: ${DIST}/ not found. Run this after the build.`);
    process.exit(1);
  }

  const hits: string[] = [];
  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    for (const sentinel of SENTINELS) {
      if (contents.includes(sentinel)) hits.push(`${file}  ←  ${JSON.stringify(sentinel)}`);
    }
  }

  if (hits.length > 0) {
    console.error(
      'check-no-editor: scene editor code found in the production bundle.\n\n' +
        `${hits.map((hit) => `  ${hit}`).join('\n')}\n\n` +
        'The guard in src/main.tsx must stay a statically-false branch with the\n' +
        'dynamic import() inside it. Check that nothing hoisted it to a top-level\n' +
        'import or a React.lazy call.',
    );
    process.exit(1);
  }

  console.info(`check-no-editor: clean (${files.length} files scanned).`);
}

main();