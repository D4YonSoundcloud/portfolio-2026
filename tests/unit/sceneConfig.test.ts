import { describe, expect, it } from 'vitest';

import {
  SCENE_DEFAULTS,
  applySceneOverrides,
  emptyOverrides,
  readPath,
  readSceneConfig,
} from '../../src/scene/sceneConfig.ts';
import { SHARED_FIELDS, THEMED_FIELDS } from '../../src/editor/fields.ts';

/**
 * The config layer's job in production is to be inert. These tests pin down the two
 * things that would fail silently rather than loudly: the override mutator running when
 * it shouldn't, and the editor metadata drifting out of range of the values it edits.
 *
 * `__SCENE_EDITOR__` is defined as `false` in vitest.config.ts, so this file exercises
 * the same code path a production build does.
 */

describe('scene config', () => {
  it('is inert in a production build', () => {
    // The whole safety story rests on this: even if editor code somehow survived
    // tree-shaking and called the mutator, the deployed scene must not move.
    const overrides = emptyOverrides();
    overrides.shared['camera.viewDistance'] = 999;

    applySceneOverrides(overrides);

    expect(readSceneConfig().shared.camera.viewDistance).toBe(
      SCENE_DEFAULTS.shared.camera.viewDistance,
    );
    expect(readSceneConfig().revision).toBe(0);
  });

  it('resolves every documented path against the defaults', () => {
    // A path that resolves to undefined means the metadata and the config disagree
    // about the shape of the tree — the one drift the exhaustive Record cannot catch,
    // since it only checks the SET of keys, not that each one still points at a number.
    for (const path of Object.keys(THEMED_FIELDS)) {
      expect(readPath(SCENE_DEFAULTS.themed.dark, path), `themed.dark.${path}`).toBeTypeOf('number');
      expect(readPath(SCENE_DEFAULTS.themed.light, path), `themed.light.${path}`).toBeTypeOf(
        'number',
      );
    }
    for (const path of Object.keys(SHARED_FIELDS)) {
      expect(readPath(SCENE_DEFAULTS.shared, path), `shared.${path}`).toBeTypeOf('number');
    }
  });

  it('keeps every default inside its slider range', () => {
    // A default outside its own control's min/max means the slider jumps the moment you
    // touch it, silently discarding the shipped value. Cheap to assert, annoying to
    // debug from the UI.
    for (const [path, meta] of Object.entries(THEMED_FIELDS)) {
      for (const theme of ['dark', 'light'] as const) {
        const value = readPath(SCENE_DEFAULTS.themed[theme], path) ?? Number.NaN;
        expect(value, `themed.${theme}.${path}`).toBeGreaterThanOrEqual(meta.min);
        expect(value, `themed.${theme}.${path}`).toBeLessThanOrEqual(meta.max);
      }
    }
    for (const [path, meta] of Object.entries(SHARED_FIELDS)) {
      const value = readPath(SCENE_DEFAULTS.shared, path) ?? Number.NaN;
      expect(value, `shared.${path}`).toBeGreaterThanOrEqual(meta.min);
      expect(value, `shared.${path}`).toBeLessThanOrEqual(meta.max);
    }
  });
});