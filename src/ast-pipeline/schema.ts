import { z } from 'zod';

/**
 * §4.2 — the generated graph is validated against this schema at build time, so a
 * malformed node shape fails `npm run build` instead of crashing the scene at runtime.
 *
 * This module is imported by BOTH the build-time generator (Node) and the runtime
 * scene (browser), which is why it stays free of any `fs`/`typescript` imports.
 */

export const NODE_CATEGORIES = [
  'Declaration',
  'ControlFlow',
  'JSX',
  'Import',
  'Expression',
  'Literal',
] as const;

export const nodeCategorySchema = z.enum(NODE_CATEGORIES);
export type NodeCategory = z.infer<typeof nodeCategorySchema>;

export const astNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  category: nodeCategorySchema,
  depth: z.number().int().nonnegative(),
  fileName: z.string().min(1),
  parentId: z.string().nullable(),
  childIds: z.array(z.string()),
  loc: z.object({
    startLine: z.number().int().nonnegative(),
    endLine: z.number().int().nonnegative(),
    /**
     * Absolute character offsets into the containing file, half-open [start, end).
     *
     * These are what the Code Inspector highlights against (§4.6). Lines alone are not
     * enough: a node frequently starts and ends mid-line, and highlighting whole lines
     * for a `StringLiteral` would point at the statement rather than the node.
     */
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  /** Human-readable identifier where one exists, e.g. `renderProjectCard`. */
  label: z.string().nullable(),
  /** Baked by the build-time d3-force-3d pass (§4.3). Never simulated at runtime. */
  position: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }),
});

export type AstNode = z.infer<typeof astNodeSchema>;

/** Parent -> child index pairs, pre-flattened for a single LineSegments buffer (§4.4). */
export const astEdgeSchema = z.tuple([z.number().int(), z.number().int()]);
export type AstEdge = z.infer<typeof astEdgeSchema>;

export const astGraphSchema = z.object({
  /** Schema version — bump when the node shape changes so stale JSON fails loudly. */
  version: z.literal(1),
  generatedAt: z.string(),
  /** Source files that contributed nodes, in stable order. */
  files: z.array(z.string()),
  nodes: z.array(astNodeSchema),
  edges: z.array(astEdgeSchema),
  stats: z.object({
    totalParsed: z.number().int().nonnegative(),
    rendered: z.number().int().nonnegative(),
    maxDepth: z.number().int().nonnegative(),
  }),
});

export type AstGraph = z.infer<typeof astGraphSchema>;

/**
 * A syntax colour, as the two theme variants Shiki produced for it (§7.2).
 *
 * Stored once in a palette and referenced by index, because across a codebase there are
 * only a few dozen distinct colours but hundreds of thousands of tokens.
 */
export const paletteEntrySchema = z.tuple([z.string(), z.string()]);
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;

/**
 * One source file: its text, plus a flat token stream describing how to colour it.
 *
 * The token stream is a flat number array in groups of three —
 * `[offset, length, paletteIndex, offset, length, paletteIndex, ...]` — rather than an
 * array of objects. Objects would repeat the three key names for every token, which at
 * this volume is most of the payload.
 */
export const sourceFileSchema = z.object({
  text: z.string(),
  tokens: z.array(z.number().int()),
});

export type SourceFile = z.infer<typeof sourceFileSchema>;

/**
 * §4.6 — the source index. Replaces the old per-node snippet file entirely.
 *
 * ── Why this shape ───────────────────────────────────────────────────────────────────
 * Version 1 stored pre-rendered highlighted HTML per node. That was redundant twice
 * over: a parent's snippet already contains every one of its children's, so the same
 * lines were highlighted once per level of depth; and every token carried its own
 * `<span style="--shiki-light:…;--shiki-dark:…">` wrapper, repeated for the whole
 * codebase. It also forced a depth cutoff, below which nodes had no snippet of their own
 * and aliased to an ancestor's.
 *
 * Version 2 stores each file's text ONCE alongside a numeric token stream. A node is
 * then just a character range into its own file (`AstNode.loc.start`/`.end`), which
 * means EVERY node gets an exact, unaliased view — the depth cutoff and the alias map
 * are both gone.
 *
 * Measured against this repository: 4.02MB → ~0.6MB raw. Transfer is close to a wash
 * once gzipped (gzip crushes the repeated HTML well), so the win is `JSON.parse` cost
 * and memory on low-end devices, not bandwidth.
 *
 * ── What the client does with it ─────────────────────────────────────────────────────
 * Renders tokens as React elements (see inspector/renderTokens.ts). No highlighter
 * ships, exactly as before, and nothing goes through `dangerouslySetInnerHTML` any more
 * — text becomes text nodes, so escaping is no longer something that has to be right.
 */
export const sourceIndexSchema = z.object({
  version: z.literal(2),
  palette: z.array(paletteEntrySchema),
  /** Keyed by the same `fileName` that appears on every AstNode. */
  files: z.record(z.string(), sourceFileSchema),
});

export type SourceIndex = z.infer<typeof sourceIndexSchema>;

