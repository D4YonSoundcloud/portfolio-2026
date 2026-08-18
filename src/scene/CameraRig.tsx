import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useSpring } from '@react-spring/three';
import { Vector3 } from 'three';

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
 */

/** How far back from a cluster centroid the camera sits. */
const VIEW_DISTANCE = 52;

/** Amplitude of the idle drift, in world units. */
const DRIFT_RADIUS = 3.2;
const DRIFT_SPEED = 0.055;

/** Pointer parallax offset at the screen edge. */
const PARALLAX = 4.5;
const PARALLAX_DAMPING = 0.045;

interface CameraRigProps {
  /** Per-section camera targets — centroids of real AST clusters (§4.3). */
  clusterTargets: Vector3[];
}

export function CameraRig({ clusterTargets }: CameraRigProps): ReactNode {
  const focusedIndex = useSceneStore((s) => s.focusedIndex);
  const camera = useThree((state) => state.camera);

  const parallaxOffset = useRef(new Vector3());
  const scratch = useRef(new Vector3());
  const lookTarget = useRef(new Vector3());

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
          target.x + Math.sin(angle) * VIEW_DISTANCE * 0.55,
          target.y + Math.cos(angle * 0.7) * VIEW_DISTANCE * 0.22,
          target.z + Math.cos(angle) * VIEW_DISTANCE * 0.62 + VIEW_DISTANCE * 0.5,
        ),
      };
    });
  }, [clusterTargets]);

  const current = stops[focusedIndex] ?? stops[0];
  const reducedMotion = useSceneStore((s) => s.reducedMotion);
  const transitionMode = useSceneStore((s) => s.transitionMode);

  const [spring, api] = useSpring(() => ({
    position: current ? current.position.toArray() : [0, 0, VIEW_DISTANCE],
    target: current ? current.target.toArray() : [0, 0, 0],
    config: FOCUS_SPRING,
  }));

  useEffect(() => {
    const stop = stops[focusedIndex];
    if (!stop) return;
    void api.start({
      position: stop.position.toArray(),
      target: stop.target.toArray(),
      // §5.2 — 'off' cuts instantly here too, so the scene and the DOM agree about
      // whether a transition is animating at all.
      immediate: transitionMode === 'off' || reducedMotion,
      config: FOCUS_SPRING,
    });
  }, [focusedIndex, stops, api, transitionMode, reducedMotion]);

  useFrame((state, delta) => {
    // Read via getState, never a subscription — re-rendering this component every frame
    // would defeat the render loop entirely.
    const { reducedMotion: reduced, isCoarsePointer } = readSceneStore();
    const ambient = !reduced && !isCoarsePointer;

    const [px, py, pz] = spring.position.get();
    const [tx, ty, tz] = spring.target.get();

    scratch.current.set(px ?? 0, py ?? 0, pz ?? 0);

    if (ambient) {
      // (2) Idle drift — a slow Lissajous nudge on top of the sprung position, so it
      // never fights the focus transition, it just breathes around wherever it lands.
      const t = state.clock.elapsedTime * DRIFT_SPEED;
      scratch.current.x += Math.sin(t) * DRIFT_RADIUS;
      scratch.current.y += Math.sin(t * 1.3) * DRIFT_RADIUS * 0.6;
      scratch.current.z += Math.cos(t * 0.8) * DRIFT_RADIUS * 0.5;

      // (3) Pointer parallax — damped toward the pointer rather than tracking it
      // directly, so a fast mouse doesn't whip the camera.
      const targetX = state.pointer.x * PARALLAX;
      const targetY = state.pointer.y * PARALLAX;
      const damping = 1 - Math.exp(-delta / PARALLAX_DAMPING);
      parallaxOffset.current.x += (targetX - parallaxOffset.current.x) * damping;
      parallaxOffset.current.y += (targetY - parallaxOffset.current.y) * damping;

      scratch.current.x += parallaxOffset.current.x;
      scratch.current.y += parallaxOffset.current.y;
    }

    camera.position.copy(scratch.current);
    lookTarget.current.set(tx ?? 0, ty ?? 0, tz ?? 0);
    camera.lookAt(lookTarget.current);
  });

  return null;
}
