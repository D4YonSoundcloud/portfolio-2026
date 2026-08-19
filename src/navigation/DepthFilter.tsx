import type { ReactNode } from 'react';

import { DEPTH_LEVELS, MAX_DEPTH_LEVEL, useSceneStore } from '../store/sceneStore.ts';
import styles from './Settings.module.css';

/**
 * §4.5 — depth filter.
 *
 * The pipeline already prunes to a node budget at build time; this is the runtime
 * counterpart, letting the visitor decide how much of the tree to look at. Low values
 * leave only the structural skeleton — file roots and top-level declarations — which is
 * the most legible view of what the codebase actually is. Higher values fill in the
 * expression-level detail.
 *
 * It also bounds tree traversal (TreeTraversal.tsx): you can only walk into nodes that
 * are actually on screen.
 */
export function DepthFilter(): ReactNode {
  const maxDepth = useSceneStore((s) => s.maxDepth);
  const setMaxDepth = useSceneStore((s) => s.setMaxDepth);

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Depth</legend>
      <div className={styles.segments} role="radiogroup" aria-label="Syntax tree depth">
        {DEPTH_LEVELS.map((level) => {
          const isMax = level === MAX_DEPTH_LEVEL;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={maxDepth === level}
              aria-label={isMax ? 'All levels' : `Up to level ${level}`}
              title={isMax ? 'All levels' : `Up to level ${level}`}
              className={styles.segment}
              data-active={maxDepth === level || undefined}
              onClick={() => setMaxDepth(level)}
            >
              <span aria-hidden="true">{isMax ? '∗' : level}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}