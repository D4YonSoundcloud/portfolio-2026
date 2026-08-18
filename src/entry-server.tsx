import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { App } from './App.tsx';

/**
 * §10 — SEO & static output.
 *
 * Used only by `scripts/prerender.ts` at build time to emit fully-formed HTML for the
 * content layer. The 3D scene hydrates client-side on top of it and renders nothing
 * here — `SceneCanvas` gates on a `requestAnimationFrame` that never fires in Node.
 */
export function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
