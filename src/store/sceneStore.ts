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

export type TransitionMode = 'vertical' | 'horizontal' | 'off';
export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type Quality = 'high' | 'medium' | 'low';

/** See `SceneStore.interactionMode`. */
export type InteractionMode = 'sections' | 'tree' | 'explore';

/**
 * Which graph a traversal step walks.
 *
 * 'tree'   parent/child within one source file — the existing wheel behaviour
 * 'module' import edges between files — shift+wheel, and the right-hand mobile buttons
 */
export type NavAxis = 'tree' | 'module';

export interface NavRequest {
  axis: NavAxis;
  /** 1 steps deeper or follows an import; -1 steps back or towards a dependent. */
  direction: 1 | -1;
  nonce: number;
}

let navNonce = 0;
function nextNavNonce(): number {
  navNonce += 1;
  return navNonce;
}

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
  /**
   * Which input mode owns the wheel, arrows and pointer.
   *
   * Before this, coordination was implicit: `useFocusNav` disabled itself when the
   * inspector was open, and that single `if` was enough because there were exactly two
   * consumers. There are now four — the section carousel, tree traversal, module
   * traversal, and free-camera dolly — and implicit coordination does not survive four.
   * Every handler now declares which modes it answers to, so the arbitration is one
   * enumerated decision rather than a web of conditions that only happens to agree.
   *
   *   'sections'  the carousel owns input; the default
   *   'tree'      a node is open in the inspector and the wheel walks the AST
   *   'explore'   the visitor drives the camera; CameraRig stands down
   */
  interactionMode: InteractionMode;
  /**
   * The most recent traversal step requested from outside the Canvas.
   *
   * Traversal has to run inside the Canvas because branch ordering depends on the live
   * camera pose, but the mobile buttons are DOM. They publish intent here and
   * `TreeTraversal` consumes it — the same cross-boundary pattern the rest of the scene
   * uses. `nonce` exists so that pressing the same button twice fires twice; without it
   * an identical (axis, direction) pair would be indistinguishable from no new request.
   */
  navRequest: NavRequest | null;
  quality: Quality;
  /**
   * Freezes `quality` against `PerformanceMonitor`, which otherwise re-tiers on its own
   * schedule. Only the dev scene editor sets this; it is false in every normal session.
   */
  qualityPinned: boolean;
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
  setInteractionMode: (mode: InteractionMode) => void;
  /** Ask for one traversal step. Consumed inside the Canvas; see `navRequest`. */
  requestNav: (axis: NavAxis, direction: 1 | -1) => void;
  /** Called by the consumer once a request has been acted on. */
  clearNavRequest: () => void;
  setQuality: (quality: Quality) => void;
  setQualityPinned: (value: boolean) => void;
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
        ['vertical', 'horizontal', 'off'],
        'vertical',
      ),

  themeMode: readStored<ThemeMode>(THEME_KEY, ['dark', 'light', 'system'], 'system'),
  resolvedTheme: 'dark',
  hoveredNodeId: null,
  inspectorNodeId: null,
  reducedMotion,
  interactionMode: 'sections',
  navRequest: null,
  quality: seedQuality(),
  qualityPinned: false,
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
  setInteractionMode: (mode) => set({ interactionMode: mode }),
  requestNav: (axis, direction) =>
    set({ navRequest: { axis, direction, nonce: nextNavNonce() } }),
  clearNavRequest: () => set({ navRequest: null }),
  setQuality: (quality) => set({ quality }),
  setQualityPinned: (value) => set({ qualityPinned: value }),
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