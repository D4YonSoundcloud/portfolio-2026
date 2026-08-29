import type { ModuleEdge } from './schema.ts';

/**
 * Resolves import specifiers into file-to-file edges (§4.2).
 *
 * ── Why this is nearly free ──────────────────────────────────────────────────────────
 * No new parsing. The AST walk already emits an `ImportDeclaration` node per import, and
 * `readLabel` already stores the module specifier as that node's label — it was put
 * there so the tooltip could read `ImportDeclaration · ./palette.ts`. All that is left
 * is turning a specifier plus the importing file's path into a path in `files`.
 *
 * ── Deliberately not a real module resolver ──────────────────────────────────────────
 * This does not consult tsconfig paths, node_modules, package exports, or the TypeScript
 * resolver. It handles relative specifiers against a known list of this project's own
 * files, and drops everything else.
 *
 * That is the right scope, not a shortcut: the point is to show the shape of THIS
 * codebase. An edge to `react` would connect every file to one off-screen point and tell
 * you nothing. Anything unresolvable is silently ignored, because a decorative layer
 * (§4.7) must never be able to fail a build.
 */

/** Extensions tried, in order, when a specifier omits one. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/** Collapses `a/b/../c` to `a/c` and strips `./`. Paths here are always POSIX. */
function normalise(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/**
 * Maps a specifier to a path in `files`, or null.
 *
 * The project imports with explicit `.ts`/`.tsx` extensions
 * (`allowImportingTsExtensions`), so the first lookup almost always hits. The
 * extension and index candidates exist so that changing that convention degrades to a
 * missing arc rather than to a silently empty layer.
 */
export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  files: ReadonlySet<string>,
): string | null {
  // Bare and absolute specifiers are external. `#` covers subpath imports.
  if (!specifier.startsWith('.')) return null;

  const directory = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const base = normalise(`${directory}/${specifier}`);
  if (base === '') return null;

  if (files.has(base)) return base;

  for (const extension of EXTENSIONS) {
    // A specifier written `./palette.js` may mean `./palette.ts` under
    // `moduleResolution: bundler`, so a bad extension is retried rather than dropped.
    const swapped = base.replace(/\.[jt]sx?$/, extension);
    if (files.has(swapped)) return swapped;
    if (files.has(base + extension)) return base + extension;
    if (files.has(`${base}/index${extension}`)) return `${base}/index${extension}`;
  }

  return null;
}

export interface ImportRecord {
  /** Path of the file containing the import statement. */
  fileName: string;
  /** Raw module specifier text, as written in source. */
  specifier: string;
}

/**
 * Collapses raw import records into deduplicated edges.
 *
 * Several statements can connect the same pair — a type-only import beside a value one,
 * or two imports from the same module — and drawing one arc per statement would stack
 * identical curves on top of each other, producing an arc that is merely brighter for no
 * legible reason. They collapse to one edge carrying a `count` instead.
 *
 * Self-imports are dropped: a file importing itself is a cycle that renders as a
 * degenerate zero-length arc.
 */
export function buildModuleEdges(
  records: readonly ImportRecord[],
  files: readonly string[],
): ModuleEdge[] {
  const known = new Set(files);
  const counts = new Map<string, ModuleEdge>();

  for (const { fileName, specifier } of records) {
    const target = resolveSpecifier(specifier, fileName, known);
    if (target === null || target === fileName) continue;

    const key = `${fileName}\u0000${target}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { from: fileName, to: target, count: 1 });
  }

  // Stable order so the generated artifact is byte-identical between runs — a graph that
  // reshuffles on every build produces noise in `git diff` and defeats caching.
  return [...counts.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
}