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
import { EnvironmentBaker } from './EnvironmentBaker.tsx';
import { useEnvPreviewEnabled, useEnvPreviewExposure } from './envStore.ts';
import { readPalette } from './palette.ts';
import { useSceneConfig } from './sceneConfig.ts';
import { useAstGraph } from './useAstGraph.ts';
import { useSceneStore } from '../store/sceneStore.ts';

/**
 * §3 — top-level <Canvas> contents.
 *
 * Everything here reads from the Zustand store rather than props passed across the
 * Canvas boundary (§3, §6): the two render trees share state exclusively through the
 * store, never through prop drilling or Context.
 *
 * Numeric render inputs come from `sceneConfig.ts` rather than being written inline as
 * JSX props, so they are discoverable in one place and editable at runtime by the dev
 * editor. In production the config is a frozen constant and this is a plain read.
 */
export function Scene(): ReactNode {
  const prepared = useAstGraph();
  const resolvedTheme = useSceneStore((s) => s.resolvedTheme);
  const quality = useSceneStore((s) => s.quality);
  const setQuality = useSceneStore((s) => s.setQuality);
  const qualityPinned = useSceneStore((s) => s.qualityPinned);
  const inspectorNodeId = useSceneStore((s) => s.inspectorNodeId);

  const config = useSceneConfig();
  const themed = config.themed[resolvedTheme];
  const shared = config.shared;

  /**
   * Whether the dev editor wants preview readbacks. `readRenderTargetPixels` is a
   * synchronous GPU stall, so it is gated on the panel actually being open. An ordinary
   * unconditional hook — it just always reports false in production, because nothing
   * there ever calls `setEnvPreviewEnabled`.
   */
  const editorPreview = useEnvPreviewEnabled();
  const editorExposure = useEnvPreviewExposure();

  /**
   * Re-read on theme change only — `getComputedStyle` forces a style recalc and must
   * never run in the frame loop (§7.2).
   *
   * `config.revision` joins the dependency list purely for the editor: writing a token
   * override sets an inline custom property on <html>, which the palette has no other
   * way of noticing. The revision is frozen at 0 in production, so this stays a
   * theme-change-only read there.
   */
  const [palette, setPalette] = useState(() => readPalette(resolvedTheme));
  useEffect(() => {
    setPalette(readPalette(resolvedTheme));
  }, [resolvedTheme, config.revision]);

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
      <ambientLight intensity={themed.lights.ambientIntensity} />
      <pointLight
        position={[shared.lights.keyX, shared.lights.keyY, shared.lights.keyZ]}
        intensity={themed.lights.keyIntensity}
      />
      <fog attach="fog" args={[palette.fog.getHex(), shared.fog.near, shared.fog.far]} />

      <CameraRig clusterTargets={prepared.clusterTargets} inspectTarget={inspectTarget} />

      {/*
        Bakes the procedural environment into a PMREM map (§4.4). Renders nothing, and
        must sit inside the Canvas because it needs the renderer. Mounted before the
        nodes so its first bake is queued ahead of their first material build.
      */}
      <EnvironmentBaker
        palette={palette}
        previewEnabled={editorPreview}
        previewExposure={editorExposure}
      />

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

        Skipped entirely while quality is pinned: the editor needs to hold a tier still
        to inspect it, and a monitor that quietly promotes 'low' back to 'high' after
        two smooth seconds makes that impossible. `qualityPinned` is false in every
        normal session.
      */}
      {qualityPinned ? null : (
        <PerformanceMonitor
          onIncline={() => setQuality(quality === 'low' ? 'medium' : 'high')}
          onDecline={() => setQuality(quality === 'high' ? 'medium' : 'low')}
        />
      )}

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
              intensity={themed.bloom.intensity}
              luminanceThreshold={themed.bloom.threshold}
              luminanceSmoothing={themed.bloom.smoothing}
              mipmapBlur
            />
          ) : (
            // Light theme: a quiet vignette in place of bloom, so the linework at the
            // edges recedes without any glow.
            <Vignette offset={themed.vignette.offset} darkness={themed.vignette.darkness} />
          )}
        </EffectComposer>
      ) : null}
    </>
  );
}