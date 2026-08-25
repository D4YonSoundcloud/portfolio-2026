import { useSyncExternalStore } from 'react';
import type { Texture } from 'three';

/**
 * Carries the baked environment map out of the R3F tree, and the editor previews out to
 * the panel.
 *
 * ── Why a store and not props ────────────────────────────────────────────────────────
 * The bake needs `useThree().gl`, so it has to happen INSIDE the Canvas. The panel lives
 * in a separate React root outside it (see `editor/mountEditor.tsx`). A module-level
 * store is the same mechanism §6 already uses to cross that boundary, reused here for
 * the same reason. It also saves threading `envMap` down through `Scene` into every
 * `AstNodes` instance.
 *
 * ── The preview half is editor-only ──────────────────────────────────────────────────
 * `readRenderTargetPixels` is a synchronous GPU stall. It runs only when
 * `__SCENE_EDITOR__` is true and only on a bake — never per frame — and the whole preview
 * path is dropped from production builds along with the panel.
 */

/** A readback of one preview render target, ready to blit into a 2D canvas. */
export interface EnvPreviewImage {
  width: number;
  height: number;
  /** RGBA, top-down (already flipped from WebGL's bottom-up readback). */
  pixels: Uint8ClampedArray;
}

export interface EnvPreview {
  /** The environment itself, unwrapped. Shows the pattern's structure directly. */
  equirect: EnvPreviewImage | null;
  /**
   * Two spheres: a mirror ball, which shows what the environment actually contains, and
   * a ball wearing the real node material, which shows what that does to your glass.
   */
  probe: EnvPreviewImage | null;
  /** Milliseconds the last full bake took, PMREM prefilter included. */
  bakeMs: number;
  revision: number;
}

const EMPTY_PREVIEW: EnvPreview = { equirect: null, probe: null, bakeMs: 0, revision: 0 };

let envMap: Texture | null = null;
let preview: EnvPreview = EMPTY_PREVIEW;
let previewEnabled = false;
let previewExposure = 1;

const envMapListeners = new Set<() => void>();
const previewListeners = new Set<() => void>();
const enabledListeners = new Set<() => void>();
const exposureListeners = new Set<() => void>();

export function setEnvMap(texture: Texture | null): void {
  if (envMap === texture) return;
  envMap = texture;
  for (const listener of envMapListeners) listener();
}

/** Non-subscribing read, for use inside `useFrame`. */
export function readEnvMap(): Texture | null {
  return envMap;
}

export function useEnvMap(): Texture | null {
  return useSyncExternalStore(
    (listener) => {
      envMapListeners.add(listener);
      return () => envMapListeners.delete(listener);
    },
    () => envMap,
    () => null,
  );
}

/**
 * EDITOR ONLY — turns the preview readbacks on and off.
 *
 * The panel calls this as it opens and closes. Nothing in production ever calls it, so
 * `previewEnabled` stays false and `EnvironmentBaker` never issues a readback.
 */
export function setEnvPreviewEnabled(value: boolean): void {
  if (!__SCENE_EDITOR__ || previewEnabled === value) return;
  previewEnabled = value;
  for (const listener of enabledListeners) listener();
}

/**
 * Subscribed by `Scene`, which is production code — so this is an ordinary hook that is
 * always called, never a conditional one. It simply always reports false in a production
 * build, and the `__SCENE_EDITOR__` guard inside the baker folds the branch away.
 */
export function useEnvPreviewEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      enabledListeners.add(listener);
      return () => enabledListeners.delete(listener);
    },
    () => previewEnabled,
    () => false,
  );
}

/**
 * EDITOR ONLY — preview brightness.
 *
 * Display-only and deliberately NOT part of `SceneConfig`: it must never appear in an
 * export. It exists because the dark theme's environment is near-black by design, and
 * its structure is simply invisible in the preview at 1.0.
 */
export function setEnvPreviewExposure(value: number): void {
  if (!__SCENE_EDITOR__ || previewExposure === value) return;
  previewExposure = value;
  for (const listener of exposureListeners) listener();
}

export function useEnvPreviewExposure(): number {
  return useSyncExternalStore(
    (listener) => {
      exposureListeners.add(listener);
      return () => exposureListeners.delete(listener);
    },
    () => previewExposure,
    () => 1,
  );
}

/** EDITOR ONLY — guarded so a production build cannot be made to pay for readbacks. */
export function setEnvPreview(next: Omit<EnvPreview, 'revision'>): void {
  if (!__SCENE_EDITOR__) return;
  preview = { ...next, revision: preview.revision + 1 };
  for (const listener of previewListeners) listener();
}

export function useEnvPreview(): EnvPreview {
  return useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    },
    () => preview,
    () => EMPTY_PREVIEW,
  );
}