import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  setEnvPreviewEnabled,
  setEnvPreviewExposure,
  useEnvPreview,
  type EnvPreviewImage,
} from '../scene/envStore.ts';
import styles from './SceneEditor.module.css';

/**
 * Live views of the baked environment.
 *
 * EDITOR ONLY.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * Without it you are inferring the environment's shape from its reflection on small,
 * rough, faceted objects — which is like tuning a light by looking at the shadows. Every
 * parameter in the Environment group is nearly unusable until you can see what it does
 * to the map directly.
 *
 * Two views, because they answer different questions:
 *
 *   Unwrapped   what the pattern IS. Direct, undistorted, the thing you are authoring.
 *   Probe       what it DOES. And specifically at two roughnesses, which matters more
 *               than it sounds — see below.
 *
 * ── Why the probe has two balls ──────────────────────────────────────────────────────
 * The mirror ball is the honest view of the environment's content. At the node
 * material's real roughness the PMREM chain has already blurred fine structure into the
 * upper mips, so a detailed map and a vague one look nearly identical on the nodes — you
 * can spend an hour adding meridians that are being averaged away. The mirror shows you
 * what survived the bake before roughness eats it.
 *
 * The glass ball wears the actual node material, so it answers the question the mirror
 * cannot: is any of this reaching the thing people will look at? It is also where you
 * check whether the dispersion fringing is reading, which is the entire reason for
 * putting hard edges in the pattern in the first place.
 */

/** Blits a readback into a canvas, sizing the backing store to the image. */
function useImageCanvas(image: EnvPreviewImage | null): React.RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;

    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }

    const context = canvas.getContext('2d');
    if (!context) return;

    /*
     * `createImageData` + `set` rather than `new ImageData(pixels, w, h)`.
     *
     * TypeScript 5.7 made the typed-array types generic over their backing buffer, and
     * the ImageData constructor requires specifically `Uint8ClampedArray<ArrayBuffer>`
     * while a plain `Uint8ClampedArray` widens to `ArrayBufferLike` (which admits
     * `SharedArrayBuffer`). Going through `createImageData` sidesteps the mismatch
     * without pinning the store's type to a lib-version-specific generic, and copies the
     * same bytes.
     */
    const target = context.createImageData(image.width, image.height);
    target.data.set(image.pixels);
    context.putImageData(target, 0, 0);
  }, [image]);

  return ref;
}

/**
 * One line of provenance under each canvas.
 *
 * A blank canvas has several possible causes that look identical: no readback arrived,
 * a readback of the wrong size arrived, or an image arrived and is simply very dark.
 * Reporting the dimensions and mean luminance separates them at a glance, which is worth
 * far more than the two lines it costs — the alternative is guessing at a black
 * rectangle.
 */
function describe(image: EnvPreviewImage | null): string {
  if (!image) return 'no data';

  // Cheap sample rather than a full scan: every 64th pixel is plenty to tell "black"
  // from "dark" from "fine", and this runs on every bake.
  let total = 0;
  let samples = 0;
  for (let i = 0; i < image.pixels.length; i += 256) {
    total += (image.pixels[i] ?? 0) + (image.pixels[i + 1] ?? 0) + (image.pixels[i + 2] ?? 0);
    samples += 3;
  }
  const mean = samples > 0 ? total / samples : 0;
  return `${image.width}x${image.height} · mean ${mean.toFixed(0)}/255`;
}

export function EnvPreview(): ReactNode {
  const preview = useEnvPreview();
  const [exposure, setExposure] = useState(1);
  const [collapsed, setCollapsed] = useState(false);

  const equirectRef = useImageCanvas(preview.equirect);
  const probeRef = useImageCanvas(preview.probe);

  /**
   * Readbacks are a synchronous GPU stall, so they are off unless this component is
   * actually mounted and expanded. Collapsing the section genuinely stops the work
   * rather than just hiding the result.
   */
  useEffect(() => {
    setEnvPreviewEnabled(!collapsed);
    return () => setEnvPreviewEnabled(false);
  }, [collapsed]);

  // Exposure lives in the store rather than being passed down, because the shader that
  // applies it runs inside the Canvas and this panel is in a separate React root.
  useEffect(() => {
    setEnvPreviewExposure(exposure);
  }, [exposure]);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <button
          type="button"
          className={styles.groupHeader}
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          Environment preview
        </button>
        <span className={styles.sectionNote}>
          {collapsed
            ? 'Paused — readbacks stall the GPU.'
            : `Last bake ${preview.bakeMs.toFixed(1)}ms`}
        </span>
      </h3>

      {collapsed ? null : (
        <div className={styles.previewBody}>
          <figure className={styles.preview}>
            <canvas ref={equirectRef} className={styles.previewCanvas} />
            <figcaption className={styles.previewCaption}>
              Unwrapped — what you are authoring
              <span className={styles.previewStat}>{describe(preview.equirect)}</span>
            </figcaption>
          </figure>

          <figure className={styles.preview}>
            <canvas ref={probeRef} className={styles.previewCanvas} />
            <figcaption className={styles.previewCaption}>
              Mirror (structure) · glass (what nodes see)
              <span className={styles.previewStat}>{describe(preview.probe)}</span>
            </figcaption>
          </figure>

          {/*
            Display-only, so it lives in local state rather than SceneConfig — nothing
            here should ever end up in an export. It exists because the dark theme's
            environment is near-black by design and its structure is invisible at 1.0.
          */}
          <div className={styles.control}>
            <label className={styles.label} title="Preview brightness only. Not exported.">
              Exposure
            </label>
            <input
              type="range"
              className={styles.range}
              min={0.1}
              max={12}
              step={0.1}
              value={exposure}
              onChange={(event) => setExposure(Number(event.target.value))}
              aria-label="Preview exposure"
            />
            <input
              type="number"
              className={styles.number}
              step={0.1}
              value={exposure}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) setExposure(next);
              }}
              aria-label="Preview exposure value"
            />
          </div>
        </div>
      )}
    </section>
  );
}