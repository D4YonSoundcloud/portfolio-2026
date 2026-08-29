import type { ReactNode } from 'react';

import { useSceneStore } from '../store/sceneStore.ts';
import styles from './NavButtons.module.css';

/**
 * Hands the camera to the visitor, and gets the content out of the way (§4.4, §5.1).
 *
 * ── What it actually switches ────────────────────────────────────────────────────────
 * Setting `interactionMode` to 'explore' does four things at once, each handled by the
 * component that owns that concern rather than from here:
 *
 *   CameraRig     returns early, releasing camera.position and lookAt to OrbitControls
 *   Scene         drops fog, which reads as depth from fixed distances and as a wall
 *                 once you can fly toward things
 *   useFocusNav   stops claiming the wheel, so it can dolly instead
 *   App           hides the content layer
 *
 * ── Why the content is hidden rather than left underneath ────────────────────────────
 * The scene is decorative and sits behind a fixed content layer (§3) that covers most of
 * the viewport. Flying around behind a wall of text is pointless, so exploring hides it.
 *
 * `hidden` rather than unmounting: the sections must stay in the DOM to remain crawlable
 * (§5.3, §10), and unmounting them would also throw away scroll positions and any
 * in-progress state for the sake of a mode the visitor will leave in a few seconds.
 *
 * ── Selection stays live ─────────────────────────────────────────────────────────────
 * Clicking a node still opens the inspector while exploring. "Fly around, find something
 * interesting, click it" is the obvious use, and suppressing selection would make the
 * mode a cul-de-sac.
 */
export function ExploreToggle(): ReactNode {
  const interactionMode = useSceneStore((s) => s.interactionMode);
  const setInteractionMode = useSceneStore((s) => s.setInteractionMode);
  const inspectorNodeId = useSceneStore((s) => s.inspectorNodeId);
  const exploring = interactionMode === 'explore';

  return (
    <button
      type="button"
      className={styles.explore}
      data-ui
      aria-pressed={exploring}
      onClick={() =>
        // Returning to 'tree' rather than 'sections' when a node is open, so leaving
        // explore mode does not silently break the wheel for someone mid-walk.
        setInteractionMode(exploring ? (inspectorNodeId ? 'tree' : 'sections') : 'explore')
      }
    >
      {exploring ? 'Exit explore' : 'Explore'}
    </button>
  );
}