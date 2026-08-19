import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { InstancedBufferAttribute, Matrix4, Object3D, Vector3 } from 'three';
import type { BufferGeometry, InstancedMesh } from 'three';

import type { CategoryGroup } from './useAstGraph.ts';
import type { ScenePalette } from './palette.ts';
import { createNodeMaterial } from './NodeMaterial.ts';
import { detailForQuality } from './geometryTiers.ts';
import { isUiTarget } from './pointerGuard.ts';
import { readSceneStore, useSceneStore } from '../store/sceneStore.ts';

/**
 * §4.4 — Nodes.
 *
 * ONE `THREE.InstancedMesh` per `NodeCategory`, not one mesh per AST node. A tree of a
 * few thousand nodes rendered as individual meshes will tank frame rate; instancing
 * collapses each category to a single draw call.
 *
 * Interaction state (hover / selected) rides along as a per-instance `aState` attribute
 * rather than a separate mesh or a material swap, which is what lets one node in a batch
 * of hundreds light up without breaking that single draw call.
 */

const dummy = new Object3D();
const tempMatrix = new Matrix4();
const tempPosition = new Vector3();

/** §4.5 — deeper nodes fade in only when the camera is near that cluster. */
const LOD_NEAR = 46;
const LOD_FAR = 92;
const SHALLOW_DEPTH = 2;

/** How often the distance-based visibility pass runs. Every frame is wasteful. */
const LOD_INTERVAL_MS = 120;

/** Seconds for a highlight to reach full strength. Snapping looks like a bug. */
const HOVER_ATTACK = 0.14;
const SELECT_ATTACK = 0.22;

/** Below this delta a value is treated as settled and drops out of the animating set. */
const SETTLE_EPSILON = 0.002;

interface AstNodesProps {
  group: CategoryGroup;
  palette: ScenePalette;
}

export function AstNodes({ group, palette }: AstNodesProps): ReactNode {
  const meshRef = useRef<InstancedMesh>(null);
  const geometryRef = useRef<BufferGeometry>(null);
  const lastLod = useRef(0);

  const setHoveredNodeId = useSceneStore((s) => s.setHoveredNodeId);
  const openInspector = useSceneStore((s) => s.openInspector);

  const color = palette.categories[group.category];
  const tier = group.tier;
  const quality = useSceneStore((s) => s.quality);
  const detail = detailForQuality(tier, quality);

  /**
   * The material is rebuilt per theme, not mutated: `onBeforeCompile` bakes uniforms and
   * blend mode into a compiled program, and dark/light differ in both (§7.2).
   */
  const { material, uniforms } = useMemo(
    () => createNodeMaterial(color, palette),
    [color, palette],
  );

  useEffect(() => () => material.dispose(), [material]);

  /** Baked positions, read straight through — no simulation at runtime (§4.3). */
  const positions = useMemo(
    () => group.nodes.map((node) => new Vector3(node.position.x, node.position.y, node.position.z)),
    [group.nodes],
  );

  /**
   * Size now comes from the tier's radius (geometryTiers.ts), so every instance in a
   * batch shares one scale. Kept as an array anyway because the LOD pass writes
   * per-instance matrices and needs a per-instance base to return to.
   */
  const scales = useMemo(() => group.nodes.map(() => 1), [group.nodes]);

  /** Node id -> local instance index, so a store change resolves without scanning. */
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    group.nodes.forEach((node, i) => map.set(node.id, i));
    return map;
  }, [group.nodes]);

  /**
   * Per-instance (hover, selected), each 0→1. Current values are animated toward
   * targets; only indices that are actually moving get visited each frame.
   */
  const state = useMemo(() => {
    const array = new Float32Array(group.nodes.length * 2);
    return {
      array,
      attribute: new InstancedBufferAttribute(array, 2),
      targets: new Float32Array(group.nodes.length * 2),
      /** Indices whose current value has not yet reached its target. */
      animating: new Set<number>(),
    };
  }, [group.nodes.length]);

  useEffect(() => {
    geometryRef.current?.setAttribute('aState', state.attribute);
  }, [state]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    positions.forEach((position, i) => {
      dummy.position.copy(position);
      dummy.scale.setScalar((scales[i] ?? 1) * palette.nodeScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [positions, scales, color, palette.nodeScale]);

  /**
   * Store changes are read here rather than through a subscription, because a hover
   * must never re-render an R3F component — that would rebuild the scene graph on
   * pointer move and throw away the frame budget entirely.
   */
  useFrame((frameState, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { hoveredNodeId, inspectorNodeId } = readSceneStore();

    uniforms.uTime.value = frameState.clock.elapsedTime;
    // Dim the field only while something is actually active (see nodeMaterial: contrast
    // is produced by fading the rest, not by over-brightening the one).
    const anyActive = hoveredNodeId !== null || inspectorNodeId !== null;
    const dimTarget = anyActive ? palette.dim : 1;
    uniforms.uDim.value += (dimTarget - uniforms.uDim.value) * Math.min(1, delta / 0.18);

    // Retarget: only the two ids that can possibly be active are looked up.
    const hoverIndex = hoveredNodeId ? indexById.get(hoveredNodeId) : undefined;
    const selectIndex = inspectorNodeId ? indexById.get(inspectorNodeId) : undefined;

    for (let i = 0; i < group.nodes.length; i += 1) {
      const hoverTarget = i === hoverIndex ? 1 : 0;
      const selectTarget = i === selectIndex ? 1 : 0;
      if (state.targets[i * 2] !== hoverTarget || state.targets[i * 2 + 1] !== selectTarget) {
        state.targets[i * 2] = hoverTarget;
        state.targets[i * 2 + 1] = selectTarget;
        state.animating.add(i);
      }
    }

    if (state.animating.size === 0) return;

    for (const i of state.animating) {
      const hoverCurrent = state.array[i * 2] ?? 0;
      const selectCurrent = state.array[i * 2 + 1] ?? 0;
      const hoverTarget = state.targets[i * 2] ?? 0;
      const selectTarget = state.targets[i * 2 + 1] ?? 0;

      const nextHover =
        hoverCurrent + (hoverTarget - hoverCurrent) * Math.min(1, delta / HOVER_ATTACK);
      const nextSelect =
        selectCurrent + (selectTarget - selectCurrent) * Math.min(1, delta / SELECT_ATTACK);

      const settled =
        Math.abs(hoverTarget - nextHover) < SETTLE_EPSILON &&
        Math.abs(selectTarget - nextSelect) < SETTLE_EPSILON;

      state.array[i * 2] = settled ? hoverTarget : nextHover;
      state.array[i * 2 + 1] = settled ? selectTarget : nextSelect;

      if (settled) state.animating.delete(i);
    }

    state.attribute.needsUpdate = true;
  });

  /**
   * §4.5 — "distance-based visibility toggle on the instanced mesh, recomputed per frame
   * but cheaply — a distance check, not a re-layout." Throttled further, since a node's
   * visibility can't meaningfully change in 8ms.
   */
  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const now = clock.elapsedTime * 1000;
    if (now - lastLod.current < LOD_INTERVAL_MS) return;
    lastLod.current = now;

    let changed = false;
    for (let i = 0; i < positions.length; i += 1) {
      const node = group.nodes[i];
      const position = positions[i];
      if (!node || !position) continue;

      const baseScale = (scales[i] ?? 1) * palette.nodeScale;
      let target = baseScale;

      if (node.depth > SHALLOW_DEPTH) {
        const distance = camera.position.distanceTo(position);
        // Smoothstep between near and far rather than a hard pop.
        const t = 1 - Math.min(1, Math.max(0, (distance - LOD_NEAR) / (LOD_FAR - LOD_NEAR)));
        target = baseScale * (t * t * (3 - 2 * t));
      }

      mesh.getMatrixAt(i, tempMatrix);
      const current = tempPosition.setFromMatrixScale(tempMatrix).x;
      if (Math.abs(current - target) < 0.01) continue;

      dummy.position.copy(position);
      dummy.scale.setScalar(target);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      changed = true;
    }

    if (changed) mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, group.nodes.length]}
      material={material}
      frustumCulled={false}
      // §4.6 — hover uses R3F's built-in raycasting against the instanced mesh.
      onPointerOver={(event) => {
        // Coarse pointers have no hover state; skip the work entirely (§8.2).
        if (readSceneStore().isCoarsePointer) return;
        // Chrome wins: hovering a button must not also light up a node behind it.
        if (isUiTarget(event.nativeEvent)) return;
        event.stopPropagation();
        const node = group.nodes[event.instanceId ?? -1];
        if (node) setHoveredNodeId(node.id);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHoveredNodeId(null);
      }}
      onClick={(event) => {
        // Chrome wins: clicking a control must never also select the node behind it.
        if (isUiTarget(event.nativeEvent)) return;
        event.stopPropagation();
        const node = group.nodes[event.instanceId ?? -1];
        if (node) openInspector(node.id);
      }}
    >
      {/*
        Geometry is chosen by tree depth (geometryTiers.ts): dense faceted polyhedra at
        the root, resolving to tetrahedra at the leaves. Facets matter here — flat faces
        give the Fresnel and refraction terms hard edges to catch, which is what reads
        as cut glass. A smooth sphere would lose the effect entirely.
      */}
      {tier.kind === 'icosahedron' ? (
        <icosahedronGeometry ref={geometryRef} args={[tier.radius, detail]} />
      ) : tier.kind === 'octahedron' ? (
        <octahedronGeometry ref={geometryRef} args={[tier.radius, detail]} />
      ) : (
        <tetrahedronGeometry ref={geometryRef} args={[tier.radius, detail]} />
      )}
    </instancedMesh>
  );
}