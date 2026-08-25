import { Color } from 'three';
import { NODE_CATEGORIES, type NodeCategory } from '../ast-pipeline/schema.ts';
import type { ResolvedTheme } from '../store/sceneStore.ts';

/**
 * §7.2 — "One source of truth: a single `theme` value feeds both the CSS custom-property
 * block in design/tokens.css for the DOM layer and the color/emissive/postprocessing
 * inputs for the R3F materials — never two separately-maintained palettes that can drift
 * out of sync with each other."
 *
 * This module is that bridge. It reads the computed custom properties off <html> rather
 * than declaring hex values in TypeScript, so `tokens.css` stays the only place a colour
 * is ever written down.
 */

const CATEGORY_VARS: Record<NodeCategory, string> = {
  Declaration: '--cat-declaration',
  ControlFlow: '--cat-controlflow',
  JSX: '--cat-jsx',
  Import: '--cat-import',
  Expression: '--cat-expression',
  Literal: '--cat-literal',
};

export interface ScenePalette {
  theme: ResolvedTheme;
  categories: Record<NodeCategory, Color>;
  /** 0 on light theme — linework has no glow (§7.2). */
  emissiveIntensity: number;
  edgeOpacity: number;
  nodeScale: number;
  /** How strongly the faked refraction replaces the lit base colour. */
  refraction: number;
  /** Low and high ends of the procedural environment the refraction samples. */
  envLow: Color;
  envHigh: Color;
  /** Fresnel rim intensity. */
  rimStrength: number;
  /** Multiplier applied to non-active nodes while something is hovered or selected. */
  dim: number;
  fog: Color;
  /** Light theme renders linework and skips bloom entirely (§4.4, §7.2). */
  useBloom: boolean;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function readNumber(styles: CSSStyleDeclaration, name: string, fallback: number): number {
  const parsed = Number.parseFloat(readVar(styles, name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Called on theme change, not per frame — `getComputedStyle` forces a style recalc and
 * has no business inside `useFrame`.
 */
export function readPalette(theme: ResolvedTheme): ScenePalette {
  // SSR / prerender (§10) has no computed style to read; the scene isn't rendered there
  // anyway, so a structurally valid palette is all that's needed.
  if (typeof window === 'undefined') return fallbackPalette(theme);

  const styles = window.getComputedStyle(document.documentElement);

  const categories = Object.fromEntries(
    NODE_CATEGORIES.map((category) => [
      category,
      new Color(readVar(styles, CATEGORY_VARS[category], '#888888')),
    ]),
  ) as Record<NodeCategory, Color>;

  return {
    theme,
    categories,
    emissiveIntensity: readNumber(styles, '--scene-emissive', theme === 'dark' ? 0.85 : 0),
    edgeOpacity: readNumber(styles, '--scene-edge-opacity', 0.18),
    nodeScale: readNumber(styles, '--scene-node-scale', 1),
    refraction: readNumber(styles, '--scene-refraction', theme === 'dark' ? 0.72 : 0.5),
    envLow: new Color(readVar(styles, '--scene-env-low', theme === 'dark' ? '#0d1117' : '#c9c6bd')),
    envHigh: new Color(readVar(styles, '--scene-env-high', theme === 'dark' ? '#5a6478' : '#ffffff')),
    rimStrength: readNumber(styles, '--scene-rim-strength', theme === 'dark' ? 0.85 : 0.4),
    dim: readNumber(styles, '--scene-dim', theme === 'dark' ? 0.42 : 0.3),
    fog: new Color(readVar(styles, '--scene-bg-fog', theme === 'dark' ? '#0b0d10' : '#e8e6df')),
    useBloom: theme === 'dark',
  };
}

function fallbackPalette(theme: ResolvedTheme): ScenePalette {
  const categories = Object.fromEntries(
    NODE_CATEGORIES.map((category) => [category, new Color('#888888')]),
  ) as Record<NodeCategory, Color>;

  return {
    theme,
    categories,
    emissiveIntensity: theme === 'dark' ? 0.85 : 0,
    edgeOpacity: theme === 'dark' ? 0.3 : 0.32,
    nodeScale: theme === 'dark' ? 0.61 : 0.61,
    refraction: theme === 'dark' ? 1.0 : 0.5,
    envLow: new Color(theme === 'dark' ? '#2c353a' : '#413b2f'),
    envHigh: new Color(theme === 'dark' ? '#959ea3' : '#ffffff'),
    rimStrength: theme === 'dark' ? 3.0 : 0.4,
    dim: theme === 'dark' ? 0.7 : 0.3,
    fog: new Color(theme === 'dark' ? '#0b0d10' : '#e8e6df'),
    useBloom: theme === 'dark',
  };
}