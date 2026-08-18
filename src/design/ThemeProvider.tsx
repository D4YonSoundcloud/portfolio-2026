import { useEffect, type ReactNode } from 'react';
import { useSceneStore } from '../store/sceneStore.ts';

/**
 * §7.2 — Theming.
 *
 * Resolves `themeMode` ('dark' | 'light' | 'system') against the OS `prefers-color-scheme`
 * and writes the result to `data-theme` on <html>, which is what `tokens.css` keys off.
 *
 * The flash-of-wrong-theme guard is NOT here — it can't be. Because content is
 * pre-rendered at build time (§10), theme has to resolve synchronously before first
 * paint, which means a blocking inline script in <head>. See `THEME_INIT_SCRIPT` below
 * and its use in index.html. This component keeps that value in sync afterwards.
 */

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): ReactNode {
  const themeMode = useSceneStore((s) => s.themeMode);
  const setResolvedTheme = useSceneStore((s) => s.setResolvedTheme);
  const setReducedMotion = useSceneStore((s) => s.setReducedMotion);
  const setCoarsePointer = useSceneStore((s) => s.setCoarsePointer);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');

    const apply = (): void => {
      const resolved = themeMode === 'system' ? (query.matches ? 'light' : 'dark') : themeMode;
      document.documentElement.dataset['theme'] = resolved;
      setResolvedTheme(resolved);
    };

    apply();

    // Only follow the OS while the user is actually on 'system'.
    if (themeMode !== 'system') return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [themeMode, setResolvedTheme]);

  // §4.7 / §9 — the OS accessibility signal is live, not just read once at boot.
  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointerQuery = window.matchMedia('(pointer: coarse)');

    const onMotion = (): void => setReducedMotion(motionQuery.matches);
    const onPointer = (): void => setCoarsePointer(pointerQuery.matches);

    onMotion();
    onPointer();

    motionQuery.addEventListener('change', onMotion);
    pointerQuery.addEventListener('change', onPointer);
    return () => {
      motionQuery.removeEventListener('change', onMotion);
      pointerQuery.removeEventListener('change', onPointer);
    };
  }, [setReducedMotion, setCoarsePointer]);

  return children;
}

/**
 * Inlined into <head> in index.html, before any stylesheet or bundle. Runs synchronously
 * so the correct `data-theme` is set before first paint — the standard technique any
 * statically-generated site with a dark mode needs (§7.2).
 *
 * Kept here rather than pasted as a string literal in the HTML so it lives next to the
 * logic it mirrors and gets noticed if the resolution rules change.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('portfolio:themeMode');
    var mode = (stored === 'dark' || stored === 'light' || stored === 'system') ? stored : 'system';
    var resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : mode;
    document.documentElement.dataset.theme = resolved;
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`.trim();
