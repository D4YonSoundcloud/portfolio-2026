import { useEffect, useRef } from 'react';
import { useSceneStore } from '../store/sceneStore.ts';
import { SECTION_COUNT } from '../sections/sections.ts';

/**
 * §5.1 — Input handling.
 *
 * This hook is the ONE place gesture-to-index translation happens. Wheel, touch,
 * keyboard and dot-nav all converge on the same `setFocusedIndex`, which is what makes
 * §11's "all four paths land on the same focusedIndex" testable as a single assertion.
 */

/** Accumulated wheel delta required before an index change fires. */
const WHEEL_THRESHOLD = 90;

/** §14 open question — start at ~150ms and tune by feel against a real build. */
const WHEEL_COOLDOWN_MS = 150;

/** Touch distance (px) before a swipe counts as an index change (§8.2). */
const SWIPE_DISTANCE = 56;

/** Fast flicks should advance even when short. px/ms. */
const SWIPE_VELOCITY = 0.35;

/** §8.2 — movement in one axis past this commits the gesture to that axis. */
const AXIS_LOCK_THRESHOLD = 10;

type Axis = 'x' | 'y' | null;

/**
 * §5.1, §9 — the escape hatch, and a hard requirement rather than a nice-to-have.
 *
 * If the focused item's own content is taller than the viewport, wheel/touch over it
 * scrolls THAT natively first. Only once it's at its own top/bottom edge does the next
 * input hand off to an index change. Without this, any item with more content than fits
 * becomes unreadable — the exact failure mode that makes scroll-jacked sites frustrating.
 *
 * Returns the scrollable ancestor that can still absorb `delta`, or null if the gesture
 * should advance the carousel instead.
 */
function findScrollableAncestor(
  start: EventTarget | null,
  delta: number,
  boundary: HTMLElement,
): HTMLElement | null {
  let node = start instanceof HTMLElement ? start : null;

  while (node && node !== boundary.parentElement) {
    const style = window.getComputedStyle(node);
    const canScroll = /(auto|scroll|overlay)/.test(style.overflowY);
    const hasOverflow = node.scrollHeight - node.clientHeight > 1;

    if (canScroll && hasOverflow) {
      const atTop = node.scrollTop <= 0;
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      // Only claim the gesture if this element can actually move in that direction.
      if ((delta < 0 && !atTop) || (delta > 0 && !atBottom)) return node;
    }

    node = node.parentElement;
  }

  return null;
}

export interface FocusNavOptions {
  /** The element gestures are captured on — normally the focus track wrapper. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Disabled while the Code Inspector is open, so the panel owns its own scrolling. */
  enabled?: boolean;
}

export function useFocusNav({ containerRef, enabled = true }: FocusNavOptions): void {
  const setFocusedIndex = useSceneStore((s) => s.setFocusedIndex);
  const advanceFocus = useSceneStore((s) => s.advanceFocus);
  // Subscribed, not read via getState(), so changing the mode (§5.2) rebinds the
  // listeners with the correct axis instead of leaving a stale closure in place.
  const transitionMode = useSceneStore((s) => s.transitionMode);

  // Gesture bookkeeping lives in refs, never state — none of it should cause a render.
  const wheelAccum = useRef(0);
  const lockedUntil = useRef(0);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchAxis = useRef<Axis>(null);
  const touchConsumedBy = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const horizontal = transitionMode === 'horizontal';

    const tryAdvance = (delta: number): void => {
      const now = performance.now();
      if (now < lockedUntil.current) return;
      // §5.1 — cooldown lock until the transition finishes, so one gesture can't fire
      // five index changes at once. The classic fullPage.js-style snap pattern.
      lockedUntil.current = now + WHEEL_COOLDOWN_MS;
      wheelAccum.current = 0;
      advanceFocus(delta);
    };

    const onWheel = (event: WheelEvent): void => {
      // A trackpad two-finger pan reports both axes; take whichever is dominant so the
      // gesture reads the same whether the carousel is horizontal or vertical.
      const raw =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;

      const scrollable = findScrollableAncestor(event.target, raw, container);
      if (scrollable) return; // Let the item's own content scroll. Do not preventDefault.

      event.preventDefault();

      if (performance.now() < lockedUntil.current) return;

      // Reset the accumulator on a direction change so a reversal responds immediately.
      if (Math.sign(raw) !== Math.sign(wheelAccum.current)) wheelAccum.current = 0;
      wheelAccum.current += raw;

      if (Math.abs(wheelAccum.current) >= WHEEL_THRESHOLD) {
        tryAdvance(Math.sign(wheelAccum.current));
      }
    };

    const onTouchStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (!touch) return;
      touchStart.current = { x: touch.clientX, y: touch.clientY, time: performance.now() };
      touchAxis.current = null;
      touchConsumedBy.current = null;
    };

    const onTouchMove = (event: TouchEvent): void => {
      const start = touchStart.current;
      const touch = event.touches[0];
      if (!start || !touch) return;

      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      // §8.2 — gesture-axis locking. A touch tracks both axes from the first frame,
      // unlike a wheel event. Once movement past touchstart crosses the threshold in one
      // axis, commit to that axis for the rest of the gesture rather than re-evaluating
      // every frame — the standard carousel/swiper technique.
      if (touchAxis.current === null) {
        if (Math.abs(dx) < AXIS_LOCK_THRESHOLD && Math.abs(dy) < AXIS_LOCK_THRESHOLD) return;
        touchAxis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';

        // Resolve the escape hatch once, at lock time, and hold the decision.
        const navDelta = touchAxis.current === 'x' ? -dx : -dy;
        touchConsumedBy.current = findScrollableAncestor(event.target, navDelta, container);
      }

      // The item's own content claimed this gesture — let it scroll natively.
      if (touchConsumedBy.current) return;

      const gestureAxis: Axis = horizontal ? 'x' : 'y';
      if (touchAxis.current !== gestureAxis) return;

      if (event.cancelable) event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent): void => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start || touchConsumedBy.current) return;

      const gestureAxis: Axis = horizontal ? 'x' : 'y';
      if (touchAxis.current !== gestureAxis) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const distance = gestureAxis === 'x' ? touch.clientX - start.x : touch.clientY - start.y;
      const elapsed = Math.max(1, performance.now() - start.time);
      const velocity = Math.abs(distance) / elapsed;

      if (Math.abs(distance) < SWIPE_DISTANCE && velocity < SWIPE_VELOCITY) return;

      // Swiping left / up advances forward, matching the direction content travels.
      tryAdvance(distance < 0 ? 1 : -1);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }

      // §5.1 — arrow keys match the current orientation. This is the primary accessible
      // path and behaves identically to the gesture path, not as an afterthought.
      const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
      const back = horizontal ? 'ArrowLeft' : 'ArrowUp';

      switch (event.key) {
        case forward:
        case 'PageDown':
          event.preventDefault();
          advanceFocus(1);
          break;
        case back:
        case 'PageUp':
          event.preventDefault();
          advanceFocus(-1);
          break;
        case 'Home':
          event.preventDefault();
          setFocusedIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setFocusedIndex(SECTION_COUNT - 1);
          break;
        default:
          break;
      }
    };

    // `passive: false` is required — a passive listener cannot preventDefault, and
    // preventing the native scroll is the whole mechanism here (§5).
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef, enabled, transitionMode, advanceFocus, setFocusedIndex]);
}

export const focusNavConstants = {
  WHEEL_THRESHOLD,
  WHEEL_COOLDOWN_MS,
  SWIPE_DISTANCE,
  SWIPE_VELOCITY,
  AXIS_LOCK_THRESHOLD,
} as const;
