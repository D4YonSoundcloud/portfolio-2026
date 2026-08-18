import type { ReactNode } from 'react';
import { useSceneStore, type ThemeMode } from '../store/sceneStore.ts';
import styles from './Settings.module.css';

/**
 * §7.2 — theme preference. Defaults to the OS `prefers-color-scheme` ('system'), with a
 * manual override persisted to localStorage. Changing this swaps both the CSS custom
 * properties and the scene's render pipeline (bloom vs. linework) from one value (§4.4).
 */

const MODES: ReadonlyArray<{ value: ThemeMode; label: string; title: string }> = [
  { value: 'dark', label: '◐', title: 'Dark' },
  { value: 'light', label: '◑', title: 'Light' },
  { value: 'system', label: '◎', title: 'Match system' },
];

export function ThemeToggle(): ReactNode {
  const themeMode = useSceneStore((s) => s.themeMode);
  const setThemeMode = useSceneStore((s) => s.setThemeMode);

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Theme</legend>
      <div className={styles.segments} role="radiogroup" aria-label="Colour theme">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={themeMode === mode.value}
            aria-label={mode.title}
            title={mode.title}
            className={styles.segment}
            data-active={themeMode === mode.value || undefined}
            onClick={() => setThemeMode(mode.value)}
          >
            <span aria-hidden="true">{mode.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
