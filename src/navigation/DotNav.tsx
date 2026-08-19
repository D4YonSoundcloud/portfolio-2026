import type { ReactNode } from 'react';
import { useSceneStore } from '../store/sceneStore.ts';
import { SECTIONS } from '../sections/sections.ts';
import styles from './DotNav.module.css';

/**
 * §5.1 / §9 — the usability escape hatch, not decoration.
 *
 * This exists specifically so nobody is *required* to use the gesture-capture system to
 * navigate. It calls `setFocusedIndex` directly and never routes through `useFocusNav`,
 * so it works identically whether or not the visitor has figured out the scroll
 * behaviour — and keeps working if the gesture layer is broken.
 *
 * §14 open question — the dots follow `transitionMode`'s orientation (stacked vertically
 * for a horizontal carousel, which is the common convention). Flip `data-orientation` if
 * that reads worse against the real layout.
 */
export function DotNav(): ReactNode {
  const focusedIndex = useSceneStore((s) => s.focusedIndex);
  const setFocusedIndex = useSceneStore((s) => s.setFocusedIndex);
  const transitionMode = useSceneStore((s) => s.transitionMode);

  const orientation = transitionMode === 'vertical' ? 'horizontal' : 'vertical';

  return (
    <nav
      className={styles.nav}
      data-orientation={orientation}
      data-ui
      aria-label="Section navigation"
    >
      <ol className={styles.list}>
        {SECTIONS.map((section, index) => {
          const isActive = index === focusedIndex;
          return (
            <li key={section.id}>
              <button
                type="button"
                className={styles.dot}
                data-active={isActive || undefined}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => setFocusedIndex(index)}
              >
                {/* The tick mark itself — schematic, per §7.1's diagram direction. */}
                <span className={styles.tick} aria-hidden="true" />
                <span className={styles.name}>{section.announceLabel}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}