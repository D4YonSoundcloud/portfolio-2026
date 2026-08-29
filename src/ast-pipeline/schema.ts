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

/**
 * A resolved import between two of this project's own files.
 *
 * Keyed by FILE PATH rather than by node index, unlike `astEdgeSchema` below. Node
 * indices churn through the runtime depth filter and quality cap, and while file roots
 * always survive those, relying on that is a trap waiting for the first person who
 * changes the ranking rule. There are only tens of these, so a string pair is cheap.
 *
 * Bare specifiers ('three', 'react') resolve to nothing and are dropped at generation:
 * this is a map of THIS codebase, not of node_modules.
 */
export const moduleEdgeSchema = z.object({
  /** Path of the importing file, matching an entry in `files`. */
  from: z.string().min(1),
  /** Path of the imported file. */
  to: z.string().min(1),
  /** How many separate import statements connect the pair. */
  count: z.number().int().positive(),
});

export type ModuleEdge = z.infer<typeof moduleEdgeSchema>;

/** Parent -> child index pairs, pre-flattened for a single LineSegments buffer (§4.4). */
export const astEdgeSchema = z.tuple([z.number().int(), z.number().int()]);
export type AstEdge = z.infer<typeof astEdgeSchema>;

export const astGraphSchema = z.object({
  /**
   * Schema version — bump when the node shape changes so stale JSON fails loudly.
   *
   * 2 added `moduleEdges`. A cached v1 artifact now fails validation at load rather than
   * rendering a scene whose import layer is silently missing.
   */
  version: z.literal(2),
  generatedAt: z.string(),
  /** Source files that contributed nodes, in stable order. */
  files: z.array(z.string()),
  nodes: z.array(astNodeSchema),
  edges: z.array(astEdgeSchema),
  /** File-to-file imports, resolved at build time (§4.2). */
  moduleEdges: z.array(moduleEdgeSchema),
  stats: z.object({
    totalParsed: z.number().int().nonnegative(),
    rendered: z.number().int().nonnegative(),
    maxDepth: z.number().int().nonnegative(),
  }),
});

export type AstGraph = z.infer<typeof astGraphSchema>;

export const snippetSchema = z.object({
  nodeId: z.string(),
  /** `src/scene/CameraRig.tsx › FunctionDeclaration` (§4.6). */
  breadcrumb: z.string(),
  /**
   * Pre-highlighted by Shiki at build time — no highlighter ships to the client (§2).
   *
   * ONE markup string carrying both themes as CSS custom properties, not two parallel
   * strings. Storing each snippet twice doubled the artifact for no gain, and a theme
   * switch (§7.2) is now a CSS variable flip rather than swapping innerHTML.
   */
  html: z.string(),
  startLine: z.number().int().nonnegative(),
});

export type Snippet = z.infer<typeof snippetSchema>;

export const snippetsFileSchema = z.object({
  version: z.literal(1),
  snippets: z.record(z.string(), snippetSchema),
  /**
   * Maps a node with no snippet of its own to the nearest ancestor that has one.
   *
   * Emitting a snippet for every node produces a file dominated by redundancy — a
   * parent's snippet already contains every one of its children's, so the same source
   * lines get highlighted and stored once per level of depth. Snippets are generated for
   * structurally meaningful nodes only (see SNIPPET_MAX_DEPTH) and everything below
   * resolves upward through this map, which costs a short string instead of a full
   * duplicated highlight.
   */
  aliases: z.record(z.string(), z.string()),
});

export type SnippetsFile = z.infer<typeof snippetsFileSchema>;