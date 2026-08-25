import type { SharedPath, ThemedPath } from '../scene/sceneConfig.ts';

/**
 * Control metadata for every tunable — labels, ranges, step sizes, grouping.
 *
 * EDITOR ONLY. Nothing here is imported by the scene, so it costs nothing in production.
 *
 * ── Why this is a separate file from `sceneConfig.ts` ────────────────────────────────
 * The defaults are a production artifact; this is a description of how to EDIT them, and
 * it is roughly as large. Keeping them apart is what lets the whole editor tree-shake
 * away cleanly rather than dragging slider ranges into the shipped bundle.
 *
 * ── Why they cannot drift ────────────────────────────────────────────────────────────
 * `THEMED_FIELDS` and `SHARED_FIELDS` are typed as EXHAUSTIVE records keyed by the path
 * unions derived from the config interfaces. Add a field to `SceneConfig` and this file
 * stops compiling until the field is described. That is deliberate: a knob nobody can
 * find is barely better than a hardcoded constant.
 */

export interface FieldMeta {
  label: string;
  /** Panel section this control appears under. */
  group: string;
  min: number;
  max: number;
  step: number;
  /** One line explaining what moving this actually does. Shown as a tooltip. */
  hint: string;
}

/**
 * Ranges are chosen to be *useful*, not merely valid: roughly the span within which the
 * value produces a sane image, so dragging the full width of a slider explores the real
 * design space instead of spending most of its travel in unusable territory.
 */
export const THEMED_FIELDS: Record<ThemedPath, FieldMeta> = {
  'lights.ambientIntensity': {
    label: 'Ambient',
    group: 'Lights',
    min: 0,
    max: 3,
    step: 0.01,
    hint: 'Flat fill across every node. Carries the light theme, where nothing glows.',
  },
  'lights.keyIntensity': {
    label: 'Key',
    group: 'Lights',
    min: 0,
    max: 4,
    step: 0.01,
    hint: 'The single point light. Its position is shared across both themes.',
  },

  'material.dispersion': {
    label: 'Dispersion',
    group: 'Material',
    min: 0,
    max: 0.15,
    step: 0.001,
    hint: 'Per-channel IOR offset — this is the colour fringing at the facet edges.',
  },
  'material.rimPower': {
    label: 'Rim falloff',
    group: 'Material',
    min: 0.5,
    max: 8,
    step: 0.05,
    hint: 'Fresnel exponent. Higher confines the rim to grazing angles.',
  },
  'material.roughness': {
    label: 'Roughness',
    group: 'Material',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Broadens the specular lobe. Frosted glass rather than a mirror.',
  },
  'material.envMapIntensity': {
    label: 'Env intensity',
    group: 'Material',
    min: 0,
    max: 3,
    step: 0.01,
    hint: "Three's own IBL from the baked map. Stacks with the manual refraction — keep low.",
  },
  'material.sheen': {
    label: 'Sheen',
    group: 'Material',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Soft retroreflective bloom over the base colour.',
  },

  'bloom.intensity': {
    label: 'Intensity',
    group: 'Bloom (dark)',
    min: 0,
    max: 2,
    step: 0.01,
    hint: 'Dark theme only — the light theme swaps the whole pass for a vignette.',
  },
  'bloom.threshold': {
    label: 'Threshold',
    group: 'Bloom (dark)',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Luminance a pixel must exceed to bloom. Too low and the cloud becomes haze.',
  },
  'bloom.smoothing': {
    label: 'Smoothing',
    group: 'Bloom (dark)',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Softens the threshold cutoff so bloom fades in rather than switching on.',
  },

  'vignette.offset': {
    label: 'Offset',
    group: 'Vignette (light)',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Light theme only. How far from centre the darkening begins.',
  },
  'vignette.darkness': {
    label: 'Darkness',
    group: 'Vignette (light)',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How far the corners recede. Replaces bloom, which reads as a bug on paper.',
  },

  'selection.ringOpacity': {
    label: 'Ring opacity',
    group: 'Selection',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'The billboarded reticle around the selected node.',
  },
  'selection.shellOpacity': {
    label: 'Shell opacity',
    group: 'Selection',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'The slow-spinning wireframe cage that gives the node volume.',
  },
};

export const SHARED_FIELDS: Record<SharedPath, FieldMeta> = {
  'lights.keyX': {
    label: 'Key X',
    group: 'Lights',
    min: -120,
    max: 120,
    step: 1,
    hint: 'Position of the point light. Shared — both themes light from one direction.',
  },
  'lights.keyY': { label: 'Key Y', group: 'Lights', min: -120, max: 120, step: 1, hint: 'Height of the point light.' },
  'lights.keyZ': { label: 'Key Z', group: 'Lights', min: -120, max: 120, step: 1, hint: 'Depth of the point light.' },

  'fog.near': {
    label: 'Fog near',
    group: 'Fog',
    min: 0,
    max: 200,
    step: 1,
    hint: 'Distance at which fog starts. Below this, nodes are unfogged.',
  },
  'fog.far': {
    label: 'Fog far',
    group: 'Fog',
    min: 20,
    max: 600,
    step: 1,
    hint: 'Distance at which fog is total. Controls how deep the cloud reads.',
  },

  'camera.viewDistance': {
    label: 'View distance',
    group: 'Camera',
    min: 10,
    max: 160,
    step: 0.5,
    hint: 'How far back the camera sits from a cluster centroid.',
  },
  'camera.driftRadius': {
    label: 'Drift radius',
    group: 'Camera',
    min: 0,
    max: 20,
    step: 0.1,
    hint: 'Amplitude of the idle Lissajous drift, in world units. 0 disables it.',
  },
  'camera.driftSpeed': {
    label: 'Drift speed',
    group: 'Camera',
    min: 0,
    max: 0.5,
    step: 0.001,
    hint: 'Rate of the idle drift. Slow enough to read as breathing, not motion.',
  },
  'camera.parallax': {
    label: 'Parallax',
    group: 'Camera',
    min: 0,
    max: 20,
    step: 0.1,
    hint: 'Pointer-tracked offset at the screen edge. Desktop only.',
  },
  'camera.parallaxDamping': {
    label: 'Parallax damping',
    group: 'Camera',
    min: 0.005,
    max: 0.4,
    step: 0.005,
    hint: 'Time constant. Lower is snappier; too low and a fast mouse whips the camera.',
  },
  'camera.inspectDistance': {
    label: 'Inspect distance',
    group: 'Camera',
    min: 3,
    max: 60,
    step: 0.5,
    hint: 'How close the camera pulls in when a node opens in the inspector.',
  },
  'camera.inspectAttack': {
    label: 'Inspect attack',
    group: 'Camera',
    min: 0.05,
    max: 2,
    step: 0.01,
    hint: 'Seconds for the inspect framing to engage or release.',
  },

  'material.ior': {
    label: 'IOR',
    group: 'Material',
    min: 0.1,
    max: 1.5,
    step: 0.005,
    hint: 'Eta passed to refract(). Below 1 bends outward; near 1 barely bends at all.',
  },
  'material.envRefractBlur': {
    label: 'Refract blur',
    group: 'Material',
    min: 0,
    max: 1,
    step: 0.005,
    hint: 'PMREM mip for the dispersion samples. Keep low or the fringing has no edges.',
  },
  'material.envReflectBlur': {
    label: 'Reflect blur',
    group: 'Material',
    min: 0,
    max: 1,
    step: 0.005,
    hint: 'PMREM mip for the reflection sample. Higher reads as frosted rather than mirrored.',
  },
  'material.emissiveScale': {
    label: 'Emissive scale',
    group: 'Material',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Multiplier on the token emissive. High values flatten the Fresnel gradient.',
  },
  'material.hoverSwell': {
    label: 'Hover swell',
    group: 'Material',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How far a hovered instance expands along its normals.',
  },
  'material.selectSwell': {
    label: 'Select swell',
    group: 'Material',
    min: 0,
    max: 1.5,
    step: 0.01,
    hint: 'Same, for the selected node. Larger than hover so the states read apart.',
  },

  'envPattern.bakeResolution': {
    label: 'Bake res',
    group: 'Environment',
    min: 128,
    max: 1024,
    step: 128,
    hint: 'Equirect width. Reallocates the target — 512 is plenty for rough, faceted nodes.',
  },
  'envPattern.rotation': {
    label: 'Rotation',
    group: 'Environment',
    min: -180,
    max: 180,
    step: 1,
    hint: 'Spins the environment about Y. Baked in, so it is free at render time.',
  },
  'envPattern.horizonHeight': {
    label: 'Horizon',
    group: 'Environment',
    min: -1,
    max: 1,
    step: 0.01,
    hint: 'Height of the ground/sky division.',
  },
  'envPattern.horizonSharpness': {
    label: 'Horizon edge',
    group: 'Environment',
    min: 0,
    max: 1,
    step: 0.01,
    hint: '0 is a smooth ramp and refracts invisibly. Push it up until the edge reads.',
  },
  'envPattern.panelSteps': {
    label: 'Panel steps',
    group: 'Environment',
    min: 0,
    max: 12,
    step: 1,
    hint: 'Posterise into N levels. 0 is off. Each step boundary is another hard edge.',
  },
  'envPattern.bandCount': {
    label: 'Bands',
    group: 'Environment',
    min: 0,
    max: 24,
    step: 1,
    hint: 'Latitude lines, evenly spaced in angle. 0 disables them.',
  },
  'envPattern.bandWidth': {
    label: 'Band width',
    group: 'Environment',
    min: 0.001,
    max: 0.2,
    step: 0.001,
    hint: 'Keep thin. Width is what turns lines into bloom haze across 2600 nodes.',
  },
  'envPattern.bandGain': {
    label: 'Band gain',
    group: 'Environment',
    min: 0,
    max: 6,
    step: 0.05,
    hint: 'Brightness of the latitude lines.',
  },
  'envPattern.meridianCount': {
    label: 'Meridians',
    group: 'Environment',
    min: 0,
    max: 24,
    step: 1,
    hint: 'Longitude lines. They converge at the poles by construction.',
  },
  'envPattern.meridianWidth': {
    label: 'Meridian width',
    group: 'Environment',
    min: 0.001,
    max: 0.2,
    step: 0.001,
    hint: 'As with bands: thin rather than bright.',
  },
  'envPattern.meridianGain': {
    label: 'Meridian gain',
    group: 'Environment',
    min: 0,
    max: 6,
    step: 0.05,
    hint: 'Brightness of the longitude lines.',
  },
  'envPattern.meridianPolarFade': {
    label: 'Meridian fade',
    group: 'Environment',
    min: 0,
    max: 8,
    step: 0.05,
    hint: 'Fades meridians near the poles. 0 lets them converge into a crosshair.',
  },
  'envPattern.keyElevation': {
    label: 'Key elevation',
    group: 'Environment',
    min: -90,
    max: 90,
    step: 1,
    hint: 'Height of the key lobe, in degrees above the horizon.',
  },
  'envPattern.keyAzimuth': {
    label: 'Key azimuth',
    group: 'Environment',
    min: -180,
    max: 180,
    step: 1,
    hint: 'Bearing of the key lobe. Watch the mirror probe while you drag this.',
  },
  'envPattern.keyPower': {
    label: 'Key tightness',
    group: 'Environment',
    min: 1,
    max: 64,
    step: 0.5,
    hint: 'Higher is a smaller, harder highlight.',
  },
  'envPattern.keyGain': {
    label: 'Key gain',
    group: 'Environment',
    min: 0,
    max: 4,
    step: 0.01,
    hint: 'Brightness of the key lobe.',
  },

  'material.envJitter': {
    label: 'Env jitter',
    group: 'Material',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Per-node rotation of the environment. 0 makes every node reflect the same decal.',
  },
  'material.envFilterGain': {
    label: 'Env filtering',
    group: 'Material',
    min: 0,
    max: 12,
    step: 0.1,
    hint: 'Derivative mip bias. Raise if thin lines skip across facets on small nodes.',
  },

  'lod.near': {
    label: 'LOD near',
    group: 'Detail',
    min: 0,
    max: 200,
    step: 1,
    hint: 'Inside this distance, deep nodes are at full scale.',
  },
  'lod.far': {
    label: 'LOD far',
    group: 'Detail',
    min: 10,
    max: 400,
    step: 1,
    hint: 'Beyond this, deep nodes have shrunk to nothing. Must exceed LOD near.',
  },
  'lod.shallowDepth': {
    label: 'Always-on depth',
    group: 'Detail',
    min: 0,
    max: 6,
    step: 1,
    hint: 'Nodes at or below this tree depth ignore LOD entirely.',
  },
  'lod.intervalMs': {
    label: 'LOD interval',
    group: 'Detail',
    min: 16,
    max: 1000,
    step: 8,
    hint: 'Milliseconds between distance passes. Every frame is wasteful.',
  },

  'interaction.hoverAttack': {
    label: 'Hover attack',
    group: 'Interaction',
    min: 0.01,
    max: 1,
    step: 0.01,
    hint: 'Seconds for a hover highlight to reach full strength. Snapping looks broken.',
  },
  'interaction.selectAttack': {
    label: 'Select attack',
    group: 'Interaction',
    min: 0.01,
    max: 1.5,
    step: 0.01,
    hint: 'Same, for selection. Slower than hover — it is a heavier state change.',
  },
  'interaction.dimAttack': {
    label: 'Dim attack',
    group: 'Interaction',
    min: 0.01,
    max: 1.5,
    step: 0.01,
    hint: 'Seconds for the surrounding field to fade once anything becomes active.',
  },

  'selection.ringInner': {
    label: 'Ring inner',
    group: 'Selection',
    min: 0.1,
    max: 6,
    step: 0.01,
    hint: 'Inner radius of the reticle. Must stay below the outer radius.',
  },
  'selection.ringOuter': {
    label: 'Ring outer',
    group: 'Selection',
    min: 0.1,
    max: 6,
    step: 0.01,
    hint: 'Outer radius. The gap between the two is the ring thickness.',
  },
  'selection.shellRadius': {
    label: 'Shell radius',
    group: 'Selection',
    min: 0.1,
    max: 6,
    step: 0.01,
    hint: 'Size of the wireframe cage relative to the node it surrounds.',
  },
  'selection.spinX': {
    label: 'Shell spin X',
    group: 'Selection',
    min: -2,
    max: 2,
    step: 0.01,
    hint: 'Cage rotation rate. Suppressed entirely under reduced motion.',
  },
  'selection.spinY': {
    label: 'Shell spin Y',
    group: 'Selection',
    min: -2,
    max: 2,
    step: 0.01,
    hint: 'Second axis, deliberately a different rate so the motion never looks rigid.',
  },
  'selection.growAttack': {
    label: 'Grow attack',
    group: 'Selection',
    min: 0.01,
    max: 1.5,
    step: 0.01,
    hint: 'Seconds for a newly selected overlay to scale in from nothing.',
  },
};

/**
 * Design tokens the panel can edit live, by writing the custom property onto <html>.
 *
 * These are NOT part of `SceneConfig` — they belong to `design/tokens.css`, and their
 * export path is a CSS block rather than a TypeScript one (see `exportOverrides.ts`).
 * `palette.ts` reads them back through `getComputedStyle` on the next revision bump.
 */
export interface TokenField {
  /** The custom property name, including the leading double dash. */
  cssVar: string;
  label: string;
  group: string;
  kind: 'color' | 'number';
  min?: number;
  max?: number;
  step?: number;
  hint: string;
}

export const TOKEN_FIELDS: readonly TokenField[] = [
  {
    cssVar: '--cat-declaration',
    label: 'Declaration',
    group: 'Category colours',
    kind: 'color',
    hint: 'Functions, classes, variables (§4.2).',
  },
  {
    cssVar: '--cat-controlflow',
    label: 'ControlFlow',
    group: 'Category colours',
    kind: 'color',
    hint: 'if / for / while / switch / try.',
  },
  { cssVar: '--cat-jsx', label: 'JSX', group: 'Category colours', kind: 'color', hint: 'Elements, fragments, attributes.' },
  { cssVar: '--cat-import', label: 'Import', group: 'Category colours', kind: 'color', hint: 'Imports and exports. Also the dark-theme edge colour.' },
  { cssVar: '--cat-expression', label: 'Expression', group: 'Category colours', kind: 'color', hint: 'Calls, binaries, members. Also the light-theme edge colour.' },
  { cssVar: '--cat-literal', label: 'Literal', group: 'Category colours', kind: 'color', hint: 'Strings, numbers, template literals.' },

  {
    cssVar: '--scene-bg-fog',
    label: 'Fog colour',
    group: 'Scene tokens',
    kind: 'color',
    hint: 'Should normally track --bg, or the cloud fades into the wrong ground.',
  },
  {
    cssVar: '--scene-env-low',
    label: 'Env low',
    group: 'Scene tokens',
    kind: 'color',
    hint: 'Bottom of the procedural environment gradient the glass refracts.',
  },
  {
    cssVar: '--scene-env-high',
    label: 'Env high',
    group: 'Scene tokens',
    kind: 'color',
    hint: 'Top of that gradient. The spread between the two is what makes facets read.',
  },
  {
    cssVar: '--scene-emissive',
    label: 'Emissive',
    group: 'Scene tokens',
    kind: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    hint: 'Base emissive before the shared emissive-scale multiplier.',
  },
  {
    cssVar: '--scene-edge-opacity',
    label: 'Edge opacity',
    group: 'Scene tokens',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Edges are the primary element on light, where nodes shrink back.',
  },
  {
    cssVar: '--scene-node-scale',
    label: 'Node scale',
    group: 'Scene tokens',
    kind: 'number',
    min: 0.1,
    max: 3,
    step: 0.01,
    hint: 'Global instance scale, before per-instance LOD.',
  },
  {
    cssVar: '--scene-refraction',
    label: 'Refraction',
    group: 'Scene tokens',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How strongly the faked refraction replaces the lit base colour.',
  },
  {
    cssVar: '--scene-rim-strength',
    label: 'Rim strength',
    group: 'Scene tokens',
    kind: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    hint: 'Fresnel rim intensity. Pairs with the themed rim-falloff exponent.',
  },
  {
    cssVar: '--scene-dim',
    label: 'Dim',
    group: 'Scene tokens',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How far non-active nodes fade while something is hovered or selected.',
  },
];