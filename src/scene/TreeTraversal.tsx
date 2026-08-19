import { useEffect, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';

import type { AstNode } from '../ast-pipeline/schema.ts';
import { useSceneStore } from '../store/sceneStore.ts';
import {
  createSession,
  isWithinSession,
  stepDown,
  stepUp,
  type TraversalContext,
  type TraversalSession,
} from './treeTraversal.ts';

/**
 * Binds wheel input to tree traversal while the Code Inspector is open.
 *
 * Lives INSIDE the Canvas — it renders nothing — because the branch ordering depends on
 * the live camera pose, and `useThree` is the only honest way to read that. The DOM
 * listener is attached to the window from here.
 *
 * Division of labour with §5.1: `useFocusNav` disables itself entirely while the
 * inspector is open, so there is never a moment where a wheel event could both advance
 * the section carousel and walk the tree.
 */

/** Matches the feel of the section carousel's wheel handling (§5.1). */
const WHEEL_THRESHOLD = 90;
const WHEEL_COOLDOWN_MS = 260;

interface TreeTraversalProps {
  nodesById: Map<string, AstNode>;
}

export function TreeTraversal({ nodesById }: TreeTraversalProps): ReactNode {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  const inspectorNodeId = useSceneStore((s) => s.inspectorNodeId);
  const openInspector = useSceneStore((s) => s.openInspector);

  const session = useRef<TraversalSession | null>(null);
  const wheelAccum = useRef(0);
  const lockedUntil = useRef(0);
  /** Set while we are the ones moving the cursor, so our own update is not treated as a click. */
  const selfDriven = useRef(false);

  const forward = useRef(new Vector3());
  const pointer = useRef(new Vector3());
  /** Null until the pointer has been somewhere — touch devices may never set it. */
  const pointerClient = useRef<{ x: number; y: number } | null>(null);

  /**
   * Builds the ray from the camera through the visitor's pointer, by unprojecting the
   * cursor position onto the far plane. This is what "closest branch to the pointer"
   * measures against; without a pointer it degrades to the camera's own forward axis.
   */
  const context = (): TraversalContext => {
    camera.getWorldDirection(forward.current);

    let pointerDirection: Vector3 | undefined;
    const client = pointerClient.current;
    if (client) {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.current
        .set(
          ((client.x - rect.left) / rect.width) * 2 - 1,
          -(((client.y - rect.top) / rect.height) * 2 - 1),
          0.5,
        )
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      pointerDirection = pointer.current;
    }

    return {
      nodesById,
      cameraPosition: camera.position,
      cameraForward: forward.current,
      ...(pointerDirection ? { pointerDirection } : {}),
    };
  };

  /**
   * Session lifecycle.
   *
   * Closing the inspector ends the session. Selecting a node inside the current walk
   * keeps it (and, if it is one we have already stepped onto, moves the cursor there so
   * scrolling resumes from the right place). Anything else starts fresh.
   */
  useEffect(() => {
    if (!inspectorNodeId) {
      session.current = null;
      return;
    }

    if (selfDriven.current) {
      selfDriven.current = false;
      return;
    }

    const current = session.current;
    if (current && isWithinSession(current, inspectorNodeId, nodesById)) {
      const index = current.visited.indexOf(inspectorNodeId);
      if (index >= 0) current.cursor = index;
      return;
    }

    session.current = createSession(inspectorNodeId, context());
    // `context` is intentionally omitted: it reads live camera state at call time rather
    // than closing over a snapshot, so it must not drive re-subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectorNodeId, nodesById]);

  useEffect(() => {
    if (!inspectorNodeId) return;

    const onWheel = (event: WheelEvent): void => {
      // The code snippet owns its own scrolling. Only wheel events OUTSIDE the panel
      // traverse the tree — otherwise reading a long snippet would walk the tree at the
      // same time.
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"], [data-ui]')) return;

      // The wheel event carries the cursor position, which is more truthful than a
      // separately-tracked pointer: it is where the visitor was aiming at the instant
      // they scrolled.
      pointerClient.current = { x: event.clientX, y: event.clientY };

      event.preventDefault();

      const now = performance.now();
      if (now < lockedUntil.current) return;

      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (Math.sign(delta) !== Math.sign(wheelAccum.current)) wheelAccum.current = 0;
      wheelAccum.current += delta;

      if (Math.abs(wheelAccum.current) < WHEEL_THRESHOLD) return;

      const direction = Math.sign(wheelAccum.current);
      wheelAccum.current = 0;
      // Longer than the carousel's cooldown: each step retargets the camera, and
      // stacking those would blur past several nodes on one flick.
      lockedUntil.current = now + WHEEL_COOLDOWN_MS;

      const current = session.current;
      if (!current) return;

      const nextId =
        direction > 0 ? stepDown(current, context()) : stepUp(current, context());
      // null means the top of the visible tree or every branch exhausted; hold still.
      if (!nextId) return;

      selfDriven.current = true;
      openInspector(nextId);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectorNodeId, openInspector, nodesById]);

  return null;
}