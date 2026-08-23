import { SCENE_DEFAULTS, readPath, type SceneOverrides } from '../scene/sceneConfig.ts';
import type { ResolvedTheme } from '../store/sceneStore.ts';
import type { TokenOverrides } from './editorStore.ts';

/**
 * Turns a tuning session back into source you can paste.
 *
 * EDITOR ONLY.
 *
 * ── Why export at all ────────────────────────────────────────────────────────────────
 * A tuning session that ends with the good values sitting in localStorage has not
 * actually accomplished anything — the deployed site still renders the old numbers, and
 * the new ones evaporate the first time the browser profile is cleared. The session has
 * to terminate in committed source, so the panel's last step is a block of text destined
 * for a specific file.
 *
 * Two outputs, because there are two sources of truth (see `scene/sceneConfig.ts`):
 * design tokens go back to `design/tokens.css`, render physics to `scene/sceneConfig.ts`.
 *
 * ── Only what changed ────────────────────────────────────────────────────────────────
 * Both emit ONLY fields that differ from the defaults. Dumping the whole config would
 * produce a diff touching every line, which hides the handful of decisions actually made
 * and makes the change unreviewable — including by the person who made it, three months
 * later.
 */

/**
 * Formats a number without float noise. 0.1 + 0.2 should read as `0.3` in committed
 * source, not `0.30000000000000004`.
 */
function fmt(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** True when nothing was changed, so the panel can say so rather than show an empty block. */
export function hasChanges(overrides: SceneOverrides, tokens: TokenOverrides): boolean {
  return (
    Object.keys(overrides.themed.dark).length > 0 ||
    Object.keys(overrides.themed.light).length > 0 ||
    Object.keys(overrides.shared).length > 0 ||
    Object.keys(tokens.dark).length > 0 ||
    Object.keys(tokens.light).length > 0
  );
}

/**
 * A CSS block for `design/tokens.css`, split by theme selector so it can be pasted
 * straight into the existing `[data-theme='...']` rules.
 */
export function exportTokensCss(tokens: TokenOverrides): string {
  const blocks: string[] = [];

  for (const theme of ['dark', 'light'] as const) {
    const entries = Object.entries(tokens[theme]);
    if (entries.length === 0) continue;

    const selector = theme === 'dark' ? ":root,\n[data-theme='dark']" : "[data-theme='light']";
    const lines = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cssVar, value]) => `  ${cssVar}: ${value};`);

    blocks.push(`${selector} {\n${lines.join('\n')}\n}`);
  }

  if (blocks.length === 0) return '/* No token changes. */';
  return `/* Paste into design/tokens.css, merging into the existing theme blocks. */\n\n${blocks.join('\n\n')}`;
}

/**
 * Assignment statements for `scene/sceneConfig.ts`.
 *
 * Deliberately emitted as dotted assignments rather than a reconstructed `SCENE_DEFAULTS`
 * literal. A regenerated literal would have to reproduce every comment in that file
 * verbatim or silently delete them, and those comments carry the reasoning behind the
 * numbers — which is the more valuable half. Assignments show exactly what moved and
 * leave you to update the one line each belongs on.
 */
export function exportConfigTs(overrides: SceneOverrides): string {
  const sections: string[] = [];

  for (const theme of ['dark', 'light'] as const) {
    const entries = Object.entries(overrides.themed[theme]).filter(
      ([, value]) => typeof value === 'number',
    ) as [string, number][];
    if (entries.length === 0) continue;

    const lines = entries.sort(([a], [b]) => a.localeCompare(b)).map(([path, value]) => {
      const before = readPath(SCENE_DEFAULTS.themed[theme], path);
      const was = before === undefined ? '' : `   // was ${fmt(before)}`;
      return `SCENE_DEFAULTS.themed.${theme}.${path} = ${fmt(value)};${was}`;
    });

    sections.push(`// themed.${theme}\n${lines.join('\n')}`);
  }

  const sharedEntries = Object.entries(overrides.shared).filter(
    ([, value]) => typeof value === 'number',
  ) as [string, number][];

  if (sharedEntries.length > 0) {
    const lines = sharedEntries.sort(([a], [b]) => a.localeCompare(b)).map(([path, value]) => {
      const before = readPath(SCENE_DEFAULTS.shared, path);
      const was = before === undefined ? '' : `   // was ${fmt(before)}`;
      return `SCENE_DEFAULTS.shared.${path} = ${fmt(value)};${was}`;
    });

    sections.push(`// shared\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return '// No config changes.';
  return `// Apply to SCENE_DEFAULTS in src/scene/sceneConfig.ts.\n\n${sections.join('\n\n')}`;
}

/** Both blocks, for the single "copy everything" affordance. */
export function exportAll(
  overrides: SceneOverrides,
  tokens: TokenOverrides,
  theme: ResolvedTheme,
): string {
  return [
    `/* Scene editor export — tuned on the ${theme} theme, ${new Date().toISOString().slice(0, 10)}. */`,
    '',
    exportTokensCss(tokens),
    '',
    exportConfigTs(overrides),
  ].join('\n');
}