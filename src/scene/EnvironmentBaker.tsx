import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import type { MeshPhysicalMaterial } from 'three';

import { EnvBaker } from './envBaker.ts';
import { createNodeMaterial } from './nodeMaterial.ts';
import { setEnvMap, setEnvPreview } from './envStore.ts';
import type { ScenePalette } from './palette.ts';
import { useSceneConfig } from './sceneConfig.ts';

/**
 * Drives the environment bake. Renders nothing.
 *
 * ── The scheduling, which is the whole point ─────────────────────────────────────────
 * A bake is two stages with wildly different costs, so they are scheduled differently:
 *
 *   bakeSource   one fullscreen quad, sub-millisecond   → runs immediately on any change
 *   prefilter    PMREM blur chain, 5–15ms               → trailing edge only
 *
 * 5–15ms is the entire frame budget. Running the prefilter on every slider tick would
 * make dragging feel broken, and the irony is that it is the CHEAP stage you actually
 * watch — the source is what feeds the editor's preview. So the source updates live, the
 * preview updates live with it, and the env map the nodes actually sample catches up on
 * a trailing edge. In production none of this matters: config never changes, so the
 * whole thing runs exactly once.
 *
 * ── Progressive enhancement ──────────────────────────────────────────────────────────
 * `envMap` starts null and the node material falls back to evaluating the pattern per
 * fragment (see `nodeMaterial.ts`). So the first frame is correct-looking rather than
 * black, and the baked map is an upgrade that lands a frame or two later.
 */

/** Trailing-edge delay for the expensive stage. Long enough to coalesce a drag. */
const PREFILTER_DELAY_MS = 120;

interface EnvironmentBakerProps {
  palette: ScenePalette;
  /** Editor-only: skip the readbacks entirely while the preview is collapsed. */
  previewEnabled?: boolean;
  /** Editor-only preview brightness. Display-only, never exported. */
  previewExposure?: number;
}

export function EnvironmentBaker({
  palette,
  previewEnabled = false,
  previewExposure = 1,
}: EnvironmentBakerProps): ReactNode {
  const renderer = useThree((state) => state.gl);
  const config = useSceneConfig();
  const shared = config.shared;

  const baker = useMemo(() => new EnvBaker(renderer), [renderer]);
  useEffect(() => () => baker.dispose(), [baker]);

  const timer = useRef<number | null>(null);

  /**
   * The probe's glass sphere wears a real node material, built here rather than borrowed
   * from an `AstNodes` batch.
   *
   * Borrowing would mean reaching across the tree for a material that may not exist yet,
   * and would tie the probe to whichever category happened to mount first. Building one
   * from the same inputs is self-contained and guaranteed to match. It is one extra
   * material, editor-only, and rebuilt only when the env map or theme changes.
   */
  const probe = useRef<MeshPhysicalMaterial | null>(null);

  useEffect(() => {
    const started = performance.now();

    // Cheap stage — always immediate.
    baker.bakeSource(palette, shared);

    if (__SCENE_EDITOR__ && previewEnabled) {
      const equirect = baker.renderEquirectPreview(palette, shared, previewExposure);
      setEnvPreview({ equirect, probe: null, bakeMs: performance.now() - started });
    }

    // Expensive stage — coalesced.
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const prefilterStart = performance.now();
      const texture = baker.prefilter();
      setEnvMap(texture);

      if (__SCENE_EDITOR__ && previewEnabled) {
        // Rebuild the probe material against the map that was just baked. Disposed
        // first: PMREM aside, orphaning a material per bake is the other easy way to
        // leak a session's worth of GPU resources.
        probe.current?.dispose();
        probe.current = createNodeMaterial(
          palette.categories.Declaration,
          palette,
          config.themed[palette.theme],
          shared,
          texture,
        ).material;

        const equirect = baker.renderEquirectPreview(palette, shared, previewExposure);
        const probeImage = baker.renderProbe(probe.current, texture);
        setEnvPreview({
          equirect,
          probe: probeImage,
          bakeMs: performance.now() - prefilterStart,
        });
      }
    }, PREFILTER_DELAY_MS);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [baker, palette, shared, config, previewExposure, previewEnabled]);

  useEffect(
    () => () => {
      probe.current?.dispose();
      probe.current = null;
    },
    [],
  );

  return null;
}