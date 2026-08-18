import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useSceneStore } from '../store/sceneStore.ts';
import styles from './SceneCanvas.module.css';

/**
 * §4.7 — Performance & fallback strategy.
 *
 * The Canvas is code-split so the ~600KB–1MB of Three.js/R3F/postprocessing never blocks
 * first paint of the HTML content. A static poster frame shows immediately and the live
 * WebGL canvas swaps in once it's mounted.
 *
 * The scene is decorative relative to the content (§9): the canvas is aria-hidden, and
 * every path through this component leaves the site fully usable.
 */

// Both the Canvas and the scene graph live behind this boundary — importing R3F at the
// top level would pull Three.js into the entry chunk and defeat the split.
const LazyScene = lazy(async () => {
  const [{ Canvas }, { Scene }] = await Promise.all([
    import('@react-three/fiber'),
    import('./Scene.tsx'),
  ]);

  return {
    default: function CanvasHost(): ReactNode {
      return (
        <Canvas
          className={styles.canvas}
          // §9 — decorative. All real information lives in semantic HTML, so a screen
          // reader user loses nothing by the scene being absent.
          aria-hidden="true"
          tabIndex={-1}
          camera={{ fov: 55, near: 0.1, far: 400, position: [0, 0, 60] }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
          // The DOM layer sits above and owns pointer input; the scene only claims
          // events on the meshes themselves (§4.6).
          eventSource={document.body}
          eventPrefix="client"
        >
          <Scene />
        </Canvas>
      );
    },
  };
});

/**
 * A cheap capability probe. Cheaper than mounting the Canvas and catching the failure,
 * and it runs before anything heavy is imported.
 */
function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    return context !== null;
  } catch {
    return false;
  }
}

export function SceneCanvas(): ReactNode {
  const reducedMotion = useSceneStore((s) => s.reducedMotion);
  const [mounted, setMounted] = useState(false);

  const hasWebGL = useMemo(detectWebGL, []);

  useEffect(() => {
    // Defer past first paint so the content layer renders first regardless of how fast
    // the scene chunk resolves (§4.7).
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  // §4.7 — under reduced motion the scene drops to the static poster entirely. The
  // camera drift and focus easing are the whole point of the live canvas; without them
  // it's a still image that costs a megabyte.
  const useLiveScene = hasWebGL && mounted && !reducedMotion;

  return (
    <div className={styles.layer} data-live={useLiveScene || undefined}>
      <Poster />
      {useLiveScene ? (
        <Suspense fallback={null}>
          <LazyScene />
        </Suspense>
      ) : null}
    </div>
  );
}

/**
 * §4.7 / §8.3 — the poster frame.
 *
 * Shipped as an SVG rather than a raster screenshot: it's a couple of KB, needs no
 * separate mobile-sized encode (§8.3), scales to any viewport, and picks up the theme
 * from `currentColor`/CSS variables — so it can't show a dark-theme still behind a light
 * page. Replace with a real pre-rendered screenshot if you'd rather have exact fidelity;
 * if you do, generate a mobile-sized variant too.
 */
function Poster(): ReactNode {
  return (
    <div className={styles.poster} aria-hidden="true">
      <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" role="presentation">
        <g className={styles.posterEdges}>
          <path d="M400 300 L250 180 M400 300 L560 200 M400 300 L330 430 M400 300 L520 420 M250 180 L180 110 M250 180 L165 235 M560 200 L640 140 M560 200 L655 255 M330 430 L245 500 M330 430 L370 520 M520 420 L600 480 M520 420 L470 520" />
        </g>
        <g className={styles.posterNodes}>
          <circle cx="400" cy="300" r="7" />
          <circle cx="250" cy="180" r="5" />
          <circle cx="560" cy="200" r="5" />
          <circle cx="330" cy="430" r="5" />
          <circle cx="520" cy="420" r="5" />
          <circle cx="180" cy="110" r="3" />
          <circle cx="165" cy="235" r="3" />
          <circle cx="640" cy="140" r="3" />
          <circle cx="655" cy="255" r="3" />
          <circle cx="245" cy="500" r="3" />
          <circle cx="370" cy="520" r="3" />
          <circle cx="600" cy="480" r="3" />
          <circle cx="470" cy="520" r="3" />
        </g>
      </svg>
    </div>
  );
}
