import { Color, MeshPhysicalMaterial, NormalBlending, type IUniform } from 'three';

import type { ScenePalette } from './palette.ts';
import type { SharedValues, ThemedValues } from './sceneConfig.ts';

/**
 * The node material — opaque, with faked refraction.
 *
 * ── Why opaque ───────────────────────────────────────────────────────────────────────
 * The previous version was translucent with additive blending. That was the wrong call:
 * with ~2600 overlapping nodes the accumulated alpha washed the scene out, and because
 * an InstancedMesh cannot sort its own instances, transparency also meant giving up
 * `depthWrite` — so nothing ever occluded anything and the cloud had no readable depth.
 *
 * Going opaque fixes both at once. Depth writes come back, near nodes properly hide far
 * ones, and the sorting problem disappears because there is nothing to sort.
 *
 * ── Faking refraction without transparency ───────────────────────────────────────────
 * Real refraction needs the scene behind the object, which means a backdrop render pass
 * per frame — hopeless across thousands of instances. But refraction reads to the eye as
 * three specific cues, none of which actually require seeing through anything:
 *
 *   1. the image bending at the surface   → sample a procedural environment along
 *                                            `refract()` rather than a real backdrop
 *   2. colour fringing at the edges       → refract R/G/B at slightly different IORs
 *   3. bright grazing edges               → Fresnel, which is what sold the old version
 *
 * The "environment" is a procedural gradient plus a key-light lobe, evaluated in world
 * space so the highlights swim across the facets as the camera drifts. No texture, no
 * extra pass, no asset to load — just arithmetic on a direction vector.
 *
 * ── Interaction state ────────────────────────────────────────────────────────────────
 * `aState` is a per-instance vec2 (hover, selected), each 0→1, animated in AstNodes.
 * Keeping it an instanced attribute is what lets one node in a batch of hundreds light
 * up without breaking the single draw call.
 *
 * ── Everything tunable is live ───────────────────────────────────────────────────────
 * Every value the editor exposes here is either a uniform or a plain material property,
 * so `syncNodeMaterial` can push a change without recompiling the shader. That is not an
 * accident of the list — values which WOULD force a recompile (`blending`, `transparent`,
 * `toneMapped`, and the `onBeforeCompile` source itself) are deliberately left out of the
 * config. They are structural decisions about how the material works rather than knobs,
 * and exposing them would put a several-hundred-millisecond shader rebuild behind a
 * slider drag.
 *
 * Three values that were previously hardcoded in GLSL — the two interaction swells and
 * the environment key gain — are now uniforms for exactly this reason: they are look
 * decisions, and a uniform costs nothing.
 */

export interface NodeMaterialUniforms {
  /** Global dim applied to NON-active nodes while anything is active. 1 = no dimming. */
  uDim: IUniform<number>;
  uTime: IUniform<number>;
  uRimColor: IUniform<Color>;
  uRimStrength: IUniform<number>;
  uRimPower: IUniform<number>;
  /** How strongly the refracted environment replaces the lit base colour. */
  uRefraction: IUniform<number>;
  /** Index of refraction, as the eta passed to `refract()`. */
  uIor: IUniform<number>;
  /** Per-channel IOR offset — this is the colour fringing. */
  uDispersion: IUniform<number>;
  uEnvLow: IUniform<Color>;
  uEnvHigh: IUniform<Color>;
  uKeyColor: IUniform<Color>;
  /** Brightness of the key lobe in the procedural environment. */
  uEnvKeyGain: IUniform<number>;
  /** How far a hovered / selected instance expands along its normals. */
  uHoverSwell: IUniform<number>;
  uSelectSwell: IUniform<number>;
}

export interface NodeMaterial {
  material: MeshPhysicalMaterial;
  uniforms: NodeMaterialUniforms;
}

export function createNodeMaterial(
  color: Color,
  palette: ScenePalette,
  themed: ThemedValues,
  shared: SharedValues,
): NodeMaterial {
  const dark = palette.theme === 'dark';

  const uniforms: NodeMaterialUniforms = {
    uDim: { value: 1 },
    uTime: { value: 0 },
    uRimColor: { value: dark ? color.clone().lerp(new Color('#ffffff'), 0.55) : color.clone() },
    uRimStrength: { value: palette.rimStrength },
    uRimPower: { value: themed.material.rimPower },
    uRefraction: { value: palette.refraction },
    uIor: { value: shared.material.ior },
    uDispersion: { value: themed.material.dispersion },
    uEnvLow: { value: palette.envLow.clone() },
    uEnvHigh: { value: palette.envHigh.clone() },
    uKeyColor: { value: dark ? color.clone().lerp(new Color('#ffffff'), 0.7) : color.clone() },
    uEnvKeyGain: { value: shared.material.envKeyGain },
    uHoverSwell: { value: shared.material.hoverSwell },
    uSelectSwell: { value: shared.material.selectSwell },
  };

  const material = new MeshPhysicalMaterial({
    color,
    emissive: color,
    // Emissive stays low: the refraction and rim carry the look now, and a strong
    // emissive flattens the Fresnel gradient that makes the facets read.
    emissiveIntensity: palette.emissiveIntensity * shared.material.emissiveScale,
    roughness: themed.material.roughness,
    metalness: 0,
    // Frosted rather than polished: a broad specular lobe, not a mirror highlight.
    sheen: themed.material.sheen,
    sheenColor: color.clone().lerp(new Color('#ffffff'), 0.4),
    sheenRoughness: 0.75,

    // Fully opaque. Depth writes restored, so the cloud finally occludes itself.
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    blending: NormalBlending,
    toneMapped: dark,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aState;
        varying vec2 vState;
        uniform float uHoverSwell;
        uniform float uSelectSwell;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vState = aState;
        // Expand along the normal rather than rewriting instanceMatrix — the LOD pass
        // already owns those matrices, and fighting it would make the two effects
        // stomp on each other every frame.
        transformed += normal * ( vState.x * uHoverSwell + vState.y * uSelectSwell );`,
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
        uniform float uRefraction;
        uniform float uIor;
        uniform float uDispersion;
        uniform vec3 uEnvLow;
        uniform vec3 uEnvHigh;
        uniform vec3 uKeyColor;
        uniform float uEnvKeyGain;
        varying vec2 vState;

        // Procedural stand-in for an environment map. A vertical gradient plus a soft
        // key lobe: enough structure that a refracted direction returns something that
        // varies, which is all the eye needs to read the surface as bending light.
        vec3 sampleEnv( vec3 dir ) {
          float h = dir.y * 0.5 + 0.5;
          vec3 base = mix( uEnvLow, uEnvHigh, smoothstep( 0.0, 1.0, h ) );
          vec3 keyDir = normalize( vec3( 0.5, 0.8, 0.35 ) );
          float key = pow( max( dot( dir, keyDir ), 0.0 ), 8.0 );
          return base + uKeyColor * key * uEnvKeyGain;
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>

        vec3 vnNormal = normalize( vNormal );
        vec3 vnView = normalize( vViewPosition );

        // Fresnel: 0 facing the camera, 1 at grazing angles.
        float fresnel = pow( 1.0 - saturate( dot( vnNormal, vnView ) ), uRimPower );

        // View space -> world space. The view rotation is orthonormal, so its transpose
        // is its inverse — far cheaper than inverting a mat4, and it means the
        // environment stays fixed in the world while the camera drifts through it.
        mat3 viewToWorld = transpose( mat3( viewMatrix ) );

        vec3 incident = -vnView;
        // Per-channel IOR is the whole trick behind the colour fringing at the edges.
        vec3 refrR = viewToWorld * refract( incident, vnNormal, uIor - uDispersion );
        vec3 refrG = viewToWorld * refract( incident, vnNormal, uIor );
        vec3 refrB = viewToWorld * refract( incident, vnNormal, uIor + uDispersion );
        vec3 refracted = vec3(
          sampleEnv( refrR ).r,
          sampleEnv( refrG ).g,
          sampleEnv( refrB ).b
        );

        vec3 reflected = sampleEnv( viewToWorld * reflect( incident, vnNormal ) );

        // Face-on reads as looking THROUGH the node; grazing reads as reflecting off it.
        vec3 glass = mix( refracted, reflected, fresnel );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, gl_FragColor.rgb * 0.35 + glass, uRefraction );

        float hover = vState.x;
        float selected = vState.y;
        // Deliberately NOT named "active": that is a RESERVED WORD in GLSL ES and
        // fails to compile with "Illegal use of reserved word". Same applies to
        // input, output, filter, sample, and partition -- avoid all of them here.
        float activation = max( hover, selected );

        // Selected nodes breathe slowly. Hover does not — a pulse on something that
        // appears and vanishes with the pointer reads as a glitch rather than a state.
        float pulse = 1.0 + selected * 0.18 * sin( uTime * 2.4 );

        float rim = fresnel * uRimStrength * ( 1.0 + activation * 1.6 ) * pulse;
        gl_FragColor.rgb += uRimColor * rim;

        // Active nodes gain interior fill, so they read as lit from within rather than
        // merely outlined — this is what separates them from the surrounding cloud.
        gl_FragColor.rgb += uRimColor * activation * 0.35;

        // Contrast is relative: rather than over-brightening one node (which fights the
        // bloom pass on dark and is impossible on light), everything else fades.
        gl_FragColor.rgb *= mix( uDim, 1.0, activation );`,
      );
  };

  material.customProgramCacheKey = () => `node-glass-${palette.theme}`;

  return { material, uniforms };
}

/**
 * Pushes config changes onto an already-built material, without recompiling.
 *
 * Called from an effect in `AstNodes` whenever the config revision changes. In
 * production the config never changes, so this runs exactly once per material and is
 * a no-op restatement of what `createNodeMaterial` already set.
 *
 * `uDim` and `uTime` are pointedly NOT touched here: they are animated in the frame
 * loop, and overwriting them from an effect would visibly reset the dim ramp every time
 * a slider moved.
 */
export function syncNodeMaterial(
  { material, uniforms }: NodeMaterial,
  palette: ScenePalette,
  themed: ThemedValues,
  shared: SharedValues,
): void {
  material.roughness = themed.material.roughness;
  material.sheen = themed.material.sheen;
  material.emissiveIntensity = palette.emissiveIntensity * shared.material.emissiveScale;

  uniforms.uRimPower.value = themed.material.rimPower;
  uniforms.uDispersion.value = themed.material.dispersion;
  uniforms.uIor.value = shared.material.ior;
  uniforms.uEnvKeyGain.value = shared.material.envKeyGain;
  uniforms.uHoverSwell.value = shared.material.hoverSwell;
  uniforms.uSelectSwell.value = shared.material.selectSwell;
}