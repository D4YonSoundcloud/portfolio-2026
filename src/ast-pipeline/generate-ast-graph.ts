import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { categorize, kindName, readLabel } from './categorize.ts';
import { buildModuleEdges, type ImportRecord } from './moduleEdges.ts';
import { computeLayout, type LayoutInput } from './layout.ts';
import {
  astGraphSchema,
  snippetsFileSchema,
  type AstEdge,
  type AstGraph,
  type AstNode,
} from './schema.ts';
import { buildSnippets, disposeHighlighter, type SnippetSource } from './snippets.ts';

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

/**
 * §4.6 — depth ceiling for snippet generation. Nodes below this alias upward to an
 * ancestor's snippet rather than storing a near-duplicate of it.
 */
const SNIPPET_MAX_DEPTH = 4;

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
  imports: ImportRecord[];
} {
  const nodes: WorkingNode[] = [];
  const fileTexts = new Map<string, string>();
  const imports: ImportRecord[] = [];
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

      /*
       * Record the import while the real ts.Node is still in hand.
       *
       * The specifier also survives onto the emitted node as its label, but reading it
       * back from there would mean trusting that `readLabel` never changes what it puts
       * on an ImportDeclaration — a coupling that would break silently and leave the
       * import layer quietly empty. Captured from the AST directly instead.
       */
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push({ fileName: relativePath, specifier: node.moduleSpecifier.text });
      }

      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line;

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
        label: safeReadLabel(node),
        isFileRoot: false,
        weight: 0,
      });
      nodes[parentIndex]?.childIndices.push(index);

      ts.forEachChild(node, (child) => visit(child, index, depth + 1));
    };

    ts.forEachChild(sourceFile, (child) => visit(child, rootIndex, 1));
  }

  return { nodes, fileTexts, totalParsed, imports };
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

  const { nodes: rawNodes, fileTexts, totalParsed, imports } = extract(files);
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
    loc: { startLine: n.startLine, endLine: n.endLine },
    label: n.label,
    position: positions[i] ?? { x: 0, y: 0, z: 0 },
  }));

  // §4.4 — edges pre-flattened to index pairs for one LineSegments buffer.
  const edges: AstEdge[] = [];
  nodes.forEach((n, i) => {
    if (n.parentIndex !== null) edges.push([n.parentIndex, i]);
  });

  // §4.2 — file-to-file imports, resolved against the files actually parsed. Kept
  // separate from `edges` because they connect FILE ROOTS rather than parent/child
  // nodes, and are drawn as their own layer (see scene/ModuleEdges.tsx).
  const moduleEdges = buildModuleEdges(imports, [...fileTexts.keys()]);

  const graph: AstGraph = {
    version: 2,
    generatedAt: new Date().toISOString(),
    files: [...fileTexts.keys()],
    nodes: astNodes,
    edges,
    moduleEdges,
    stats: {
      totalParsed,
      rendered: astNodes.length,
      maxDepth: astNodes.reduce((max, n) => Math.max(max, n.depth), 0),
    },
  };

  // §2 (Zod) — a malformed node shape fails the build here, not the scene at runtime.
  const validatedGraph = astGraphSchema.parse(graph);

  /**
   * §4.6 — snippets are generated for structurally meaningful nodes only.
   *
   * A snippet for every node means the same source lines are highlighted and stored once
   * per level of depth, since a parent's `loc` range already spans all of its children's.
   * At full depth that produced a multi-megabyte artifact for a payload the Code
   * Inspector only ever reads one entry from. Deeper nodes alias to the nearest ancestor
   * that has one, which is also the more useful thing to read: clicking a `StringLiteral`
   * and being shown the enclosing declaration beats being shown the string.
   */
  const snippetNodes = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.isFileRoot || node.depth <= SNIPPET_MAX_DEPTH);

  const hasSnippet = new Set(snippetNodes.map(({ index }) => index));

  const snippetSources: SnippetSource[] = snippetNodes.flatMap(({ node, index }) => {
    const fileText = fileTexts.get(node.fileName);
    const astNode = astNodes[index];
    if (!fileText || !astNode) return [];
    return [
      {
        nodeId: astNode.id,
        fileName: node.fileName,
        kind: node.kind,
        label: node.label,
        startLine: node.startLine,
        endLine: node.endLine,
        fileText,
      },
    ];
  });

  // Every remaining node points at its nearest ancestor that does have a snippet, so a
  // click anywhere in the scene always opens something.
  const aliases: Record<string, string> = {};
  nodes.forEach((node, index) => {
    if (hasSnippet.has(index)) return;
    let cursor = node.parentIndex;
    while (cursor !== null && !hasSnippet.has(cursor)) {
      cursor = nodes[cursor]?.parentIndex ?? null;
    }
    const target = cursor === null ? null : astNodes[cursor]?.id;
    const self = astNodes[index]?.id;
    if (self && target) aliases[self] = target;
  });

  const snippets = await buildSnippets(snippetSources);
  const validatedSnippets = snippetsFileSchema.parse({ version: 1, snippets, aliases });
  await disposeHighlighter();

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'ast-graph.json'), JSON.stringify(validatedGraph));
  writeFileSync(join(OUT_DIR, 'snippets.json'), JSON.stringify(validatedSnippets));

  const elapsed = Date.now() - started;
  console.log(
    [
      `ast-graph  ${files.length} files · ${totalParsed} nodes parsed`,
      `           ${astNodes.length} rendered (cap ${MAX_NODES}) · ${edges.length} edges`,
      `           max depth ${validatedGraph.stats.maxDepth} · ${elapsed}ms`,
      `snippets   ${Object.keys(validatedSnippets.snippets).length} generated · ${Object.keys(validatedSnippets.aliases).length} aliased to an ancestor`,
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error('\nast-graph generation failed:\n', error);
  process.exit(1);
});