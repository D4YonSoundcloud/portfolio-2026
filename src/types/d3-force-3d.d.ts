/**
 * `d3-force-3d` ships no bundled types and has no `@types/d3-force-3d` on npm, so we
 * declare the narrow surface this project actually uses rather than reaching for `any`.
 */
declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimLink<N extends SimNode = SimNode> {
    source: number | string | N;
    target: number | string | N;
    index?: number;
  }

  export interface Force<N extends SimNode> {
    (alpha: number): void;
    initialize?(nodes: N[], random?: () => number, numDimensions?: number): void;
  }

  export interface LinkForce<N extends SimNode, L extends SimLink<N>> extends Force<N> {
    links(): L[];
    links(links: L[]): this;
    id(fn: (node: N, i: number, nodes: N[]) => string | number): this;
    distance(value: number | ((link: L, i: number, links: L[]) => number)): this;
    strength(value: number | ((link: L, i: number, links: L[]) => number)): this;
    iterations(value: number): this;
  }

  export interface ManyBodyForce<N extends SimNode> extends Force<N> {
    strength(value: number | ((node: N, i: number, nodes: N[]) => number)): this;
    distanceMin(value: number): this;
    distanceMax(value: number): this;
    theta(value: number): this;
  }

  export interface CenterForce<N extends SimNode> extends Force<N> {
    x(value: number): this;
    y(value: number): this;
    z(value: number): this;
    strength(value: number): this;
  }

  export interface Simulation<N extends SimNode> {
    nodes(): N[];
    nodes(nodes: N[]): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
    numDimensions(value: number): this;
    alpha(value: number): this;
    alphaMin(value: number): this;
    alphaDecay(value: number): this;
    alphaTarget(value: number): this;
    velocityDecay(value: number): this;
    randomSource(source: () => number): this;
    tick(iterations?: number): this;
    stop(): this;
    restart(): this;
  }

  export function forceSimulation<N extends SimNode>(
    nodes?: N[],
    numDimensions?: number,
  ): Simulation<N>;

  export function forceLink<N extends SimNode, L extends SimLink<N>>(
    links?: L[],
  ): LinkForce<N, L>;

  export function forceManyBody<N extends SimNode>(): ManyBodyForce<N>;

  export function forceCenter<N extends SimNode>(
    x?: number,
    y?: number,
    z?: number,
  ): CenterForce<N>;
}
