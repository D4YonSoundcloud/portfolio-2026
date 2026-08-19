import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { categorize, kindName, readLabel } from './categorize.ts';
import { computeLayout, type LayoutInput } from './layout.ts';
import {
  astGraphSchema,
  sourceIndexSchema,
  type AstEdge,
  type AstGraph,
  type AstNode,
} from './schema.ts';
import {
  buildSourceIndex,
  disposeHighlighter,
  type SourceFileInput,
} from './sourceIndex.ts';

/**
 * §4 — extract → transform → layout → render. This script owns the first three stages;
 * the browser only ever does the fourth.
 *
 * Runs in Node at build time (`predev` / `prebuild`). The TypeScript compiler itself is
 * never shipped to the client — that would add megabytes to the bundle for zero user
 * benefit (§4.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONSTRAINT (§4, non-goals §1) — SOURCE SCOPE IS HARDCODED, NOT CONFIGURABLE.
 *
 * This script globs THIS repository's own `src/` directory and nothing else. It accepts
 * no external path, no repo URL, and no reference to any of the proprietary codebases
 * behind the projects in the Projects section. Those are described through copy,
 * diagrams and screenshots the author writes directly — never through parsed source.
 *
 * `scripts/check-ast-scope.ts` fails CI if the two constants below are ever widened, so
 * this stays a structural guarantee rather than something that has to be remembered.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// -- The two values the CI scope check asserts against. Do not parameterise. -----------
const SOURCE_ROOT = 'src';
const SOURCE_GLOB = 'src/**/*.{ts,tsx}';
// -------------------------------------------------------------------------------------

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT_DIR = join(PROJECT_ROOT, 'public');

/** §4.5 — desktop instance budget. Mobile applies a lower cap at runtime (§8.3). */
const MAX_NODES = 2600;

/**
 * §4.5 — the default view shows high-level structure only. Nodes deeper than this are
 * dropped at build time; the remaining budget is what the camera flies through.
 */
const MAX_DEPTH = 6;


/** Kinds that add noise without adding readable structure. */
const SKIPPED_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EndOfFileToken,
  ts.SyntaxKind.SyntaxList,
  ts.SyntaxKind.JsxText,
]);

interface WorkingNode {
  id: string;
  kind: string;
  syntaxKind: ts.SyntaxKind;
  depth: number;
  fileName: string;
  parentIndex: number | null;
  childIndices: number[];
  startLine: number;
  endLine: number;
  /** Absolute character offsets, half-open [start, end). */
  start: number;
  end: number;
  label: string | null;
  isFileRoot: boolean;
  /** Retained for pruning: a node's subtree size decides what survives the budget. */
  weight: number;
}

function collectSourceFiles(): string[] {
  const root = join(PROJECT_ROOT, SOURCE_ROOT);
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
  };

  walk(root);
  return found;
}

/** §4.1 — extract. One `ts.createSourceFile` per file, walked with `ts.forEachChild`. */
function extract(files: readonly string[]): {
  nodes: WorkingNode[];
  fileTexts: Map<string, string>;
  totalParsed: number;
} {
  const nodes: WorkingNode[] = [];
  const fileTexts = new Map<string, string>();
  let totalParsed = 0;

  for (const absolutePath of files) {
    const text = readFileSync(absolutePath, 'utf8');
    const relativePath = relative(PROJECT_ROOT, absolutePath).split(sep).join('/');
    fileTexts.set(relativePath, text);

    const sourceFile = ts.createSourceFile(
      relativePath,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    // §4.2 — a synthetic root per file. These are what separate into clusters under the
    // force layout, and what the focus carousel points the camera at (§4.3, §5).
    const rootIndex = nodes.length;
    const lastLine = sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line;
    nodes.push({
      id: `${relativePath}#root`,
      kind: 'SourceFile',
      syntaxKind: ts.SyntaxKind.SourceFile,
      depth: 0,
      fileName: relativePath,
      parentIndex: null,
      childIndices: [],
      startLine: 0,
      endLine: lastLine,
      start: 0,
      end: text.length,
      label: relativePath.split('/').pop() ?? relativePath,
      isFileRoot: true,
      weight: 0,
    });

    let counter = 0;

    const visit = (node: ts.Node, parentIndex: number, depth: number): void => {
      totalParsed += 1;

      if (SKIPPED_KINDS.has(node.kind) || depth > MAX_DEPTH) {
        // Keep descending so a useful grandchild isn't lost behind a skipped parent,
        // but don't spend a node on the skipped one itself.
        if (depth <= MAX_DEPTH) {
          ts.forEachChild(node, (child) => visit(child, parentIndex, depth));
        }
        return;
      }

      // `getStart` skips leading trivia (comments, whitespace) so a highlighted range
      // covers the node itself rather than the blank space above it. `pos` would not.
      const startOffset = node.getStart(sourceFile);
      const endOffset = node.end;
      const start = sourceFile.getLineAndCharacterOfPosition(startOffset).line;
      const end = sourceFile.getLineAndCharacterOfPosition(endOffset).line;

      const index = nodes.length;
      nodes.push({
        id: `${relativePath}#${counter++}`,
        kind: kindName(node.kind),
        syntaxKind: node.kind,
        depth,
        fileName: relativePath,
        parentIndex,
        childIndices: [],
        startLine: start,
        endLine: end,
        start: startOffset,
        end: endOffset,
        label: safeReadLabel(node),
        isFileRoot: false,
        weight: 0,
      });
      nodes[parentIndex]?.childIndices.push(index);

      ts.forEachChild(node, (child) => visit(child, index, depth + 1));
    };

    ts.forEachChild(sourceFile, (child) => visit(child, rootIndex, 1));
  }

  return { nodes, fileTexts, totalParsed };
}

/** `readLabel` calls `.getText()`, which throws on synthesised nodes. Never fail the build for a label. */
function safeReadLabel(node: ts.Node): string | null {
  try {
    return readLabel(node);
  } catch {
    return null;
  }
}

/**
 * §4.5 — node budget. Pruning is a build-time decision, not something recomputed on
 * every page load. Shallow nodes and nodes with large subtrees win, so what survives is
 * the readable skeleton of the codebase rather than an arbitrary first-N slice.
 */
function prune(nodes: readonly WorkingNode[]): WorkingNode[] {
  if (nodes.length <= MAX_NODES) return [...nodes];

  // Subtree sizes, computed bottom-up. Children always follow parents in `nodes`.
  const weights = new Array<number>(nodes.length).fill(1);
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!node) continue;
    const parentIndex = node.parentIndex;
    if (parentIndex !== null) {
      weights[parentIndex] = (weights[parentIndex] ?? 1) + (weights[i] ?? 1);
    }
  }

  const ranked = nodes
    .map((node, index) => ({ index, node, score: (weights[index] ?? 1) / (node.depth + 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NODES);

  const keep = new Set<number>(ranked.map((r) => r.index));

  // A kept node needs its whole ancestor chain, or the edge list would reference a
  // node that no longer exists.
  for (const index of [...keep]) {
    let cursor = nodes[index]?.parentIndex ?? null;
    while (cursor !== null && !keep.has(cursor)) {
      keep.add(cursor);
      cursor = nodes[cursor]?.parentIndex ?? null;
    }
  }

  const oldToNew = new Map<number, number>();
  const kept: WorkingNode[] = [];
  nodes.forEach((node, index) => {
    if (!keep.has(index)) return;
    oldToNew.set(index, kept.length);
    kept.push({ ...node, childIndices: [] });
  });

  kept.forEach((node, newIndex) => {
    const remapped = node.parentIndex === null ? null : (oldToNew.get(node.parentIndex) ?? null);
    node.parentIndex = remapped;
    if (remapped !== null) kept[remapped]?.childIndices.push(newIndex);
  });

  return kept;
}

async function main(): Promise<void> {
  const started = Date.now();
  const files = collectSourceFiles();

  if (files.length === 0) {
    throw new Error(`No source files found under ${SOURCE_ROOT}/ — check ${SOURCE_GLOB}`);
  }

  const { nodes: rawNodes, fileTexts, totalParsed } = extract(files);
  const nodes = prune(rawNodes);

  // §4.3 — layout runs once, here.
  const layoutInput: LayoutInput[] = nodes.map((n) => ({
    id: n.id,
    parentIndex: n.parentIndex,
    depth: n.depth,
    isFileRoot: n.isFileRoot,
  }));
  const positions = computeLayout(layoutInput);

  const astNodes: AstNode[] = nodes.map((n, i) => ({
    id: n.id,
    kind: n.kind,
    category: n.isFileRoot ? 'Declaration' : categorize(n.syntaxKind),
    depth: n.depth,
    fileName: n.fileName,
    parentId: n.parentIndex === null ? null : (nodes[n.parentIndex]?.id ?? null),
    childIds: n.childIndices.map((c) => nodes[c]?.id ?? '').filter(Boolean),
    loc: { startLine: n.startLine, endLine: n.endLine, start: n.start, end: n.end },
    label: n.label,
    position: positions[i] ?? { x: 0, y: 0, z: 0 },
  }));

  // §4.4 — edges pre-flattened to index pairs for one LineSegments buffer.
  const edges: AstEdge[] = [];
  nodes.forEach((n, i) => {
    if (n.parentIndex !== null) edges.push([n.parentIndex, i]);
  });

  const graph: AstGraph = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: [...fileTexts.keys()],
    nodes: astNodes,
    edges,
    stats: {
      totalParsed,
      rendered: astNodes.length,
      maxDepth: astNodes.reduce((max, n) => Math.max(max, n.depth), 0),
    },
  };

  // §2 (Zod) — a malformed node shape fails the build here, not the scene at runtime.
  const validatedGraph = astGraphSchema.parse(graph);

  /**
   * §4.6 — the source index.
   *
   * One entry per FILE, not per node. Because every node carries absolute character
   * offsets into its own file (`loc.start`/`loc.end`), the inspector can show any node
   * at any depth by highlighting a range of its file — so there is no per-node artifact,
   * no depth cutoff below which nodes lose their own source, and no alias map.
   */
  const sourceInputs: SourceFileInput[] = [...fileTexts.entries()].map(([fileName, text]) => ({
    fileName,
    text,
  }));

  const sourceIndex = await buildSourceIndex(sourceInputs);
  const validatedIndex = sourceIndexSchema.parse(sourceIndex);
  await disposeHighlighter();

  // Every node must land inside its own file, or the inspector would silently render an
  // empty or truncated range. Cheap to check, and impossible to notice by eye otherwise.
  for (const node of astNodes) {
    const file = validatedIndex.files[node.fileName];
    if (!file) throw new Error(`${node.id}: no source entry for ${node.fileName}`);
    if (node.loc.start > node.loc.end || node.loc.end > file.text.length) {
      throw new Error(
        `${node.id}: range ${node.loc.start}..${node.loc.end} is outside ` +
          `${node.fileName} (${file.text.length} chars)`,
      );
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'ast-graph.json'), JSON.stringify(validatedGraph));
  writeFileSync(join(OUT_DIR, 'source-index.json'), JSON.stringify(validatedIndex));

  const elapsed = Date.now() - started;
  console.log(
    [
      `ast-graph  ${files.length} files · ${totalParsed} nodes parsed`,
      `           ${astNodes.length} rendered (cap ${MAX_NODES}) · ${edges.length} edges`,
      `           max depth ${validatedGraph.stats.maxDepth} · ${elapsed}ms`,
      `source     ${Object.keys(validatedIndex.files).length} files indexed · ` +
        `${validatedIndex.palette.length} palette colours · ` +
        `${Math.round(validatedIndex.files[sourceInputs[0]?.fileName ?? '']?.tokens.length ?? 0)} tokens in first file`,
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error('\nast-graph generation failed:\n', error);
  process.exit(1);
});
