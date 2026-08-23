import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SceneEditor } from './SceneEditor.tsx';

/**
 * Mounts the scene editor into its own React root, appended to <body>.
 *
 * EDITOR ONLY.
 *
 * ── Why a separate root rather than a component in `App` ─────────────────────────────
 * Two reasons, and the second is the important one.
 *
 * `App.tsx` stays completely free of editor references — no import, no conditional
 * render, nothing to accidentally leave behind. The entire coupling between the app and
 * this tool is the four guarded lines in `main.tsx`.
 *
 * More practically: the app's root is HYDRATED (§10 — the content layer is pre-rendered
 * at build time). Injecting an extra subtree into a tree React is trying to match
 * against server-rendered markup is a hydration mismatch waiting to happen, and one that
 * would only ever reproduce in the built preview, never in `npm run dev`. A second root
 * sidesteps it entirely.
 *
 * Sharing state across the boundary is free: the scene store and the config store are
 * both module-level singletons. That is the same property §6 relies on to cross the
 * <Canvas> boundary, being reused here for the same reason.
 */

const CONTAINER_ID = 'scene-editor-root';

export function mountEditor(): void {
  if (document.getElementById(CONTAINER_ID)) return;

  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  // Marks the whole subtree as chrome so R3F's raycaster ignores it — the Canvas uses
  // `eventSource={document.body}`, so without this a slider drag would also be a drag
  // across the scene (see `scene/pointerGuard.ts`).
  container.dataset['ui'] = '';
  document.body.appendChild(container);

  createRoot(container).render(
    <StrictMode>
      <SceneEditor />
    </StrictMode>,
  );
}