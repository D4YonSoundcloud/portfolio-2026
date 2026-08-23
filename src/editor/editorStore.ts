import { create } from 'zustand';

import {
  applySceneOverrides,
  bumpSceneRevision,
  emptyOverrides,
  type SceneOverrides,
  type SharedPath,
  type ThemedPath,
} from '../scene/sceneConfig.ts';
import type { ResolvedTheme } from '../store/sceneStore.ts';

/**
 * Editor state — the pending overrides, the live token edits, and panel UI state.
 *
 * EDITOR ONLY. Kept out of `store/sceneStore.ts` on purpose: §6 describes that store as
 * a coordination layer between the two render trees, and a dev tool's collapsed-section
 * state is not that. Zustand is already a dependency, so this costs nothing extra — and
 * because it is only ever imported from `editor/`, it leaves with the rest of the tree.
 *
 * ── Two kinds of edit, two destinations ──────────────────────────────────────────────
 * `overrides` feeds `applySceneOverrides`, which rebuilds the scene config snapshot.
 * `tokens` is written straight onto <html> as an inline custom property, then a
 * revision bump makes `Scene` re-run `readPalette()` to pick it up. They export to
 * different files, so they are tracked separately rather than merged into one bag.
 */

const STORAGE_KEY = 'portfolio:editor:overrides';

/** Token edits, keyed by theme then custom-property name. Values are raw CSS strings. */
export type TokenOverrides = Record<ResolvedTheme, Record<string, string>>;

interface PersistedState {
  overrides: SceneOverrides;
  tokens: TokenOverrides;
}

export interface EditorStore {
  overrides: SceneOverrides;
  tokens: TokenOverrides;
  /** Panel sections the user has collapsed, by group name. */
  collapsed: Record<string, boolean>;
  /** Whether the panel is showing at all. Toggled with the keyboard shortcut. */
  open: boolean;

  setThemedValue: (theme: ResolvedTheme, path: ThemedPath, value: number) => void;
  setSharedValue: (path: SharedPath, value: number) => void;
  setToken: (theme: ResolvedTheme, cssVar: string, value: string) => void;
  resetField: (theme: ResolvedTheme, path: ThemedPath | SharedPath, scope: 'themed' | 'shared') => void;
  resetToken: (theme: ResolvedTheme, cssVar: string) => void;
  resetAll: () => void;
  toggleGroup: (group: string) => void;
  setOpen: (open: boolean) => void;
}

function emptyTokens(): TokenOverrides {
  return { dark: {}, light: {} };
}

function readPersisted(): PersistedState {
  const blank: PersistedState = { overrides: emptyOverrides(), tokens: emptyTokens() };
  if (typeof window === 'undefined') return blank;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return blank;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      overrides: {
        themed: {
          dark: parsed.overrides?.themed?.dark ?? {},
          light: parsed.overrides?.themed?.light ?? {},
        },
        shared: parsed.overrides?.shared ?? {},
      },
      tokens: {
        dark: parsed.tokens?.dark ?? {},
        light: parsed.tokens?.light ?? {},
      },
    };
  } catch {
    // A malformed or stale blob is not worth a crash in a dev tool — start clean.
    return blank;
  }
}

function persist(state: PersistedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* non-fatal — the session just won't survive a reload */
  }
}

/**
 * Pushes a token override onto <html> as an inline style, which outranks the
 * `[data-theme]` rule in `tokens.css` without editing the stylesheet.
 *
 * Only the ACTIVE theme's tokens are applied. Inline styles have no theme scoping, so
 * applying both blocks at once would leave the dark values sitting on top of the light
 * design the moment the theme is switched.
 */
function applyTokens(tokens: TokenOverrides, theme: ResolvedTheme): void {
  const root = document.documentElement;
  const other: ResolvedTheme = theme === 'dark' ? 'light' : 'dark';

  for (const cssVar of Object.keys(tokens[other])) {
    if (!(cssVar in tokens[theme])) root.style.removeProperty(cssVar);
  }
  for (const [cssVar, value] of Object.entries(tokens[theme])) {
    root.style.setProperty(cssVar, value);
  }
  bumpSceneRevision();
}

const initial = readPersisted();

export const useEditorStore = create<EditorStore>((set, get) => ({
  overrides: initial.overrides,
  tokens: initial.tokens,
  collapsed: {},
  open: true,

  setThemedValue: (theme, path, value) => {
    const overrides: SceneOverrides = {
      themed: { ...get().overrides.themed, [theme]: { ...get().overrides.themed[theme], [path]: value } },
      shared: get().overrides.shared,
    };
    set({ overrides });
    applySceneOverrides(overrides);
    persist({ overrides, tokens: get().tokens });
  },

  setSharedValue: (path, value) => {
    const overrides: SceneOverrides = {
      themed: get().overrides.themed,
      shared: { ...get().overrides.shared, [path]: value },
    };
    set({ overrides });
    applySceneOverrides(overrides);
    persist({ overrides, tokens: get().tokens });
  },

  setToken: (theme, cssVar, value) => {
    const tokens: TokenOverrides = { ...get().tokens, [theme]: { ...get().tokens[theme], [cssVar]: value } };
    set({ tokens });
    applyTokens(tokens, theme);
    persist({ overrides: get().overrides, tokens });
  },

  resetField: (theme, path, scope) => {
    const current = get().overrides;
    let overrides: SceneOverrides;

    if (scope === 'themed') {
      const next = { ...current.themed[theme] };
      delete next[path as ThemedPath];
      overrides = { themed: { ...current.themed, [theme]: next }, shared: current.shared };
    } else {
      const next = { ...current.shared };
      delete next[path as SharedPath];
      overrides = { themed: current.themed, shared: next };
    }

    set({ overrides });
    applySceneOverrides(overrides);
    persist({ overrides, tokens: get().tokens });
  },

  resetToken: (theme, cssVar) => {
    const next = { ...get().tokens[theme] };
    delete next[cssVar];
    const tokens: TokenOverrides = { ...get().tokens, [theme]: next };

    // removeProperty first: applyTokens only re-adds what is still in the map, so
    // without this the stale inline value would survive its own deletion.
    document.documentElement.style.removeProperty(cssVar);

    set({ tokens });
    applyTokens(tokens, theme);
    persist({ overrides: get().overrides, tokens });
  },

  resetAll: () => {
    const root = document.documentElement;
    for (const theme of ['dark', 'light'] as const) {
      for (const cssVar of Object.keys(get().tokens[theme])) root.style.removeProperty(cssVar);
    }

    const overrides = emptyOverrides();
    const tokens = emptyTokens();
    set({ overrides, tokens });
    applySceneOverrides(overrides);
    bumpSceneRevision();
    persist({ overrides, tokens });
  },

  toggleGroup: (group) => set({ collapsed: { ...get().collapsed, [group]: !get().collapsed[group] } }),
  setOpen: (open) => set({ open }),
}));

/**
 * Replays whatever was persisted from the last session.
 *
 * Called once at mount, and again whenever the theme changes so the correct block of
 * token overrides is the one sitting on <html>.
 */
export function rehydrateEditor(theme: ResolvedTheme): void {
  const { overrides, tokens } = useEditorStore.getState();
  applySceneOverrides(overrides);
  applyTokens(tokens, theme);
}