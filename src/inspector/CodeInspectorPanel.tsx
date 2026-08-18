import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { useSceneStore } from '../store/sceneStore.ts';
import { loadSnippets, resolveSnippet } from './snippetLoader.ts';
import type { Snippet } from '../ast-pipeline/schema.ts';
import styles from './CodeInspectorPanel.module.css';

/**
 * §4.6 — the pop-out Code Inspector: a REAL DOM panel, not a 3D-anchored one.
 *
 * A screen-anchored panel would have to be recomputed every frame as the camera moves
 * and gets awkward the moment a node drifts near the viewport edge. A fixed slide-in
 * panel is simpler, works identically on mobile with no camera-projection maths at all
 * (§8.1 — full-width bottom sheet there), and is trivially keyboard-dismissible and
 * focus-trappable — properties the anchored version would need extra work to get right.
 *
 * §2 — Motion drives the enter/exit, independent of the §5 focus-carousel spring.
 */
export function CodeInspectorPanel(): ReactNode {
  const inspectorNodeId = useSceneStore((s) => s.inspectorNodeId);
  const closeInspector = useSceneStore((s) => s.closeInspector);
  const reducedMotion = useSceneStore((s) => s.reducedMotion);
  // Matches the 767px breakpoint in the stylesheet where the panel becomes a sheet.
  const isSheet = useSceneStore((s) => s.isCoarsePointer);

  const [snippet, setSnippet] = useState<Snippet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // §4.6 — opening a new node replaces the content rather than stacking panels.
  useEffect(() => {
    if (!inspectorNodeId) {
      setSnippet(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);

    void loadSnippets()
      .then((index) => {
        if (cancelled) return;
        // Deep nodes resolve to their nearest ancestor's snippet (§4.6), so a click
        // anywhere in the scene always opens something readable.
        const found = resolveSnippet(index, inspectorNodeId);
        if (found) setSnippet(found);
        else setError('No source is available for this node.');
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the source for this node.');
      });

    return () => {
      cancelled = true;
    };
  }, [inspectorNodeId]);

  // §9 — focus-trapped and Escape-dismissible, with focus restored on close.
  useEffect(() => {
    if (!inspectorNodeId) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeInspector();
        return;
      }

      if (event.key !== 'Tab' || !panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocusTo.current?.focus?.();
    };
  }, [inspectorNodeId, closeInspector]);

  // One markup string for both themes; the active colours come from CSS custom
  // properties keyed off `data-theme` (§7.2), so nothing re-renders on a theme switch.
  const html = snippet?.html ?? null;

  return (
    <AnimatePresence>
      {inspectorNodeId ? (
        <>
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            onClick={closeInspector}
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-label="Source code inspector"
            tabIndex={-1}
            initial={reducedMotion ? { opacity: 0 } : isSheet ? { opacity: 0, y: 32 } : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={
              reducedMotion ? { opacity: 0 } : isSheet ? { opacity: 0, y: 32 } : { opacity: 0, x: 24 }
            }
            transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.2, 0.7, 0.3, 1] }}
            // §8.1 — the bottom sheet is dismissible by the swipe-down gesture users
            // already expect from a sheet, as well as by the explicit close control.
            // Constrained to downward travel so a drag can't lift it off the edge.
            {...(isSheet
              ? {
                  drag: 'y' as const,
                  dragConstraints: { top: 0, bottom: 0 },
                  dragElastic: { top: 0, bottom: 0.6 },
                  onDragEnd: (_event: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
                    if (info.offset.y > 120 || info.velocity.y > 600) closeInspector();
                  },
                }
              : {})}
          >
            <header className={styles.header}>
              {/* §4.6 — breadcrumb: `src/scene/CameraRig.tsx › FunctionDeclaration`. */}
              <p className={styles.breadcrumb}>
                {snippet?.breadcrumb ?? 'Loading source'}
              </p>
              <button type="button" className={styles.close} onClick={closeInspector}>
                <span aria-hidden="true">×</span>
                <span className="visually-hidden">Close inspector</span>
              </button>
            </header>

            <div className={styles.body}>
              {error ? (
                <p className={styles.error}>{error}</p>
              ) : html ? (
                <div className={styles.code}>
                  {snippet ? (
                    <span className={styles.lineHint}>line {snippet.startLine}</span>
                  ) : null}
                  {/*
                    Safe: this markup is produced by Shiki at BUILD TIME from this
                    repository's own source (§4.1) and validated by Zod before it's
                    written. No user input and no remote content ever reaches here.
                  */}
                  <div dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              ) : (
                <p className={styles.loading}>Loading source…</p>
              )}
            </div>

            <footer className={styles.footer}>
              <p>
                Generated from this site&rsquo;s own source at build time. Press{' '}
                <kbd className={styles.kbd}>Esc</kbd> to close.
              </p>
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
