import type { ReactNode } from 'react';
import { useSceneStore, type TransitionMode } from '../store/sceneStore.ts';
import styles from './Settings.module.css';

/**
 * §5.2 — transition mode preference. Persisted to localStorage by the store.
 *
 * When prefers-reduced-motion is set, the store forces 'off' and this control is
 * disabled rather than hidden: hiding it would leave the visitor wondering where the
 * setting went, and the disabled state explains itself.
 */

const MODES: ReadonlyArray<{ value: TransitionMode; label: string; title: string }> = [
  { value: 'horizontal', label: '↔', title: 'Slide sideways' },
  { value: 'vertical', label: '↕', title: 'Slide up and down' },
  { value: 'off', label: '×', title: 'No animation' },
];

export function TransitionModeToggle(): ReactNode {
  const transitionMode = useSceneStore((s) => s.transitionMode);
  const setTransitionMode = useSceneStore((s) => s.setTransitionMode);
  const reducedMotion = useSceneStore((s) => s.reducedMotion);

  return (
    <fieldset className={styles.group} disabled={reducedMotion}>
      <legend className={styles.legend}>Motion</legend>
      <div className={styles.segments} role="radiogroup" aria-label="Section transition">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={transitionMode === mode.value}
            aria-label={mode.title}
            title={mode.title}
            className={styles.segment}
            data-active={transitionMode === mode.value || undefined}
            onClick={() => setTransitionMode(mode.value)}
          >
            <span aria-hidden="true">{mode.label}</span>
          </button>
        ))}
      </div>
      {reducedMotion ? (
        <p className={styles.note}>Off — your system asks for reduced motion.</p>
      ) : null}
    </fieldset>
  );
}
