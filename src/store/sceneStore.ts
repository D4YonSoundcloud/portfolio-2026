import { create } from 'zustand';
import { SECTIONS } from '../sections/sections.ts';

/**
 * §6 — State management.
 *
 * Deliberately small. This is a coordination layer between two render trees (§3), not
 * general app state. Content itself (copy, project data) stays as static local data in
 * `sections/content.ts` and never enters this store.
 *
 * It lives at module level specifically because React Context does not reliably span the
 * <Canvas> boundary — R3F reconciles into its own tree (§2, §3).
 */

export type TransitionMode = 'horizontal' | 'vertical' | 'off';
export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type Quality = 'high' | 'medium' | 'low';

const TRANSITION_KEY = 'portfolio:transitionMode';
const THEME_KEY = 'portfolio:themeMode';
const DEPTH_KEY = 'portfolio:maxDepth';

/**
 * Depth levels offered by the filter. The build-time pipeline caps extraction at depth 6
 * (MAX_DEPTH in generate-ast-graph.ts), so 6 means "everything that exists".
 */
export const DEPTH_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export const MAX_DEPTH_LEVEL = 6;

export interface SceneStore {
  focusedIndex: number;
  isTransitioning: boolean;
  transitionMode: TransitionMode;
  themeMode: ThemeMode;
  /** `themeMode` resolved against the OS preference — what the DOM and materials read. */
  resolvedTheme: ResolvedTheme;
  hoveredNodeId: string | null;
  inspectorNodeId: string | null;
  reducedMotion: boolean;
  quality: Quality;
  isCoarsePointer: boolean;
  /** Deepest AST level rendered. Also bounds tree traversal (§4.5). */
  maxDepth: number;

  setFocusedIndex: (index: number) => void;
  advanceFocus: (delta: number) => void;
  setTransitioning: (value: boolean) => void;
  setTransitionMode: (mode: TransitionMode) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setResolvedTheme: (theme: ResolvedTheme) => void;
  setHoveredNodeId: (id: string | null) => void;
  openInspector: (id: string) => void;
  closeInspector: () => void;
  setReducedMotion: (value: boolean) => void;
  setQuality: (quality: Quality) => void;
  setCoarsePointer: (value: boolean) => void;
  setMaxDepth: (depth: number) => void;
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    // Private browsing / disabled storage — the preference just doesn't persist.
    return fallback;
  }
}

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const parsed = Number.parseInt(window.localStorage.getItem(key) ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* non-fatal */
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * §8.3 — mobile seeds to 'low' rather than starting high and waiting for
 * PerformanceMonitor to catch a janky first few seconds. Coarse heuristic at boot;
 * PerformanceMonitor fine-tunes upward from there if the device handles it.
 */
function seedQuality(): Quality {
  if (typeof window === 'undefined') return 'high';
  const narrow = window.innerWidth < 768;
  const coarse = isCoarsePointer();
  const cores = navigator.hardwareConcurrency ?? 4;

  if (narrow || coarse) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

const reducedMotion = prefersReducedMotion();

export const useSceneStore = create<SceneStore>((set, get) => ({
  focusedIndex: 0,
  isTransitioning: false,

  // §5.2 — default 'horizontal', unless prefers-reduced-motion, in which case 'off'.
  // The preference and the accessibility fallback share one code path rather than
  // being two separate branches to maintain.
  transitionMode: reducedMotion
    ? 'off'
    : readStored<TransitionMode>(
        TRANSITION_KEY,
        ['horizontal', 'vertical', 'off'],
        'vertical',
      ),

  themeMode: readStored<ThemeMode>(THEME_KEY, ['dark', 'light', 'system'], 'system'),
  resolvedTheme: 'dark',
  hoveredNodeId: null,
  inspectorNodeId: null,
  reducedMotion,
  quality: seedQuality(),
  isCoarsePointer: isCoarsePointer(),
  maxDepth: readStoredNumber(DEPTH_KEY, MAX_DEPTH_LEVEL),

  setFocusedIndex: (index) => {
    const clamped = Math.max(0, Math.min(SECTIONS.length - 1, index));
    if (clamped === get().focusedIndex) return;
    set({ focusedIndex: clamped, isTransitioning: true, hoveredNodeId: null });
  },

  advanceFocus: (delta) => {
    get().setFocusedIndex(get().focusedIndex + delta);
  },

  setTransitioning: (value) => set({ isTransitioning: value }),

  setTransitionMode: (mode) => {
    persist(TRANSITION_KEY, mode);
    set({ transitionMode: mode });
  },

  setThemeMode: (mode) => {
    persist(THEME_KEY, mode);
    set({ themeMode: mode });
  },

  setResolvedTheme: (theme) => set({ resolvedTheme: theme }),
  setHoveredNodeId: (id) => set({ hoveredNodeId: id }),
  openInspector: (id) => set({ inspectorNodeId: id, hoveredNodeId: null }),
  closeInspector: () => set({ inspectorNodeId: null }),
  setReducedMotion: (value) =>
    set(value ? { reducedMotion: true, transitionMode: 'off' } : { reducedMotion: false }),
  setQuality: (quality) => set({ quality }),
  setCoarsePointer: (value) => set({ isCoarsePointer: value }),

  setMaxDepth: (depth) => {
    const clamped = Math.max(1, Math.min(MAX_DEPTH_LEVEL, Math.round(depth)));
    persist(DEPTH_KEY, String(clamped));
    // Closing the inspector too: a traversal session anchored on a node that the new
    // filter has just hidden would leave the panel showing something invisible.
    set({ maxDepth: clamped, hoveredNodeId: null, inspectorNodeId: null });
  },
}));

/**
 * Read the store from inside `useFrame` without subscribing the component to updates —
 * re-rendering an R3F component every frame defeats the point of the render loop.
 */
export const readSceneStore = useSceneStore.getState;