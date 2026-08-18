import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { BufferAttribute } from 'three';
import type { BufferGeometry } from 'three';

import type { ScenePalette } from './palette.ts';

/**
 * §4.4 — Edges.
 *
 * A single `THREE.LineSegments` built from ONE flat BufferGeometry containing position
 * pairs for every parent→child edge — not individual <Line> components per edge. Same
 * draw-call reasoning as the instanced nodes.
 *
 * On the light theme these are the primary visual element: §7.2 renders the AST as fine
 * technical linework rather than glowing points, so edges carry more opacity and nodes
 * shrink (`--scene-node-scale`).
 */

interface AstEdgesProps {
  positions: Float32Array;
  palette: ScenePalette;
}

export function AstEdges({ positions, palette }: AstEdgesProps): ReactNode {
  const geometryRef = useRef<BufferGeometry>(null);

  const attribute = useMemo(() => new BufferAttribute(positions, 3), [positions]);

  useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    geometry.setAttribute('position', attribute);
    geometry.computeBoundingSphere();
  }, [attribute]);

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geometryRef} />
      <lineBasicMaterial
        color={palette.theme === 'dark' ? palette.categories.Import : palette.categories.Expression}
        transparent
        opacity={palette.edgeOpacity}
        depthWrite={false}
        toneMapped={palette.theme === 'dark'}
      />
    </lineSegments>
  );
}
