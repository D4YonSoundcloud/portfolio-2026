import { useSyncExternalStore } from 'react';

import type { ResolvedTheme } from '../store/sceneStore.ts';

/**
 * Every numeric tunable in the R3F scene, in one place.
 *
 * ── Why this module exists ───────────────────────────────────────────────────────────
 * Before this, the values that shape the scene lived in three unrelated kinds of place:
 * CSS custom properties in `design/tokens.css`, inline JSX props in `Scene.tsx`, and
 * module-level `const`s scattered across `CameraRig`, `nodeMaterial`, `AstNodes` and
 * `SelectionOverlay`. Tuning the look meant hunting for a number, editing it, and
 * waiting for a reload — and there was no way to see what the full set of knobs even was.
 *
 * This module is the second of the two sources of truth, and the boundary between them
 * is deliberate:
 *
 *   `design/tokens.css`  — anything that is genuinely a DESIGN TOKEN: colours, opacities,
 *                          node scale. Read by both the DOM layer and `palette.ts`, so
 *                          §7.2's "one source of truth" rule still holds for colour.
 *   `sceneConfig.ts`     — everything that is RENDER PHYSICS: light intensities, fog
 *                          distances, post-processing, camera motion, material optics,
 *                          LOD thresholds, animation attack times.
 *
 * Camera drift speed is not a design token and has no business being expressed as a CSS
 * custom property; a category colour is not render physics and has no business being a
 * TypeScript literal. Keeping the split honest is why there are two files rather than
 * one grab-bag.
 *
 * ── What ships ───────────────────────────────────────────────────────────────────────
 * `SCENE_DEFAULTS` below IS the production configuration. In a production build the
 * override layer is never written to, so `useSceneConfig` returns the frozen defaults
 * and the whole editor — panel, schema metadata, persistence — is absent from the
 * bundle (see `main.tsx` and `scripts/check-no-editor.ts`).
 *
 * ── Themed vs shared ─────────────────────────────────────────────────────────────────
 * Some values differ between the two designs (§7.2 — light is a genuine second design,
 * not inverted colours) and some are the same in both. They are separated at the type
 * level rather than duplicating every field across two theme blocks, so that editing
 * "camera drift speed" cannot silently apply to only one theme.
 */

/** Values that differ between the dark and light designs (§7.2). */
export interface ThemedValues {
  lights: {
    /** §4.4 — the nodes' emissive does the work on dark; ambient carries light. */
    ambientIntensity: number;
    keyIntensity: number;
  };
  material: {
    /** Per-channel IOR offset — this is the colour fringing. */
    dispersion: number;
    /** Fresnel falloff exponent. Higher = a tighter rim confined to grazing angles. */
    rimPower: number;
    roughness: number;
    sheen: number;
  };
  bloom: {
    intensity: number;
    /** Luminance above which a pixel blooms. Dark theme only (§4.4). */
    threshold: number;
    smoothing: number;
  };
  vignette: {
    /** Light theme only — bloom is replaced wholesale, not recoloured (§7.2). */
    offset: number;
    darkness: number;
  };
  selection: {
    ringOpacity: number;
    shellOpacity: number;
  };
}

/** Values that are identical in both themes. */
export interface SharedValues {
  lights: {
    keyX: number;
    keyY: number;
    keyZ: number;
  };
  fog: {
    near: number;
    far: number;
  };
  camera: {
    /** How far back from a cluster centroid the camera sits. */
    viewDistance: number;
    /** Amplitude of the autonomous idle drift, in world units. */
    driftRadius: number;
    driftSpeed: number;
    /** Pointer parallax offset at the screen edge. */
    parallax: number;
    parallaxDamping: number;
    /** How close the camera pulls in when a node opens in the inspector. */
    inspectDistance: number;
    /** Seconds for the inspect framing to engage or release. */
    inspectAttack: number;
  };
  material: {
    /** Index of refraction, as the eta passed to `refract()`. */
    ior: number;
    /** Gain on the procedural environment's key lobe. */
    envKeyGain: number;
    /** Multiplier on the palette's emissive, kept low so the Fresnel still reads. */
    emissiveScale: number;
    /** How far a hovered / selected instance expands along its normals. */
    hoverSwell: number;
    selectSwell: number;
  };
  lod: {
    /** §4.5 — deeper nodes fade in only when the camera is near that cluster. */
    near: number;
    far: number;
    /** Nodes at or below this depth are always at full scale. */
    shallowDepth: number;
    /** How often the distance pass runs. Every frame is wasteful. */
    intervalMs: number;
  };
  interaction: {
    /** Seconds for a highlight to reach full strength. Snapping looks like a bug. */
    hoverAttack: number;
    selectAttack: number;
    /** Seconds for the surrounding field to fade once something becomes active. */
    dimAttack: number;
  };
  selection: {
    ringInner: number;
    ringOuter: number;
    shellRadius: number;
    spinX: number;
    spinY: number;
    /** Seconds for a newly selected node's overlay to scale in from nothing. */
    growAttack: number;
  };
}

export interface SceneConfig {
  themed: Record<ResolvedTheme, ThemedValues>;
  shared: SharedValues;
}

/**
 * Production values. Changing a number here changes the deployed site — this is the
 * file the editor's "Export" button produces a replacement block for.
 */
export const SCENE_DEFAULTS: SceneConfig = {
  themed: {
    dark: {
      lights: { ambientIntensity: 0.7, keyIntensity: 1.1 },
      material: { dispersion: 0.035, rimPower: 2.4, roughness: 0.22, sheen: 0.5 },
      // Threshold raised from 0.32: the glass material's Fresnel rims are bright at
      // grazing angles on every one of ~2600 nodes, and lower down the whole cloud
      // blooms into a haze instead of the rims reading as edges.
      bloom: { intensity: 0.32, threshold: 0.1, smoothing: 0.9 },
      // Unused on dark (the composer runs bloom instead) but kept populated so the
      // two theme blocks stay structurally identical and the panel never shows a gap.
      vignette: { offset: 0.35, darkness: 0.28 },
      selection: { ringOpacity: 0.85, shellOpacity: 0.5 },
    },
    light: {
      lights: { ambientIntensity: 1.15, keyIntensity: 0.5 },
      material: { dispersion: 0.022, rimPower: 3.1, roughness: 0.5, sheen: 0.2 },
      bloom: { intensity: 0.32, threshold: 0.1, smoothing: 0.9 },
      vignette: { offset: 0.35, darkness: 0.28 },
      selection: { ringOpacity: 0.7, shellOpacity: 0.42 },
    },
  },
  shared: {
    lights: { keyX: 30, keyY: 40, keyZ: 50 },
    fog: { near: 20, far: 190 },
    camera: {
      viewDistance: 52,
      driftRadius: 3.2,
      driftSpeed: 0.055,
      parallax: 4.5,
      parallaxDamping: 0.045,
      inspectDistance: 13,
      inspectAttack: 0.5,
    },
    material: {
      ior: 0.72,
      envKeyGain: 0.7,
      emissiveScale: 0.25,
      hoverSwell: 0.16,
      selectSwell: 0.3,
    },
    lod: { near: 46, far: 92, shallowDepth: 2, intervalMs: 120 },
    interaction: { hoverAttack: 0.14, selectAttack: 0.22, dimAttack: 0.18 },
    selection: {
      ringInner: 1.5,
      ringOuter: 1.72,
      shellRadius: 1.05,
      spinX: 0.18,
      spinY: 0.35,
      growAttack: 0.2,
    },
  },
};

/* ── Paths ──────────────────────────────────────────────────────────────────────────
 * Overrides are keyed by dotted path ('camera.driftSpeed') rather than by nested object,
 * which makes them trivial to diff against the defaults, serialise to localStorage, and
 * render as a flat list of controls.
 *
 * `NumericPaths` derives the legal set of keys FROM the interfaces above, so the editor
 * schema can be typed as an exhaustive record. Add a field here and the schema stops
 * compiling until it is described — which is what stops the two drifting apart.
 */

type NumericPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends number
    ? `${Prefix}${K}`
    : NumericPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type ThemedPath = NumericPaths<ThemedValues>;
export type SharedPath = NumericPaths<SharedValues>;

export interface SceneOverrides {
  themed: Record<ResolvedTheme, Partial<Record<ThemedPath, number>>>;
  shared: Partial<Record<SharedPath, number>>;
}

export function emptyOverrides(): SceneOverrides {
  return { themed: { dark: {}, light: {} }, shared: {} };
}

/**
 * Reads a dotted path out of a nested config object.
 *
 * The cast is contained here rather than at every call site: `NumericPaths` guarantees
 * the path resolves to a number, but TypeScript cannot follow a runtime `split('.')`
 * walk well enough to prove it.
 */
export function readPath(source: object, path: string): number | undefined {
  const value = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      source,
    );
  return typeof value === 'number' ? value : undefined;
}

/** Writes a dotted path into a nested object, mutating in place. See `readPath`. */
function writePath(target: object, path: string, value: number): void {
  const keys = path.split('.');
  const last = keys.pop();
  if (last === undefined) return;

  let node: Record<string, unknown> = target as Record<string, unknown>;
  for (const key of keys) {
    const next = node[key];
    if (!next || typeof next !== 'object') return;
    node = next as Record<string, unknown>;
  }
  node[last] = value;
}

/* ── The override store ─────────────────────────────────────────────────────────────
 * A hand-rolled external store rather than a Zustand slice, for two reasons. It keeps
 * the scene store to what §6 says it is — a coordination layer between two render trees,
 * not general app state — and it keeps the production cost to a single frozen object and
 * an empty listener set, because nothing ever calls the mutator.
 */

export interface SceneConfigSnapshot extends SceneConfig {
  /**
   * Bumped on every change. `Scene` includes this in the dependency list that triggers
   * a `readPalette()` re-read, so the editor can repaint the scene after writing a CSS
   * custom property — which `readPalette` cannot otherwise know about. Never changes in
   * production.
   */
  revision: number;
}

const INITIAL_SNAPSHOT: SceneConfigSnapshot = { ...SCENE_DEFAULTS, revision: 0 };

let snapshot: SceneConfigSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();

function structuredClone_<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Rebuilds the snapshot from defaults + overrides and notifies subscribers.
 *
 * EDITOR ONLY. Guarded so that a stray call from production code is inert rather than
 * quietly diverging the deployed scene from `SCENE_DEFAULTS`.
 */
export function applySceneOverrides(overrides: SceneOverrides): void {
  if (!__SCENE_EDITOR__) return;

  const next = structuredClone_(SCENE_DEFAULTS);

  for (const theme of ['dark', 'light'] as const) {
    for (const [path, value] of Object.entries(overrides.themed[theme])) {
      if (typeof value === 'number') writePath(next.themed[theme], path, value);
    }
  }
  for (const [path, value] of Object.entries(overrides.shared)) {
    if (typeof value === 'number') writePath(next.shared, path, value);
  }

  snapshot = { ...next, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener();
}

/**
 * Bumps `revision` without touching config values.
 *
 * EDITOR ONLY. Used after writing a CSS custom property, so `Scene` re-runs
 * `readPalette()` and the colour change reaches the materials.
 */
export function bumpSceneRevision(): void {
  if (!__SCENE_EDITOR__) return;
  snapshot = { ...snapshot, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read the config from inside `useFrame` without subscribing — mirrors the
 * `readSceneStore` convention in `store/sceneStore.ts`, and for the same reason:
 * re-rendering an R3F component every frame defeats the point of the render loop.
 */
export function readSceneConfig(): SceneConfigSnapshot {
  return snapshot;
}

/** Subscribing accessor for React components outside the frame loop. */
export function useSceneConfig(): SceneConfigSnapshot {
  return useSyncExternalStore(subscribe, readSceneConfig, () => INITIAL_SNAPSHOT);
}