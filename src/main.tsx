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
