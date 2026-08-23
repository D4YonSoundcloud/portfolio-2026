/// <reference types="vite/client" />

/**
 * Compile-time switch for the scene editor (see `editor/`).
 *
 * Replaced with a literal `true` or `false` by Vite's `define` (vite.config.ts,
 * vitest.config.ts) — NOT read from `import.meta.env` at runtime. That distinction is
 * the whole point: a literal `false` lets Rollup drop the guarded branch and, with it,
 * the dynamic `import()` inside, so no editor chunk is ever emitted.
 *
 * `import.meta.env.VITE_*` would not be safe here. Vite only statically replaces those
 * keys when the variable is actually present in the environment at build time; when it
 * is unset the expression survives as a runtime property lookup, the branch stays live,
 * and the editor ships. Declaring our own constant removes that failure mode.
 */
declare const __SCENE_EDITOR__: boolean;