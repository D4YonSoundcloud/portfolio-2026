import { beforeEach, describe, expect, it } from 'vitest';

import { useSceneStore } from '../../src/store/sceneStore.ts';
import { SECTIONS } from '../../src/sections/sections.ts';

/**
 * §11 — "RTL for HTML components and store logic."
 *
 * The store is the coordination layer between both render trees (§3, §6), so its
 * invariants are worth pinning directly rather than only through the UI.
 */
describe('sceneStore', () => {
  beforeEach(() => {
    useSceneStore.setState({
      focusedIndex: 0,
      isTransitioning: false,
      transitionMode: 'horizontal',
      reducedMotion: false,
      hoveredNodeId: null,
      inspectorNodeId: null,
    });
  });

  it('clamps focusedIndex to the section range rather than wrapping', () => {
    const { setFocusedIndex } = useSceneStore.getState();

    setFocusedIndex(-5);
    expect(useSceneStore.getState().focusedIndex).toBe(0);

    setFocusedIndex(999);
    expect(useSceneStore.getState().focusedIndex).toBe(SECTIONS.length - 1);
  });

  it('marks a transition as in-flight on focus change, for the §5.1 input lock', () => {
    useSceneStore.getState().setFocusedIndex(2);
    expect(useSceneStore.getState().isTransitioning).toBe(true);
  });

  it('does not re-trigger a transition when the index is unchanged', () => {
    useSceneStore.getState().setFocusedIndex(0);
    expect(useSceneStore.getState().isTransitioning).toBe(false);
  });

  it('clears hover state on focus change, so a stale tooltip cannot survive a move', () => {
    useSceneStore.getState().setHoveredNodeId('src/App.tsx#root');
    useSceneStore.getState().setFocusedIndex(1);
    expect(useSceneStore.getState().hoveredNodeId).toBeNull();
  });

  it('advanceFocus steps relative to the current index', () => {
    useSceneStore.getState().advanceFocus(2);
    expect(useSceneStore.getState().focusedIndex).toBe(2);
    useSceneStore.getState().advanceFocus(-1);
    expect(useSceneStore.getState().focusedIndex).toBe(1);
  });

  /**
   * §5.2 / §4.7 — "the preference and the accessibility fallback share one code path
   * instead of being two separate branches to maintain."
   */
  it('forces transitionMode to off when reduced motion is enabled', () => {
    useSceneStore.getState().setTransitionMode('vertical');
    expect(useSceneStore.getState().transitionMode).toBe('vertical');

    useSceneStore.getState().setReducedMotion(true);
    expect(useSceneStore.getState().transitionMode).toBe('off');
  });

  it('persists transitionMode and themeMode to localStorage', () => {
    useSceneStore.getState().setTransitionMode('vertical');
    useSceneStore.getState().setThemeMode('light');

    expect(localStorage.getItem('portfolio:transitionMode')).toBe('vertical');
    expect(localStorage.getItem('portfolio:themeMode')).toBe('light');
  });

  it('replaces inspector content rather than stacking panels (§4.6)', () => {
    useSceneStore.getState().openInspector('a#root');
    useSceneStore.getState().openInspector('b#root');
    expect(useSceneStore.getState().inspectorNodeId).toBe('b#root');

    useSceneStore.getState().closeInspector();
    expect(useSceneStore.getState().inspectorNodeId).toBeNull();
  });
});
