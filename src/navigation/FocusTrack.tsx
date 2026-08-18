import { useEffect, useRef, type ReactNode } from 'react';
import { useSpring, animated } from '@react-spring/web';

import { useSceneStore } from '../store/sceneStore.ts';
import { SECTIONS } from '../sections/sections.ts';
import { useFocusNav } from './useFocusNav.ts';
import styles from './FocusTrack.module.css';

/**
 * §5.2 / §5.3 — the DOM half of the focus carousel.
 *
 * This transforms the item track along the chosen axis using @react-spring/web. The 3D
 * half (`CameraRig`) uses @react-spring/three with a MATCHING spring config against the
 * same `focusedIndex`. One input, two synchronized but independently rendered
 * animations — which is what keeps the transition feeling like a single coordinated
 * motion rather than two animations that happen to run at once (§2).
 */

/** Shared with CameraRig — the two springs must agree or the motion desyncs (§5.2). */
export const FOCUS_SPRING = { tension: 170, friction: 26, precision: 0.0001 } as const;

interface FocusTrackProps {
  children: ReactNode[];
}

export function FocusTrack({ children }: FocusTrackProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedIndex = useSceneStore((s) => s.focusedIndex);
  const transitionMode = useSceneStore((s) => s.transitionMode);
  const inspectorNodeId = useSceneStore((s) => s.inspectorNodeId);
  const setTransitioning = useSceneStore((s) => s.setTransitioning);

  // Gesture capture is suspended while the inspector is open, so the panel owns its own
  // scrolling and a swipe inside it doesn't also move the carousel (§4.6).
  useFocusNav({ containerRef, enabled: inspectorNodeId === null });

  const isOff = transitionMode === 'off';
  const horizontal = transitionMode === 'horizontal';
  const offset = -focusedIndex * 100;

  const spring = useSpring({
    // §5.2 — 'off' is an instant cut. It's also the forced value under
    // prefers-reduced-motion, so the preference and the accessibility fallback share
    // one code path instead of being two branches.
    to: { offset },
    immediate: isOff,
    config: FOCUS_SPRING,
    onRest: () => setTransitioning(false),
    onStart: () => setTransitioning(true),
  });

  // §5.3 — announce the new focus item so a screen reader user gets the same "you're now
  // looking at Projects" signal a sighted user gets visually.
  const announceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const section = SECTIONS[focusedIndex];
    if (announceRef.current && section) {
      announceRef.current.textContent = `${section.announceLabel}, item ${focusedIndex + 1} of ${SECTIONS.length}`;
    }
  }, [focusedIndex]);

  // Moving focus into the newly-centred item keeps the tab order and the visual order in
  // agreement — otherwise Tab from a centred item jumps into an off-screen one.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(`[data-focus-index="${focusedIndex}"]`);
    // Only steal focus if focus is already somewhere inside the carousel, so we never
    // yank it away from the settings chrome or the skip link.
    if (active && container.contains(document.activeElement)) {
      active.focus({ preventScroll: true });
    }
  }, [focusedIndex]);

  return (
    <div
      ref={containerRef}
      className={styles.viewport}
      data-axis={horizontal ? 'x' : 'y'}
      role="group"
      aria-roledescription="carousel"
      aria-label="Portfolio sections"
    >
      <div ref={announceRef} className="visually-hidden" aria-live="polite" aria-atomic="true" />

      <animated.div
        className={styles.track}
        style={{
          transform: spring.offset.to((value) =>
            horizontal ? `translate3d(${value}%, 0, 0)` : `translate3d(0, ${value}%, 0)`,
          ),
        }}
      >
        {children.map((child, index) => {
          const section = SECTIONS[index];
          const isActive = index === focusedIndex;
          return (
            <section
              key={section?.id ?? index}
              className={styles.item}
              data-focus-index={index}
              // §5.3 — "one of N items, currently on item M" is genuinely what this is,
              // so it uses the standard accessible-carousel pattern rather than a
              // bespoke one.
              role="group"
              aria-roledescription="slide"
              aria-label={`${section?.announceLabel ?? ''}, ${index + 1} of ${SECTIONS.length}`}
              aria-current={isActive ? 'true' : undefined}
              // Off-centre items stay in the DOM (§5.3, §10) but leave the tab order, so
              // Tab never lands on something the visitor can't see.
              inert={!isActive}
              tabIndex={isActive ? -1 : undefined}
            >
              {child}
            </section>
          );
        })}
      </animated.div>
    </div>
  );
}
