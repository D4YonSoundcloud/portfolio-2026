import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useSpring } from '@react-spring/three';
import { Vector3 } from 'three';

import { readSceneConfig, useSceneConfig } from './sceneConfig.ts';
import { readSceneStore, useSceneStore } from '../store/sceneStore.ts';
import { FOCUS_SPRING } from '../navigation/FocusTrack.tsx';

/**
 * §4.4 / §5.2 — the camera.
 *
 * Three motions, deliberately separate:
 *
 *   1. Focus-change easing — driven by the store's `focusedIndex` via
 *      @react-spring/three, using the SAME spring config as the DOM track
 *      (`FOCUS_SPRING`). One input, two synchronized but independently rendered
 *      animations. This is why the transition reads as a single coordinated motion
 *      rather than two animations that happen to run at once (§2).
 *   2. Autonomous idle drift — a slow precomputed path nudged in `useFrame`.
 *   3. Pointer parallax — subtle, damped.
 *
 * (2) and (3) are disabled entirely on mobile (§8.2 — no pointer to parallax against,
 * and continuous background animation is a straight battery/thermal cost) and under
 * prefers-reduced-motion (§4.7). Only the event-driven focus easing survives.
 *
 * Note this reads `focusedIndex` from the store rather than attaching scroll listeners
 * inside the R3F tree (§4.4) — gesture translation lives in exactly one place (§5.1).
 *
 * ── Config access, two ways ──────────────────────────────────────────────────────────
 * The stops need to be RECOMPUTED when `viewDistance` changes, so that comes through the
 * subscribing `useSceneConfig` hook and lands in a `useMemo` dependency. The per-frame
 * drift and parallax values are read with `readSceneConfig()` instead — same reasoning
 * as `readSceneStore` below, since a subscription here would re-render this component on
 * every config change AND defeat the render loop.
 */

/** Matches the 767px breakpoint where the panel becomes a bottom sheet. */
const SHEET_BREAKPOINT = 768;

interface CameraRigProps {
  /** Per-section camera targets — centroids of real AST clusters (§4.3). */
  clusterTargets: Vector3[];
  /** Baked position of the node open in the inspector, or null when it is closed. */
  inspectTarget: Vector3 | null;
}

export function CameraRig({ clusterTargets, inspectTarget }: CameraRigProps): ReactNode {
  const focusedIndex = useSceneStore((s) => s.focusedIndex);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  const config = useSceneConfig();
  const { viewDistance, inspectDistance } = config.shared.camera;

  const parallaxOffset = useRef(new Vector3());
  const scratch = useRef(new Vector3());
  const lookTarget = useRef(new Vector3());
  const cameraRight = useRef(new Vector3());
  const cameraUp = useRef(new Vector3());
  /** 0 → section framing, 1 → inspect framing. Eased so opening the panel glides. */
  const inspectAmount = useRef(0);

  /**
   * Camera positions per focus item. Each sits back from its cluster along a slowly
   * rotating ring, so consecutive items approach from visibly different angles rather
   * than sliding along one axis.
   */
  const stops = useMemo(() => {
    return clusterTargets.map((target, index) => {
      const angle = (index / Math.max(1, clusterTargets.length)) * Math.PI * 1.6;
      return {
        target: target.clone(),
        position: new Vector3(
          target.x + Math.sin(angle) * viewDistance * 0.55,
          target.y + Math.cos(angle * 0.7) * viewDistance * 0.22,
          target.z + Math.cos(angle) * viewDistance * 0.62 + viewDistance * 0.5,
        ),
      };
    });
  }, [clusterTargets, viewDistance]);

  const current = stops[focusedIndex] ?? stops[0];
  const reducedMotion = useSceneStore((s) => s.reducedMotion);
  const transitionMode = useSceneStore((s) => s.transitionMode);

  const [spring, api] = useSpring(() => ({
    position: current ? current.position.toArray() : [0, 0, viewDistance],
    target: current ? current.target.toArray() : [0, 0, 0],
    config: FOCUS_SPRING,
  }));

  useEffect(() => {
    const stop = stops[focusedIndex];
    if (!stop) return;

    /**
     * When a node is open in the inspector, fly to it instead of to the section
     * centroid: approach along the same direction the section was already being viewed
     * from, but much closer. Reusing the existing direction means opening the panel
     * reads as moving in, not as being teleported somewhere unrelated.
     */
    const inspecting = inspectTarget !== null;
    const position = inspecting
      ? inspectTarget
          .clone()
          .add(
            stop.position
              .clone()
              .sub(inspectTarget)
              .normalize()
              .multiplyScalar(inspectDistance),
          )
      : stop.position;
    const target = inspecting ? inspectTarget : stop.target;

    void api.start({
      position: position.toArray(),
      target: target.toArray(),
      // §5.2 — 'off' cuts instantly here too, so the scene and the DOM agree about
      // whether a transition is animating at all.
      immediate: transitionMode === 'off' || reducedMotion,
      config: FOCUS_SPRING,
    });
  }, [focusedIndex, stops, api, transitionMode, reducedMotion, inspectTarget, inspectDistance]);

  useFrame((state, delta) => {
    // Read via getState, never a subscription — re-rendering this component every frame
    // would defeat the render loop entirely.
    const { reducedMotion: reduced, isCoarsePointer } = readSceneStore();
    const { camera: cameraConfig } = readSceneConfig().shared;
    const ambient = !reduced && !isCoarsePointer;

    const [px, py, pz] = spring.position.get();
    const [tx, ty, tz] = spring.target.get();

    scratch.current.set(px ?? 0, py ?? 0, pz ?? 0);

    /**
     * Push the node clear of the Code Inspector.
     *
     * The panel covers a known slice of the viewport — the right edge on desktop, the
     * bottom 78% on mobile (§8.1) — so the node has to sit in whatever is left, not at
     * screen centre where the panel would cover it.
     *
     * Rather than moving the camera, this offsets what the camera LOOKS AT: shifting the
     * look target right by N world units moves the subject N units left on screen. The
     * conversion from panel pixels to world units depends on distance, fov and viewport,
     * so it is computed live here rather than baked as a constant that would be wrong at
     * every other window size.
     */
    const inspectTargetAmount = inspectTarget ? 1 : 0;
    inspectAmount.current +=
      (inspectTargetAmount - inspectAmount.current) *
      Math.min(1, delta / cameraConfig.inspectAttack);

    if (ambient) {
      // (2) Idle drift — a slow Lissajous nudge on top of the sprung position, so it
      // never fights the focus transition, it just breathes around wherever it lands.
      const t = state.clock.elapsedTime * cameraConfig.driftSpeed;
      scratch.current.x += Math.sin(t) * cameraConfig.driftRadius;
      scratch.current.y += Math.sin(t * 1.3) * cameraConfig.driftRadius * 0.6;
      scratch.current.z += Math.cos(t * 0.8) * cameraConfig.driftRadius * 0.5;

      // (3) Pointer parallax — damped toward the pointer rather than tracking it
      // directly, so a fast mouse doesn't whip the camera.
      const targetX = state.pointer.x * cameraConfig.parallax;
      const targetY = state.pointer.y * cameraConfig.parallax;
      const damping = 1 - Math.exp(-delta / cameraConfig.parallaxDamping);
      parallaxOffset.current.x += (targetX - parallaxOffset.current.x) * damping;
      parallaxOffset.current.y += (targetY - parallaxOffset.current.y) * damping;

      // Drift and parallax recede while inspecting: the node needs to hold still
      // beside the panel, not wander back under it.
      const settle = 1 - inspectAmount.current;
      scratch.current.x += parallaxOffset.current.x * settle;
      scratch.current.y += parallaxOffset.current.y * settle;
    }

    camera.position.copy(scratch.current);
    lookTarget.current.set(tx ?? 0, ty ?? 0, tz ?? 0);

    if (inspectAmount.current > 0.001) {
      const distance = camera.position.distanceTo(lookTarget.current);
      const fov = 'fov' in camera ? (camera.fov as number) : 55;
      // World units spanned by one screen pixel at the subject's distance.
      const worldPerPixel =
        (2 * distance * Math.tan((fov * Math.PI) / 360)) / Math.max(1, size.height);

      camera.matrixWorld.extractBasis(cameraRight.current, cameraUp.current, scratch.current);

      if (size.width < SHEET_BREAKPOINT) {
        // Bottom sheet: height is min(78dvh, 640px). Centring the node in the strip
        // left above it means lifting it by half the sheet's height.
        const sheet = Math.min(size.height * 0.78, 640);
        const offset = (sheet / 2) * worldPerPixel * inspectAmount.current;
        lookTarget.current.addScaledVector(cameraUp.current, -offset);
      } else {
        // Right-edge panel: width is min(560px, 92vw). Looking to the RIGHT of the node
        // by half the panel's width puts the node in the middle of the free space left.
        const panel = Math.min(560, size.width * 0.92);
        const offset = (panel / 2) * worldPerPixel * inspectAmount.current;
        lookTarget.current.addScaledVector(cameraRight.current, offset);
      }
    }

    camera.lookAt(lookTarget.current);
  });

  return null;
}