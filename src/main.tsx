import { StrictMode } from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';

import { App } from './App.tsx';

/**
 * §10 — the content layer is pre-rendered at build time, so the normal path is
 * hydration. `createRoot` is the fallback for `npm run dev`, where no prerender step has
 * run and #root is empty.
 */
const container = document.getElementById('root');

if (!container) {
  throw new Error('#root not found');
}

if (container.hasChildNodes()) {
  hydrateRoot(container, <StrictMode><App /></StrictMode>);
} else {
  createRoot(container).render(<StrictMode><App /></StrictMode>);
}

/**
 * The dev scene editor (see `editor/`) — the ONLY reference to it anywhere in the app.
 *
 * `__SCENE_EDITOR__` is a compile-time constant substituted by Vite's `define`, not a
 * runtime lookup. In a production build it becomes a literal `false`, so Rollup drops
 * this whole block along with the dynamic `import()` inside it, and no editor chunk is
 * ever emitted. `scripts/check-no-editor.ts` verifies that after each build rather than
 * trusting it.
 *
 * The `import()` must stay INSIDE the branch. Hoisting it — to a top-level import, or to
 * a `React.lazy` call in `App` — makes it a static dependency of the entry chunk, and
 * the editor ships no matter what the flag says.
 */
if (__SCENE_EDITOR__) {
  void import('./editor/mountEditor.tsx').then(({ mountEditor }) => mountEditor());
}