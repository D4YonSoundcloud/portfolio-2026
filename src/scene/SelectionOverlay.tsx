import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, NormalBlending, Vector3, type Group, type Mesh } from 'three';

import type { AstGraph } from '../ast-pipeline/schema.ts';
import type { ScenePalette } from './palette.ts';
import { readSceneConfig, useSceneConfig } from './sceneConfig.ts';
import { readSceneStore, useSceneStore } from '../store/sceneStore.ts';

/**
 * The selected node's overlay.
 *
 * Hover and selection must not look like the same effect at two intensities — if they
 * do, opening the inspector feels disconnected from the node that was clicked. Hover
 * lives entirely in the instanced material (brighter rim, slight swell). Selection adds
 * something the instanced batch structurally cannot: a different SHAPE.
 *
 * Two objects, one draw call each, both only mounted while something is selected:
 *   - a billboarded ring, which reads as a targeting reticle rather than a brighter node
 *   - a faceted shell around the node, slow-spinning, giving it visible volume
 *
 * A single extra mesh is also where real refraction becomes affordable later: a
 * `MeshPhysicalMaterial` with `transmission` renders a backdrop pass per frame, which is
 * hopeless across 2600 instances but trivial for one. Gate it on `quality === 'high'`
 * if you want the hero node to genuinely refract what's behind it.
 */

interface SelectionOverlayProps {
  graph: AstGraph;
  palette: ScenePalette;
}

export function SelectionOverlay({ graph, palette }: SelectionOverlayProps): ReactNode {
  const inspectorNodeId = useSceneStore((s) => s.inspectorNodeId);
  const groupRef = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const shellRef = useRef<Mesh>(null);
  const scale = useRef(0);

  // Geometry args are React props, so these come through the subscribing hook; the spin
  // rates and grow attack are read per-frame instead.
  const config = useSceneConfig();
  const themed = config.themed[palette.theme];
  const { ringInner, ringOuter, shellRadius } = config.shared.selection;

  const node = useMemo(
    () => (inspectorNodeId ? graph.nodes.find((n) => n.id === inspectorNodeId) : undefined),
    [inspectorNodeId, graph.nodes],
  );

  const position = useMemo(
    () => (node ? new Vector3(node.position.x, node.position.y, node.position.z) : null),
    [node],
  );

  const color = node ? palette.categories[node.category] : palette.categories.Declaration;
  const dark = palette.theme === 'dark';

  // Reset so a newly selected node scales in from nothing rather than teleporting the
  // previous one's ring across the scene.
  useEffect(() => {
    scale.current = 0;
  }, [inspectorNodeId]);

  useFrame(({ camera, clock }, delta) => {
    const group = groupRef.current;
    if (!group || !position) return;

    const { selection } = readSceneConfig().shared;

    group.position.copy(position);
    // Billboard the ring only — the shell reads better with its own rotation.
    ringRef.current?.quaternion.copy(camera.quaternion);

    if (shellRef.current) {
      const { reducedMotion } = readSceneStore();
      if (!reducedMotion) {
        shellRef.current.rotation.y = clock.elapsedTime * selection.spinY;
        shellRef.current.rotation.x = clock.elapsedTime * selection.spinX;
      }
    }

    scale.current += (1 - scale.current) * Math.min(1, delta / selection.growAttack);
    group.scale.setScalar(scale.current);
  });

  if (!position) return null;

  return (
    <group ref={groupRef}>
      <mesh ref={ringRef}>
        {/* Inner is clamped below outer: the editor can drag them past each other, and
            an inverted ring renders as an invisible degenerate annulus. */}
        <ringGeometry args={[Math.min(ringInner, ringOuter - 0.01), ringOuter, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={themed.selection.ringOpacity}
          blending={dark ? AdditiveBlending : NormalBlending}
          depthWrite={false}
          depthTest={false}
          toneMapped={dark}
        />
      </mesh>

      <mesh ref={shellRef}>
        <icosahedronGeometry args={[shellRadius, 0]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={themed.selection.shellOpacity}
          blending={dark ? AdditiveBlending : NormalBlending}
          depthWrite={false}
          toneMapped={dark}
        />
      </mesh>
    </group>
  );
}