import {
  AdditiveBlending,
  Color,
  MeshPhysicalMaterial,
  NormalBlending,
  type IUniform,
} from 'three';

import type { ScenePalette } from './palette.ts';

/**
 * The node material — frosted glass, faked.
 *
 * ── Why not real refraction ──────────────────────────────────────────────────────────
 * `MeshPhysicalMaterial.transmission` (and drei's MeshTransmissionMaterial) render the
 * scene to a backdrop target every frame and sample it. That is designed for a handful
 * of hero objects. Here there are ~2600 instances, and worse, a single backdrop sample
 * cannot refract the OTHER glass nodes behind it — with a cloud this dense the result is
 * muddy AND expensive, which is the worst of both.
 *
 * What actually sells "glass" at a glance is the Fresnel term: translucent face-on,
 * bright and saturated at grazing angles. That plus low base alpha and a faceted
 * geometry gets most of the read for the cost of a dot product. Real transmission is
 * reserved for the one node the visitor is interacting with (see SelectionRing).
 *
 * ── The sorting problem ──────────────────────────────────────────────────────────────
 * Transparency needs back-to-front sorting, and an InstancedMesh cannot sort its own
 * instances — they are one draw call. So on dark we use ADDITIVE blending, which is
 * order-independent by construction: overlapping nodes accumulate like caustics and
 * there is simply no wrong order. Additive is invisible on a pale ground, so light
 * theme uses normal blending with `depthWrite: false` and a higher base alpha, which
 * reads as etched acrylic on paper rather than glowing crystal.
 *
 * ── Interaction state ────────────────────────────────────────────────────────────────
 * `aState` is a per-instance vec2: (hover, selected), each 0→1 and animated on the CPU
 * in AstNodes. Keeping it an instanced attribute is what lets one node in a batch of
 * hundreds light up without breaking the single draw call.
 */

export interface NodeMaterialUniforms {
  /** Global dim applied to NON-active nodes while anything is active. 1 = no dimming. */
  uDim: IUniform<number>;
  uTime: IUniform<number>;
  uRimColor: IUniform<Color>;
  uRimStrength: IUniform<number>;
  uRimPower: IUniform<number>;
  uBaseAlpha: IUniform<number>;
}

export interface NodeMaterial {
  material: MeshPhysicalMaterial;
  uniforms: NodeMaterialUniforms;
}

export function createNodeMaterial(color: Color, palette: ScenePalette): NodeMaterial {
  const dark = palette.theme === 'dark';

  const uniforms: NodeMaterialUniforms = {
    uDim: { value: 0.1 },
    uTime: { value: 0 },
    // Rim tints toward white on dark so the facet edges read as light through glass;
    // on light it stays in the category ink so the object reads as drawn, not lit.
    uRimColor: { value: dark ? color.clone().lerp(new Color('#ffffff'), 0.9) : color.clone() },
    uRimStrength: { value: palette.rimStrength },
    uRimPower: { value: dark ? 2.4 : 3.1 },
    uBaseAlpha: { value: palette.glassAlpha },
  };

  const material = new MeshPhysicalMaterial({
    color,
    // Emissive stays low: on dark the rim + bloom does the glowing, and pushing emissive
    // too hard flattens the Fresnel gradient that makes it read as glass in the first place.
    emissive: color,
    emissiveIntensity: palette.emissiveIntensity * 0.4,
    roughness: dark ? 0.25 : 0.55,
    metalness: 0,
    // Frosted, not polished: a broad specular lobe instead of a mirror highlight.
    sheen: dark ? 0.6 : 0.2,
    sheenColor: color.clone().lerp(new Color('#ffffff'), 0.4),
    sheenRoughness: 0.7,
    transparent: true,
    opacity: 1,
    // Order-independent on dark; on light, disabling depth writes avoids the worst of
    // the unsortable-instance artefacts without turning the cloud into soup.
    blending: dark ? AdditiveBlending : NormalBlending,
    depthWrite: false,
    toneMapped: dark,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aState;
        varying vec2 vState;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vState = aState;
        // Expand along the normal rather than rewriting instanceMatrix — the LOD pass
        // already owns those matrices, and fighting it would make the two effects
        // stomp on each other every frame.
        transformed += normal * (vState.x * 0.16 + vState.y * 0.30);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDim;
        uniform float uTime;
        uniform vec3 uRimColor;
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform float uBaseAlpha;
        varying vec2 vState;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>

        // Fresnel: 0 facing the camera, 1 at grazing angles. The whole glass illusion.
        vec3 vnNormal = normalize( vNormal );
        vec3 vnView = normalize( vViewPosition );
        float fresnel = pow( 1.0 - saturate( dot( vnNormal, vnView ) ), uRimPower );

        float hover = vState.x;
        float selected = vState.y;
        // Deliberately NOT named "active": that is a RESERVED WORD in GLSL ES and
        // fails to compile with "Illegal use of reserved word". Same applies to
        // input, output, filter, sample, and partition.
        float activation = max( hover, selected );

        // Selected nodes breathe slowly. Hover does not — a pulse on something that
        // appears and vanishes with the pointer reads as a glitch rather than a state.
        float pulse = 1.0 + selected * 0.18 * sin( uTime * 2.4 );

        float rim = fresnel * uRimStrength * ( 1.0 + activation * 1.6 ) * pulse;
        gl_FragColor.rgb += uRimColor * rim;

        // Active nodes gain interior fill so they read as solid glass rather than an
        // empty shell — this is what visually separates them from the transparent cloud.
        gl_FragColor.rgb += uRimColor * activation * 0.35;

        float alpha = saturate( uBaseAlpha + fresnel * ( 1.0 - uBaseAlpha ) );
        alpha = saturate( alpha + activation * 0.45 );

        // Contrast is relative: rather than over-brightening one node (which fights the
        // bloom pass on dark and is impossible on light), everything NOT active fades.
        float dim = mix( uDim, 1.0, activation );

        gl_FragColor.rgb *= dim;
        gl_FragColor.a *= alpha * dim;`,
      );
  };

  // Changing onBeforeCompile after first compile requires a recompile; this material is
  // rebuilt on theme change instead, so the key just needs to differ per theme.
  material.customProgramCacheKey = () => `node-glass-${palette.theme}`;

  return { material, uniforms };
}