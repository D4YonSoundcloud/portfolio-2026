import { useEffect, useMemo, useState } from 'react';
import { Vector3 } from 'three';

import { astGraphSchema, type AstGraph, type AstNode, type NodeCategory } from '../ast-pipeline/schema.ts';
import { tierForDepth, type GeometryTier } from './geometryTiers.ts';
import { SECTIONS } from '../sections/sections.ts';
import { useSceneStore, type Quality } from '../store/sceneStore.ts';

/**
 * Loads the baked graph produced by the build-time pipeline (§4). The runtime never
 * parses source and never runs the force simulation — it only reads positions (§4.3).
 */

/** §4.5 desktop range vs §8.3 mobile range. */
const NODE_CAP: Record<Quality, number> = {
  high: 2600,
  medium: 1600,
  low: 900,
};

/**
 * One draw call's worth of nodes: a single category AND a single geometry tier.
 *
 * Category alone is not enough to batch by, because depth varies freely within a
 * category and each depth tier needs its own geometry. Splitting on both gives at most
 * `categories x tiers` meshes — around two dozen draw calls rather than 2600, which is
 * still comfortably within budget.
 */
export interface CategoryGroup {
  key: string;
  category: NodeCategory;
  tier: GeometryTier;
  nodes: AstNode[];
  /** Index into the full node array, so edges can still be resolved after filtering. */
  indices: number[];
}

export interface PreparedGraph {
  graph: AstGraph;
  /** Nodes kept after the quality cap, grouped for one InstancedMesh per category (§4.4). */
  groups: CategoryGroup[];
  /** Flat position pairs for a single LineSegments BufferGeometry (§4.4). */
  edgePositions: Float32Array;
  /** Camera target per focus item — centroid of that section's AST cluster (§4.3, §5). */
  clusterTargets: Vector3[];
  visibleIds: Set<string>;
  /** Visible nodes by id — the lookup table tree traversal walks. */
  nodesById: Map<string, AstNode>;
}

export function useAstGraph(): PreparedGraph | null {
  const [graph, setGraph] = useState<AstGraph | null>(null);
  const quality = useSceneStore((s) => s.quality);
  const maxDepth = useSceneStore((s) => s.maxDepth);

  useEffect(() => {
    let cancelled = false;

    const url = `${import.meta.env.BASE_URL}ast-graph.json`;

    void fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`ast-graph.json: HTTP ${response.status}`);
        return response.json();
      })
      .then((json: unknown) => {
        // Validated at build time too (§4.2), but a stale cached artifact from an older
        // schema version would otherwise fail deep inside the render loop.
        const parsed = astGraphSchema.parse(json);
        if (!cancelled) setGraph(parsed);
      })
      .catch((error: unknown) => {
        // The scene is decorative (§4.7) — a missing graph degrades to no scene, never
        // to a broken page.
        console.error('AST scene unavailable:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    if (!graph) return null;

    const cap = NODE_CAP[quality];

    // The depth filter applies BEFORE the quality cap, so lowering depth frees budget
    // for the levels that remain rather than simply removing nodes from the view.
    const withinDepth = graph.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.depth <= maxDepth);

    /**
     * §4.5 — the default view shows high-level nodes. When the cap bites, shallow nodes
     * win, so what's dropped is leaf detail rather than structural skeleton. Ties break
     * on original index to keep the result stable across renders.
     */
    const ranked = withinDepth
      .sort((a, b) => a.node.depth - b.node.depth || a.index - b.index)
      .slice(0, cap);

    const visibleIndices = new Set(ranked.map((entry) => entry.index));
    const visibleIds = new Set(ranked.map((entry) => entry.node.id));

    const byBatch = new Map<string, CategoryGroup>();
    for (const { node, index } of ranked) {
      const tier = tierForDepth(node.depth);
      const key = `${node.category}:${tier.id}`;
      let group = byBatch.get(key);
      if (!group) {
        group = { key, category: node.category, tier, nodes: [], indices: [] };
        byBatch.set(key, group);
      }
      group.nodes.push(node);
      group.indices.push(index);
    }

    // §4.4 — one flat buffer for every edge, not one Line component per edge.
    const kept = graph.edges.filter(
      ([from, to]) => visibleIndices.has(from) && visibleIndices.has(to),
    );
    const edgePositions = new Float32Array(kept.length * 6);
    kept.forEach(([from, to], i) => {
      const a = graph.nodes[from]?.position;
      const b = graph.nodes[to]?.position;
      if (!a || !b) return;
      edgePositions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });

    return {
      graph,
      groups: [...byBatch.values()],
      edgePositions,
      clusterTargets: computeClusterTargets(graph),
      visibleIds,
      // Traversal needs random access by id; building it once here beats a find() per step.
      nodesById: new Map(ranked.map(({ node }) => [node.id, node])),
    };
  }, [graph, quality, maxDepth]);
}

/**
 * §4.3 — "the mapping from content item to AST cluster is a real structural fact about
 * the codebase, not a hand-placed camera waypoint."
 *
 * Each section names a source path; its camera target is the centroid of every node
 * generated from that path. Add a file to src/scene/ and the Projects camera target
 * moves on its own.
 */
function computeClusterTargets(graph: AstGraph): Vector3[] {
  return SECTIONS.map((section) => {
    const members = graph.nodes.filter((node) => node.fileName.startsWith(section.clusterPath));
    if (members.length === 0) return new Vector3(0, 0, 0);

    const sum = members.reduce(
      (acc, node) => {
        acc.x += node.position.x;
        acc.y += node.position.y;
        acc.z += node.position.z;
        return acc;
      },
      { x: 0, y: 0, z: 0 },
    );

    return new Vector3(sum.x / members.length, sum.y / members.length, sum.z / members.length);
  });
}