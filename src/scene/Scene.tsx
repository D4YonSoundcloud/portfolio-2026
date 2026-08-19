import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Vector3 } from 'three';
import { PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

import { AstEdges } from './AstEdges.tsx';
import { AstNodes } from './AstNodes.tsx';
import { CameraRig } from './CameraRig.tsx';
import { NodeTooltip } from './NodeTooltip.tsx';
import { SelectionOverlay } from './SelectionOverlay.tsx';
import { TreeTraversal } from './TreeTraversal.tsx';
import { readPalette } from './palette.ts';
import { useAstGraph } from './useAstGraph.ts';
import { useSceneStore } from '../store/sceneStore.ts';

/**
 * §3 — top-level <Canvas> contents.
 *
 * Everything here reads from the Zustand store rather than props passed across the
 * Canvas boundary (§3, §6): the two render trees share state exclusively through the
 * store, never through prop drilling or Context.
 */
export function Scene(): ReactNode {
  const prepared = useAstGraph();
  const resolvedTheme = useSceneStore((s) => s.resolvedTheme);
  const quality = useSceneStore((s) => s.quality);
  const setQuality = useSceneStore((s) => s.setQuality);
  const inspectorNodeId = useSceneStore((s) => s.inspectorNodeId);

  // Re-read on theme change only — getComputedStyle forces a style recalc and must
  // never run in the frame loop (§7.2).
  const [palette, setPalette] = useState(() => readPalette(resolvedTheme));
  useEffect(() => {
    setPalette(readPalette(resolvedTheme));
  }, [resolvedTheme]);

  // Position of the node open in the inspector, so the camera can frame it clear of
  // the panel. Null whenever the panel is closed.
  const inspectTarget = useMemo(() => {
    if (!prepared || !inspectorNodeId) return null;
    const node = prepared.graph.nodes.find((n) => n.id === inspectorNodeId);
    return node ? new Vector3(node.position.x, node.position.y, node.position.z) : null;
  }, [prepared, inspectorNodeId]);

  if (!prepared) return null;

  return (
    <>
      {/* §4.4 — lit minimally: one ambient plus one point light. The nodes' emissive
          does most of the work on dark; on light the ambient carries it. */}
      <ambientLight intensity={palette.theme === 'dark' ? 0.7 : 1.15} />
      <pointLight position={[30, 40, 50]} intensity={palette.theme === 'dark' ? 1.1 : 0.5} />
      <fog attach="fog" args={[palette.fog.getHex(), 20, 190]} />

      <CameraRig clusterTargets={prepared.clusterTargets} inspectTarget={inspectTarget} />

      <AstEdges positions={prepared.edgePositions} palette={palette} />

      {prepared.groups.map((group) => (
        // Keyed by category:tier — one mesh per batch (see useAstGraph).
        <AstNodes key={group.key} group={group} palette={palette} />
      ))}

      <NodeTooltip graph={prepared.graph} />

      {/* Selection gets its own shape language, not just a brighter node. */}
      <SelectionOverlay graph={prepared.graph} palette={palette} />

      {/* Wheel walks the tree while the inspector is open. Renders nothing. */}
      <TreeTraversal nodesById={prepared.nodesById} />

      {/*
        §8.3 — PerformanceMonitor fine-tunes upward from the boot-seeded quality tier
        rather than starting high and downgrading after a janky first few seconds.
      */}
      <PerformanceMonitor
        onIncline={() => setQuality(quality === 'low' ? 'medium' : 'high')}
        onDecline={() => setQuality(quality === 'high' ? 'medium' : 'low')}
      />

      {/*
        §4.4 / §7.2 — the render pipeline is theme-conditional, not a colour swap.
        Bloom is inherently a dark-background effect: on light it reads as a rendering
        mistake rather than an accent, so the whole pass is replaced.
        §8.3 — postprocessing is disproportionately expensive on mobile GPUs relative to
        the payoff, so the low tier skips the composer entirely.
      */}
      {quality !== 'low' ? (
        <EffectComposer enableNormalPass={false}>
          {palette.useBloom ? (
            <Bloom
              // Threshold raised from 0.32: the glass material's Fresnel rims are bright
              // at grazing angles on every one of ~2600 nodes, and at the old threshold
              // the whole cloud blooms into a haze instead of the rims reading as edges.
              intensity={0.32}
              luminanceThreshold={0.1}
              luminanceSmoothing={0.9}
              mipmapBlur
            />
          ) : (
            // Light theme: a quiet vignette in place of bloom, so the linework at the
            // edges recedes without any glow.
            <Vignette offset={0.35} darkness={0.28} />
          )}
        </EffectComposer>
      ) : null}
    </>
  );
}