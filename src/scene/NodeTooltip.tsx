import { useMemo, type ReactNode } from 'react';
import { Html } from '@react-three/drei';

import { useSceneStore } from '../store/sceneStore.ts';
import type { AstGraph } from '../ast-pipeline/schema.ts';
import styles from './NodeTooltip.module.css';

/**
 * §4.6 — hover: the LIGHTWEIGHT level of interaction, deliberately kept separate from
 * the pop-out Code Inspector so it stays lightweight.
 *
 * A small drei <Html> tooltip anchored to the node's baked 3D position, showing just the
 * kind and a one-line preview (`FunctionDeclaration · renderProjectCard`). Cheap,
 * ephemeral, gone the moment the pointer moves off. It never loads a snippet — that's
 * the panel's job.
 */

interface NodeTooltipProps {
  graph: AstGraph;
}

export function NodeTooltip({ graph }: NodeTooltipProps): ReactNode {
  const hoveredNodeId = useSceneStore((s) => s.hoveredNodeId);

  const node = useMemo(
    () => (hoveredNodeId ? graph.nodes.find((n) => n.id === hoveredNodeId) : undefined),
    [hoveredNodeId, graph.nodes],
  );

  if (!node) return null;

  return (
    <Html
      position={[node.position.x, node.position.y, node.position.z]}
      center
      // The tooltip is a hover affordance for pointer users; the same information is
      // available in the inspector panel, which is the accessible path (§4.6, §9).
      wrapperClass={styles.wrapper ?? ''}
      zIndexRange={[10, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div className={styles.tooltip} aria-hidden="true">
        <span className={styles.kind} data-category={node.category}>
          {node.kind}
        </span>
        {node.label ? <span className={styles.label}>· {node.label}</span> : null}
        <span className={styles.file}>{node.fileName}</span>
      </div>
    </Html>
  );
}
