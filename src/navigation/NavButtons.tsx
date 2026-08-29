import type { ReactNode } from 'react';

import { useSceneStore } from '../store/sceneStore.ts';
import styles from './NavButtons.module.css';

/**
 * On-screen traversal arrows (§8.2).
 *
 * ── Why these exist ──────────────────────────────────────────────────────────────────
 * Both traversal axes are wheel gestures, and one of them is wheel-plus-a-modifier.
 * Neither has any equivalent on a touch device — there is no wheel, and no shift key.
 * Without these, everything below the first tap is desktop-only, which would make the
 * inspector a dead end on the platform where it is hardest to explore by clicking.
 *
 * ── Why they publish intent instead of calling traversal ─────────────────────────────
 * Traversal has to run inside the Canvas: branch ordering depends on the live camera
 * pose, and `useThree` is the only honest way to read that. These are DOM. So they push
 * a request into the store and `TreeTraversal` consumes it — the same cross-boundary
 * pattern §6 uses everywhere else, and the reason `navRequest` carries a nonce.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────────────
 * Tree axis top-left, module axis top-right, mirroring the two wheel gestures as two
 * separate places rather than one cluster with a mode switch. Both are visible only
 * while the inspector is open, since neither does anything otherwise.
 *
 * Deliberately NOT disabled when a step has nowhere to go. Knowing that would mean
 * running the traversal's ordering rules from outside the Canvas, and a step that
 * cannot move already holds still — the same thing the wheel does at the end of a walk.
 * A button that occasionally does nothing is a smaller cost than a second, divergent
 * copy of the ordering logic.
 */

interface AxisButtonsProps {
  axis: 'tree' | 'module';
  label: string;
  upLabel: string;
  downLabel: string;
  className: string | undefined;
}

function AxisButtons({ axis, label, upLabel, downLabel, className }: AxisButtonsProps): ReactNode {
  const requestNav = useSceneStore((s) => s.requestNav);

  return (
    // `data-ui` keeps taps here from reaching the raycaster, which would otherwise
    // select whatever node sits behind the button (see scene/pointerGuard.ts).
    <div className={`${styles.cluster} ${className}`} data-ui>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <button
        type="button"
        className={styles.button}
        onClick={() => requestNav(axis, -1)}
        aria-label={upLabel}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4 10 L8 6 L12 10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => requestNav(axis, 1)}
        aria-label={downLabel}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4 6 L8 10 L12 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  );
}

export function NavButtons(): ReactNode {
  const inspectorNodeId = useSceneStore((s) => s.inspectorNodeId);
  if (!inspectorNodeId) return null;

  return (
    <>
      <AxisButtons
        axis="tree"
        label="tree"
        // Named for what they DO, not which way they point: "up" is meaningless read
        // aloud, whereas the direction of travel through the syntax tree is the fact a
        // screen-reader user actually needs.
        upLabel="Previous node in this file"
        downLabel="Next node in this file"
        className={styles.left}
      />
      <AxisButtons
        axis="module"
        label="imports"
        upLabel="Go to a file that imports this one"
        downLabel="Follow an import from this file"
        className={styles.right}
      />
    </>
  );
}