/**
 * Geometry by tree depth.
 *
 * Depth is the most informative thing about an AST node that colour is not already
 * carrying (colour encodes category, §4.2). Giving depth its own channel — silhouette —
 * means the eye can read the tree's structure without decoding anything: dense, faceted
 * forms at the root, resolving to simple tetrahedra out at the leaves.
 *
 * It also happens to be where the triangles want to go. Root nodes are few and large
 * enough to show facets, so they can afford subdivision; leaves are thousands-strong and
 * a handful of pixels each, where extra geometry is invisible and expensive. Both
 * concerns point the same direction, which is why the tiers get progressively cheaper.
 */

export type TierKind = 'icosahedron' | 'octahedron' | 'tetrahedron';

export interface GeometryTier {
  id: number;
  kind: TierKind;
  /** Subdivision passed to the geometry. Higher = rounder and far more triangles. */
  detail: number;
  /** Base radius before per-instance and theme scaling. */
  radius: number;
  /** Roughly how many triangles one instance of this tier costs. */
  faces: number;
}

/**
 * Ordered shallow → deep. Index into this array IS the tier id.
 *
 * Face counts, for budgeting: an icosahedron is 20 faces at detail 0 and quadruples with
 * each level, so detail 2 is 320. That is only affordable because tier 0 holds file
 * roots and top-level declarations — tens of nodes, not thousands.
 */
export const GEOMETRY_TIERS: readonly GeometryTier[] = [
  { id: 0, kind: 'icosahedron', detail: 2, radius: 0.82, faces: 320 },
  { id: 1, kind: 'icosahedron', detail: 1, radius: 0.68, faces: 80 },
  { id: 2, kind: 'icosahedron', detail: 0, radius: 0.55, faces: 20 },
  { id: 3, kind: 'octahedron', detail: 0, radius: 0.46, faces: 8 },
  { id: 4, kind: 'tetrahedron', detail: 0, radius: 0.40, faces: 4 },
];

/**
 * Depth → tier. Depths 0 and 1 share the top tier because depth 0 is the synthetic
 * per-file root and depth 1 is that file's top-level declarations — structurally the
 * same "this is the shape of the module" reading.
 */
export function tierForDepth(depth: number): GeometryTier {
  const index = depth <= 1 ? 0 : Math.min(depth - 1, GEOMETRY_TIERS.length - 1);
  // Non-null: index is clamped to the array's bounds above.
  return GEOMETRY_TIERS[index] as GeometryTier;
}

/**
 * Subdivision actually used, after the quality tier has its say (§8.3).
 *
 * The node cap keeps the SHALLOWEST nodes, so a phone's smaller budget is spent
 * disproportionately on tier 0 — the most expensive geometry, exactly where a desktop
 * would have amortised it across thousands of cheap leaves. Dropping one subdivision
 * level quarters the face count of the tiers that dominate, and at phone pixel densities
 * the silhouette is what reads anyway, not the facet count.
 */
export function detailForQuality(tier: GeometryTier, quality: 'high' | 'medium' | 'low'): number {
  if (quality === 'high') return tier.detail;
  if (quality === 'medium') return Math.max(0, tier.detail - 1);
  return 0;
}