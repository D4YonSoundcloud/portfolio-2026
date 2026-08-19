import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { DepthFilter } from './DepthFilter.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { TransitionModeToggle } from './TransitionModeToggle.tsx';
import { useSceneStore } from '../store/sceneStore.ts';
import styles from './Settings.module.css';

/**
 * §7.2 / §8.1 — "sensible to surface alongside the transition-mode control in one small
 * settings affordance rather than two competing corner widgets", and on small screens
 * they "consolidate into a single compact settings menu".
 *
 * Rather than branching on viewport width, this is one disclosure at every size — the
 * desktop version just has room to sit open wider. One code path, one thing to test.
 *
 * §2 — Motion (not react-spring) drives this. It's a simple one-off enter/exit that
 * doesn't need to stay synced across the Canvas boundary, so it stays off the focus
 * spring entirely.
 */
export function SettingsCluster(): ReactNode {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useSceneStore((s) => s.reducedMotion);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        containerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    // `data-ui` marks this whole subtree as chrome, so a click or hover here never
    // reaches the AST nodes rendered behind it (see scene/pointerGuard.ts).
    <div className={styles.cluster} ref={containerRef} data-ui>
      <AnimatePresence>
        {open ? (
          <motion.div
            className={styles.panel}
            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.2, 0.7, 0.3, 1] }}
            id="settings-panel"
          >
            <ThemeToggle />
            <TransitionModeToggle />
            <DepthFilter />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls="settings-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? '×' : '≡'}</span>
        <span className="visually-hidden">
          {open ? 'Close display settings' : 'Display settings'}
        </span>
      </button>
    </div>
  );
}