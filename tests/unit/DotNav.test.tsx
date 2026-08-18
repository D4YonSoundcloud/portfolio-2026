import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DotNav } from '../../src/navigation/DotNav.tsx';
import { useSceneStore } from '../../src/store/sceneStore.ts';
import { SECTIONS } from '../../src/sections/sections.ts';

/**
 * §11 — "all four paths need to land on the same focusedIndex."
 *
 * Two of the four (dot-nav, keyboard) are testable in jsdom and covered here. Wheel and
 * touch need real event geometry and a real layout, so they live in the Playwright suite
 * (tests/e2e) rather than being faked here.
 */
describe('DotNav', () => {
  beforeEach(() => {
    useSceneStore.setState({ focusedIndex: 0, transitionMode: 'horizontal' });
  });

  it('renders one control per focus item', () => {
    render(<DotNav />);
    expect(screen.getAllByRole('button')).toHaveLength(SECTIONS.length);
  });

  /**
   * §5.1 / §9 — "this exists specifically so nobody is *required* to use the
   * gesture-capture system to navigate."
   */
  it('sets focusedIndex directly, without routing through gesture capture', async () => {
    const user = userEvent.setup();
    render(<DotNav />);

    await user.click(screen.getByRole('button', { name: /projects/i }));
    expect(useSceneStore.getState().focusedIndex).toBe(2);

    await user.click(screen.getByRole('button', { name: /introduction/i }));
    expect(useSceneStore.getState().focusedIndex).toBe(0);
  });

  it('marks the active item with aria-current for assistive tech', () => {
    useSceneStore.setState({ focusedIndex: 3 });
    render(<DotNav />);

    const active = screen.getByRole('button', { name: /experience/i });
    expect(active).toHaveAttribute('aria-current', 'true');
  });

  /**
   * §14 open question — dots stacked vertically for a horizontal carousel is the common
   * convention. Pinning it here so flipping it is a deliberate change, not a drift.
   */
  it('orients opposite to the carousel axis', () => {
    const { container, rerender } = render(<DotNav />);
    expect(container.querySelector('nav')).toHaveAttribute('data-orientation', 'vertical');

    act(() => useSceneStore.setState({ transitionMode: 'vertical' }));
    rerender(<DotNav />);
    expect(container.querySelector('nav')).toHaveAttribute('data-orientation', 'horizontal');
  });
});
