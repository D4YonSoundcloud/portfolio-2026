import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimLink,
  type SimNode,
} from 'd3-force-3d';

/**
 * §4.3 — Layout.
 *
 * The simulation runs ONCE, here, at build time. The resulting {x, y, z} is baked into
 * `ast-graph.json` and the runtime bundle only ever reads positions. A naive tree layout
 * (Reingold–Tilford) reads like an org chart; link/charge/center forces give the
 * organic, constellation-like clustering the scene is after.
 */

export interface LayoutInput {
  id: string;
  parentIndex: number | null;
  depth: number;
  /** True for the synthetic per-file root nodes. */
  isFileRoot: boolean;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface LayoutNode extends SimNode {
  id: string;
  isFileRoot: boolean;
  depth: number;
}

/**
 * Deterministic PRNG (mulberry32). d3-force seeds from `Math.random` by default, which
 * would make every build produce a different layout — and therefore a different diff on
 * a committed artifact and a different visual on every deploy. A fixed seed means the
 * scene is reproducible and a layout change is always a real change.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LayoutOptions {
  /** Simulation ticks. More is tighter clustering; 300 is well past visual convergence. */
  ticks?: number;
  seed?: number;
  /** Final coordinates are scaled to roughly this radius, so camera distances are stable. */
  targetRadius?: number;
}

export function computeLayout(
  input: readonly LayoutInput[],
  options: LayoutOptions = {},
): Vec3[] {
  const { ticks = 300, seed = 0x5eed, targetRadius = 60 } = options;

  if (input.length === 0) return [];

  const random = seededRandom(seed);

  const nodes: LayoutNode[] = input.map((n) => ({
    id: n.id,
    isFileRoot: n.isFileRoot,
    depth: n.depth,
  }));

  const links: SimLink<LayoutNode>[] = [];
  input.forEach((n, i) => {
    if (n.parentIndex !== null) {
      links.push({ source: n.parentIndex, target: i });
    }
  });

  const simulation = forceSimulation<LayoutNode>(nodes, 3)
    .randomSource(random)
    .alphaDecay(0.0228)
    .velocityDecay(0.4)
    .force(
      'link',
      forceLink<LayoutNode, SimLink<LayoutNode>>(links)
        // Edges near the root are longer, so top-level structure spreads out and deep
        // subtrees stay compact instead of everything sitting at one uniform spacing.
        .distance((link) => {
          const target = link.target as LayoutNode;
          return Math.max(4, 26 - (target.depth ?? 0) * 3);
        })
        .strength(0.7)
        .iterations(2),
    )
    .force(
      'charge',
      // §4.3 tuning note: per-file synthetic roots get a much stronger repulsive charge
      // than individual declarations, so files separate into legible clusters instead of
      // the whole graph collapsing into one dense blob.
      forceManyBody<LayoutNode>()
        .strength((node) => (node.isFileRoot ? -420 : -34))
        .distanceMax(240)
        .theta(0.9),
    )
    .force('center', forceCenter<LayoutNode>(0, 0, 0).strength(0.06));

  simulation.tick(ticks);
  simulation.stop();

  return normalize(nodes, targetRadius);
}

/**
 * Recentres on the origin and scales so the graph occupies a predictable volume. Without
 * this, adding files would slowly change the graph's overall extent and every camera
 * distance in the scene would need retuning.
 */
function normalize(nodes: readonly LayoutNode[], targetRadius: number): Vec3[] {
  const raw = nodes.map<Vec3>((n) => ({
    x: Number.isFinite(n.x) ? (n.x as number) : 0,
    y: Number.isFinite(n.y) ? (n.y as number) : 0,
    z: Number.isFinite(n.z) ? (n.z as number) : 0,
  }));

  const centroid = raw.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 },
  );
  centroid.x /= raw.length;
  centroid.y /= raw.length;
  centroid.z /= raw.length;

  const centred = raw.map((p) => ({
    x: p.x - centroid.x,
    y: p.y - centroid.y,
    z: p.z - centroid.z,
  }));

  let maxRadius = 0;
  for (const p of centred) {
    maxRadius = Math.max(maxRadius, Math.hypot(p.x, p.y, p.z));
  }

  const scale = maxRadius > 0 ? targetRadius / maxRadius : 1;

  return centred.map((p) => ({
    x: round(p.x * scale),
    y: round(p.y * scale),
    z: round(p.z * scale),
  }));
}

/** Three decimals is well below visual tolerance and keeps the JSON payload small. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
