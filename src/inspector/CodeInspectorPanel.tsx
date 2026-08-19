import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { useSceneStore } from '../store/sceneStore.ts';
import { loadSourceIndex } from './sourceLoader.ts';
import { renderSnippet, type RenderedSnippet } from './renderTokens.ts';
import type { PaletteEntry } from '../ast-pipeline/schema.ts';
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
  const inspectorTarget = useSceneStore((s) => s.inspectorTarget);
  const closeInspector = useSceneStore((s) => s.closeInspector);
  const reducedMotion = useSceneStore((s) => s.reducedMotion);
  // Matches the 767px breakpoint in the stylesheet where the panel becomes a sheet.
  const isSheet = useSceneStore((s) => s.isCoarsePointer);

  const [snippet, setSnippet] = useState<RenderedSnippet | null>(null);
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  /**
   * §4.6 — opening a new node replaces the content rather than stacking panels.
   *
   * The whole source index is fetched once and reused: a node is a character RANGE into
   * a file that is already loaded, so switching nodes — including walking the tree with
   * the wheel — costs a re-render and no network at all.
   */
  useEffect(() => {
    if (!inspectorTarget) {
      setSnippet(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);

    void loadSourceIndex()
      .then((index) => {
        if (cancelled) return;
        const file = index.files[inspectorTarget.fileName];
        if (!file) {
          setError('No source is available for this node.');
          return;
        }
        setPalette(index.palette);
        setSnippet(renderSnippet(file, inspectorTarget.start, inspectorTarget.end));
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the source for this node.');
      });

    return () => {
      cancelled = true;
    };
  }, [inspectorTarget]);

  // §9 — focus-trapped and Escape-dismissible, with focus restored on close.
  useEffect(() => {
    if (!inspectorNodeId) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();

    // Escape closes. There is deliberately no Tab trap: a focus trap belongs to a modal
    // dialog, and this panel is not one — trapping Tab here would make the settings
    // menu and section navigation unreachable while a snippet is open.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeInspector();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocusTo.current?.focus?.();
    };
  }, [inspectorNodeId, closeInspector]);



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
            aria-hidden="true"
          />

          {/*
            Deliberately NOT aria-modal: the scene behind this panel stays interactive
            (hover, select, wheel-traverse), so claiming modality would misdescribe the
            panel to assistive tech — and would imply a focus trap that is not there.
          */}
          <motion.div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
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
              {/* §4.6 — `src/scene/CameraRig.tsx › FunctionDeclaration · CameraRig` */}
              <p className={styles.breadcrumb}>
                {inspectorTarget
                  ? `${inspectorTarget.fileName} › ${inspectorTarget.kind}${
                      inspectorTarget.label ? ` · ${inspectorTarget.label}` : ''
                    }`
                  : 'Loading source'}
              </p>
              <button type="button" className={styles.close} onClick={closeInspector}>
                <span aria-hidden="true">×</span>
                <span className="visually-hidden">Close inspector</span>
              </button>
            </header>

            <div className={styles.body}>
              {error ? (
                <p className={styles.error}>{error}</p>
              ) : snippet ? (
                <div className={styles.code}>
                  <span className={styles.lineHint}>
                    line {snippet.firstLine}
                    {snippet.truncatedAbove || snippet.truncatedBelow ? ' · excerpt' : ''}
                  </span>
                  <SnippetBody snippet={snippet} palette={palette} />
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

/**
 * Renders the segment list as React elements.
 *
 * Deliberately NOT `dangerouslySetInnerHTML`: segments carry raw source text, so letting
 * React create text nodes means escaping is handled by the renderer rather than being
 * something the build step has to get right.
 *
 * Colours arrive as the two theme variants Shiki produced, set as CSS custom properties
 * on each span. The active one is selected in CSS by `data-theme` (§7.2), so switching
 * theme repaints without re-rendering anything here.
 */
function SnippetBody({
  snippet,
  palette,
}: {
  snippet: RenderedSnippet;
  palette: PaletteEntry[];
}): ReactNode {
  return (
    <pre className={styles.pre}>
      <code>
        {snippet.segments.map((segment, index) => {
          const colours = segment.paletteIndex === null ? null : palette[segment.paletteIndex];
          return (
            <span
              // Segments are positional and the list is rebuilt wholesale on every node
              // change, so the index is a stable identity here.
              key={index}
              data-hit={segment.highlighted || undefined}
              style={
                colours
                  ? ({
                      '--shiki-light': colours[0],
                      '--shiki-dark': colours[1],
                    } as CSSProperties)
                  : undefined
              }
            >
              {segment.text}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
