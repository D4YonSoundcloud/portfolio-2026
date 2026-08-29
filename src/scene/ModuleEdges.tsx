import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  NormalBlending,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type IUniform,
} from 'three';

import type { AstGraph } from '../ast-pipeline/schema.ts';
import type { ScenePalette } from './palette.ts';
import { useSceneConfig } from './sceneConfig.ts';
import { readSceneStore } from '../store/sceneStore.ts';

/**
 * Imports between this project's own source files, drawn as arcs between file roots.
 *
 * ── Why these cannot look like the AST edges ─────────────────────────────────────────
 * `AstEdges` draws parent→child containment: thousands of short straight segments inside
 * a cluster. These are a different KIND of fact — a handful of long-range dependencies
 * between clusters — and if the two layers shared a visual language the import graph
 * would read as stray AST edges that had escaped their cluster.
 *
 * Four things separate them, because colour alone would not:
 *
 *   1. CURVATURE. Arcs bulge away from the world origin, so they arch over the node
 *      cloud instead of tunnelling through it. Silhouette is the strongest signal
 *      available, and it also keeps long edges from spearing unrelated clusters.
 *   2. MOTION. A pulse travels importer → imported. Direction is real information that a
 *      straight undirected segment cannot express, and movement separates this layer
 *      from the static linework instantly.
 *   3. COLOUR. Its own theme token (`--scene-module-edge`), tunable per theme.
 *   4. FOCUS RESPONSE. Arcs touching the hovered or inspected node's file brighten while
 *      the rest recede, so the layer answers "what does this file touch?" rather than
 *      being decoration.
 *
 * ── Why the curve is evaluated in the vertex shader ──────────────────────────────────
 * Each vertex carries its arc's two endpoints and its own position along the curve; arc
 * height is a uniform. So dragging the arc-height slider is a uniform write rather than
 * a rebuild of every curve on the CPU, which is what keeps this consistent with the rest
 * of the editor. The geometry is rebuilt only when the SEGMENT COUNT changes, since that
 * genuinely alters the vertex count.
 *
 * ── The one honest limitation ────────────────────────────────────────────────────────
 * WebGL ignores `linewidth`, so these are 1px like the AST edges. Real thickness needs
 * `Line2` or ribbon geometry, both of which cost a lot more than one draw call.
 * Curvature, colour and motion carry the distinction instead.
 */

interface ModuleEdgesProps {
  graph: AstGraph;
  palette: ScenePalette;
}

interface ModuleEdgeUniforms {
  uColor: IUniform<Color>;
  uTime: IUniform<number>;
  uArcHeight: IUniform<number>;
  uOpacity: IUniform<number>;
  uFocusOpacity: IUniform<number>;
  uEndFade: IUniform<number>;
  uPulseSpeed: IUniform<number>;
  uPulseLength: IUniform<number>;
  uPulseGain: IUniform<number>;
  /** Index into `graph.files` of the file to emphasise, or -1 for none. */
  uFocusedFile: IUniform<number>;
  [name: string]: IUniform<unknown>;
}

const VERTEX = /* glsl */ `
attribute vec3 aEnd;
/** Position along this arc, 0 at the importer and 1 at the imported file. */
attribute float aT;
/** (importing file index, imported file index) into graph.files. */
attribute vec2 aFiles;
/** Per-arc phase offset, so pulses do not march in lockstep. */
attribute float aSeed;

uniform float uArcHeight;
uniform float uFocusedFile;

varying float vT;
varying float vSeed;
varying float vFocused;

void main() {
  vec3 start = position;
  vec3 end = aEnd;
  vec3 mid = ( start + end ) * 0.5;

  /*
   * Bulge AWAY FROM THE WORLD ORIGIN.
   *
   * The clusters sit around the origin, so pushing the control point outward makes each
   * arc arch over the cloud rather than through it. A fixed 'up' bulge would look
   * plausible from one angle and pass straight through unrelated clusters from any
   * other, which matters because the camera drifts continuously.
   */
  vec3 outward = length( mid ) > 0.001 ? normalize( mid ) : vec3( 0.0, 1.0, 0.0 );
  vec3 control = mid + outward * length( end - start ) * uArcHeight;

  // Quadratic Bezier.
  float t = aT;
  float inv = 1.0 - t;
  vec3 curved = inv * inv * start + 2.0 * inv * t * control + t * t * end;

  vT = t;
  vSeed = aSeed;
  // Compared on the GPU so changing focus costs a single uniform write rather than a
  // rewrite of a per-vertex attribute buffer every time the pointer moves.
  vFocused = ( abs( aFiles.x - uFocusedFile ) < 0.5 || abs( aFiles.y - uFocusedFile ) < 0.5 )
    ? 1.0
    : 0.0;

  gl_Position = projectionMatrix * modelViewMatrix * vec4( curved, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uFocusOpacity;
uniform float uEndFade;
uniform float uPulseSpeed;
uniform float uPulseLength;
uniform float uPulseGain;

varying float vT;
varying float vSeed;
varying float vFocused;

void main() {
  // Fade out at both ends so an arc dissolves into its file root instead of terminating
  // in a hard stub against the node's silhouette.
  float fade = smoothstep( 0.0, uEndFade, vT ) * smoothstep( 0.0, uEndFade, 1.0 - vT );

  /*
   * A single bright head travelling from the importer toward the imported file.
   *
   * fract() of (position - time) wraps into a repeating sawtooth; smoothstep over the
   * top slice of that sawtooth carves out a short leading segment. The per-arc seed
   * offsets the phase, without which every arc in the scene would pulse in unison and
   * read as one global flash rather than as many independent dependencies.
   */
  float head = fract( vT - uTime * uPulseSpeed + vSeed );
  float pulse = smoothstep( 1.0 - clamp( uPulseLength, 0.001, 0.999 ), 1.0, head );

  float base = mix( uOpacity, uFocusOpacity, vFocused );
  float alpha = fade * base * ( 1.0 + pulse * uPulseGain );

  gl_FragColor = vec4( uColor * ( 1.0 + pulse * uPulseGain * 0.5 ), alpha );
}
`;

export function ModuleEdges({ graph, palette }: ModuleEdgesProps): ReactNode {
  const geometryRef = useRef<BufferGeometry>(null);
  const config = useSceneConfig();
  const themed = config.themed[palette.theme];
  const segments = Math.max(2, Math.round(config.shared.moduleEdges.segments));

  /** File path -> its root node's baked position, and its index in `graph.files`. */
  const roots = useMemo(() => {
    const byFile = new Map<string, { position: Vector3; index: number }>();
    for (const node of graph.nodes) {
      // Depth 0 is the synthetic per-file root (§4.2) — the only node that stands for
      // the file as a whole, which is what an import actually connects.
      if (node.depth !== 0) continue;
      const index = graph.files.indexOf(node.fileName);
      byFile.set(node.fileName, {
        position: new Vector3(node.position.x, node.position.y, node.position.z),
        index,
      });
    }
    return byFile;
  }, [graph]);

  /**
   * Node id -> index of its file in `graph.files`.
   *
   * Built once because the focus lookup runs in the frame loop, and a `find()` across
   * several thousand nodes every frame is exactly the kind of per-frame linear scan the
   * rest of the scene is written to avoid.
   */
  const fileIndexByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    const fileIndex = new Map(graph.files.map((file, index) => [file, index]));
    for (const node of graph.nodes) {
      map.set(node.id, fileIndex.get(node.fileName) ?? -1);
    }
    return map;
  }, [graph]);

  /**
   * One polyline per arc, packed into a single LineSegments buffer.
   *
   * Interior points are duplicated because `LineSegments` consumes vertices in disjoint
   * pairs; that is what allows many separate polylines to share one draw call, which a
   * single `Line` could not do without joining every arc end-to-end.
   */
  const attributes = useMemo(() => {
    const drawable = graph.moduleEdges.filter(
      (edge) => roots.has(edge.from) && roots.has(edge.to),
    );

    const vertices = drawable.length * segments * 2;
    const start = new Float32Array(vertices * 3);
    const end = new Float32Array(vertices * 3);
    const t = new Float32Array(vertices);
    const files = new Float32Array(vertices * 2);
    const seed = new Float32Array(vertices);

    let v = 0;
    drawable.forEach((edge, edgeIndex) => {
      const from = roots.get(edge.from);
      const to = roots.get(edge.to);
      if (!from || !to) return;

      // Golden-ratio stride rather than Math.random(): spreads phases evenly and stays
      // identical across reloads, so the layer looks the same on every visit.
      const phase = (edgeIndex * 0.6180339887) % 1;

      for (let i = 0; i < segments; i += 1) {
        for (const step of [i / segments, (i + 1) / segments]) {
          start.set([from.position.x, from.position.y, from.position.z], v * 3);
          end.set([to.position.x, to.position.y, to.position.z], v * 3);
          t[v] = step;
          files.set([from.index, to.index], v * 2);
          seed[v] = phase;
          v += 1;
        }
      }
    });

    return {
      count: drawable.length,
      position: new BufferAttribute(start, 3),
      aEnd: new BufferAttribute(end, 3),
      aT: new BufferAttribute(t, 1),
      aFiles: new BufferAttribute(files, 2),
      aSeed: new BufferAttribute(seed, 1),
    };
  }, [graph.moduleEdges, roots, segments]);

  const dark = palette.theme === 'dark';

  const material = useMemo(() => {
    const uniforms: ModuleEdgeUniforms = {
      uColor: { value: palette.moduleEdge.clone() },
      uTime: { value: 0 },
      uArcHeight: { value: config.shared.moduleEdges.arcHeight },
      uOpacity: { value: themed.moduleEdges.opacity },
      uFocusOpacity: { value: themed.moduleEdges.focusOpacity },
      uEndFade: { value: config.shared.moduleEdges.endFade },
      uPulseSpeed: { value: config.shared.moduleEdges.pulseSpeed },
      uPulseLength: { value: config.shared.moduleEdges.pulseLength },
      uPulseGain: { value: themed.moduleEdges.pulseGain },
      uFocusedFile: { value: -1 },
    };

    return new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      transparent: true,
      // Same reasoning as the AST edges and the selection overlay: additive on dark reads
      // as light, and on the light theme it reads as an error, so it is swapped rather
      // than recoloured (§7.2).
      blending: dark ? AdditiveBlending : NormalBlending,
      depthWrite: false,
      toneMapped: dark,
      side: DoubleSide,
    });
    // Rebuilt per theme only. Every value above is a uniform, so config changes are
    // pushed in the effect below rather than by recompiling the shader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette.moduleEdge, dark]);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const uniforms = material.uniforms as ModuleEdgeUniforms;
    uniforms.uColor.value.copy(palette.moduleEdge);
    uniforms.uArcHeight.value = config.shared.moduleEdges.arcHeight;
    uniforms.uEndFade.value = config.shared.moduleEdges.endFade;
    uniforms.uPulseSpeed.value = config.shared.moduleEdges.pulseSpeed;
    uniforms.uPulseLength.value = config.shared.moduleEdges.pulseLength;
    uniforms.uOpacity.value = themed.moduleEdges.opacity;
    uniforms.uFocusOpacity.value = themed.moduleEdges.focusOpacity;
    uniforms.uPulseGain.value = themed.moduleEdges.pulseGain;
  }, [material, palette.moduleEdge, config.shared.moduleEdges, themed.moduleEdges]);

  useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    geometry.setAttribute('position', attributes.position);
    geometry.setAttribute('aEnd', attributes.aEnd);
    geometry.setAttribute('aT', attributes.aT);
    geometry.setAttribute('aFiles', attributes.aFiles);
    geometry.setAttribute('aSeed', attributes.aSeed);
    geometry.computeBoundingSphere();
  }, [attributes]);

  useFrame((state) => {
    const uniforms = material.uniforms as ModuleEdgeUniforms;
    const { hoveredNodeId, inspectorNodeId, reducedMotion } = readSceneStore();

    // Frozen rather than merely slowed under reduced motion (§4.7). The arcs stay fully
    // legible; only the travelling highlight stops.
    if (!reducedMotion) uniforms.uTime.value = state.clock.elapsedTime;

    // Hover wins over the inspector: it is the more immediate intent, and it lets you
    // sweep the field to trace dependencies while a panel stays open.
    const activeId = hoveredNodeId ?? inspectorNodeId;
    uniforms.uFocusedFile.value = activeId ? (fileIndexByNodeId.get(activeId) ?? -1) : -1;
  });

  if (attributes.count === 0) return null;

  return (
    <lineSegments frustumCulled={false} material={material}>
      <bufferGeometry ref={geometryRef} />
    </lineSegments>
  );
}