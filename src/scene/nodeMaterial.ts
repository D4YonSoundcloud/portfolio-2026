import { Color, MeshPhysicalMaterial, NormalBlending, type IUniform, type Texture } from 'three';

import { ENV_PATTERN_FUNCTION, ENV_PATTERN_UNIFORMS } from './envPattern.ts';
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
  /** Ends of the theme gradient, used only by the pre-bake fallback path. */
  uEnvLow: IUniform<Color>;
  uEnvHigh: IUniform<Color>;
  /** Roughness the dispersion samples use. Low keeps the fringing sharp enough to read. */
  uRefractBlur: IUniform<number>;
  /** Roughness the reflection sample uses. */
  uReflectBlur: IUniform<number>;
  /** How far each node's environment sample is rotated by its own seed. */
  uEnvJitter: IUniform<number>;
  /** Scales the derivative-based mip bias that stops thin lines aliasing across facets. */
  uEnvFilterGain: IUniform<number>;
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
  envMap: Texture | null,
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
    uRefractBlur: { value: shared.material.envRefractBlur },
    uReflectBlur: { value: shared.material.envReflectBlur },
    uEnvJitter: { value: shared.material.envJitter },
    uEnvFilterGain: { value: shared.material.envFilterGain },
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
    envMap,
    envMapIntensity: themed.material.envMapIntensity,

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
        attribute float aSeed;
        varying vec2 vState;
        varying vec4 vJitter;
        uniform float uHoverSwell;
        uniform float uSelectSwell;
        uniform float uEnvJitter;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vState = aState;

        // Per-node environment rotation, precomputed here as sin/cos pairs.
        //
        // Every node samples the SAME environment, so without this they all reflect the
        // same features in the same places and the field reads as a decal repeated a few
        // thousand times. A fixed per-node rotation breaks that up while preserving the
        // thing that makes an env map worth having: highlights still swim across facets
        // as the camera drifts, because the rotation is constant and the view is not.
        //
        // Done in the vertex stage so the fragment stage costs one varying instead of
        // four transcendentals per pixel.
        float envYaw = aSeed * 6.2831853 * uEnvJitter;
        float envPitch = ( fract( aSeed * 7.31 ) - 0.5 ) * 3.1415927 * uEnvJitter;
        vJitter = vec4( cos( envYaw ), sin( envYaw ), cos( envPitch ), sin( envPitch ) );

        // Expand along the normal rather than rewriting instanceMatrix — the LOD pass
        // already owns those matrices, and fighting it would make the two effects
        // stomp on each other every frame.
        transformed += normal * ( vState.x * uHoverSwell + vState.y * uSelectSwell );`,
      );

    shader.fragmentShader = shader.fragmentShader
      /*
       * Declarations go at <common>, near the top of the shader.
       *
       * `varying vec2 vState` MUST be here and must match the vertex stage exactly — it
       * is the per-instance interaction state, and the whole hover/select path silently
       * fails to compile without it.
       */
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
        uniform float uRefractBlur;
        uniform float uReflectBlur;
        uniform vec3 uEnvLow;
        uniform vec3 uEnvHigh;
        uniform float uEnvJitter;
        uniform float uEnvFilterGain;
        varying vec2 vState;
        varying vec4 vJitter;`,
      )
      /*
       * The environment sampler goes at <clipping_planes_pars_fragment> — the LAST
       * pars-level include before main() — not at <common>.
       *
       * This ordering is not a style preference. In three's meshphysical fragment shader
       * <common> is line 53, but `textureCubeUV` is defined by
       * <cube_uv_reflection_fragment> on line 65 and the `envMap` sampler is declared by
       * <envmap_common_pars_fragment> on line 66. A sampler defined at <common> therefore
       * cannot see either, and fails to compile the moment an env map is attached — while
       * compiling perfectly well in the fallback path, so the bug only appears once the
       * first bake lands.
       */
      .replace(
        '#include <clipping_planes_pars_fragment>',
        `#include <clipping_planes_pars_fragment>

        // ENVMAP_TYPE_CUBE_UV rather than USE_ENVMAP: 'textureCubeUV' only exists for
        // CubeUV-mapped maps, which is what PMREM always produces. Guarding on the
        // broader define would fail to compile if a plain cube or equirect map were
        // ever assigned here.
        /**
         * Rotates a sample direction by this node's own seed. See the vertex stage.
         */
        vec3 envJitter( vec3 d ) {
          vec3 r = vec3( d.x * vJitter.x - d.z * vJitter.y, d.y, d.x * vJitter.y + d.z * vJitter.x );
          return vec3( r.x, r.y * vJitter.z - r.z * vJitter.w, r.y * vJitter.w + r.z * vJitter.z );
        }

        /**
         * refract() with a guard for total internal reflection.
         *
         * It returns EXACTLY vec3(0.0) when the discriminant goes negative, which happens
         * for eta > 1 at grazing angles - reachable, since the IOR control goes to 1.5.
         * A zero direction is not a valid environment lookup and comes back as garbage or
         * a fixed texel, which is what a facet 'skipping' looks like. Falling back to the
         * reflected direction is also physically the right answer: total internal
         * reflection is reflection.
         */
        vec3 refractSafe( vec3 incident, vec3 normal, float eta ) {
          vec3 refracted = refract( incident, normal, eta );
          return dot( refracted, refracted ) < 1e-6 ? reflect( incident, normal ) : refracted;
        }

        #ifdef ENVMAP_TYPE_CUBE_UV
          /**
           * Roughness selects a PMREM mip, so the blur is genuinely prefiltered.
           *
           * The base blur is widened by how fast the sample direction changes across a
           * pixel. This is ordinary texture filtering, and it is what stops the thin
           * pattern lines aliasing: on low-detail tiers the normal is constant across a
           * whole facet, so adjacent facets sample the environment at very different
           * directions and a thin line lands entirely on one and misses its neighbour -
           * the line appears to SKIP a triangle. Widening the filter by the local
           * derivative makes each facet average over the region it actually covers, so
           * the line fades across the seam instead of jumping it.
           */
          vec3 sampleEnv( vec3 dir, float blur ) {
            float footprint = length( fwidth( dir ) ) * uEnvFilterGain;
            return textureCubeUV( envMap, dir, clamp( blur + footprint, 0.0, 1.0 ) ).rgb;
          }
        #else
          // Fallback for the frame or two before the first bake lands.
          //
          // Deliberately the plain theme gradient and NOT the full pattern: reproducing
          // the pattern here would mean carrying its ~18 uniforms on all ~24 batch
          // materials forever, to be used for two frames. The gradient shares the
          // pattern's colours and its overall light direction, so the baked map arriving
          // reads as detail resolving in, not as a different environment.
          vec3 sampleEnv( vec3 dir, float blur ) {
            return mix( uEnvLow, uEnvHigh, smoothstep( -0.4, 0.7, dir.y ) );
          }
        #endif`,
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
        // Sampled SHARP on purpose: dispersion is only visible where the environment
        // has edges, and a blurred sample has none left to fringe.
        //
        // All four samples share one jitter rotation, so the three dispersion taps stay
        // coherent with each other and with the reflection. Rotating them independently
        // would scatter the fringe instead of separating it.
        vec3 refrR = envJitter( viewToWorld * refractSafe( incident, vnNormal, uIor - uDispersion ) );
        vec3 refrG = envJitter( viewToWorld * refractSafe( incident, vnNormal, uIor ) );
        vec3 refrB = envJitter( viewToWorld * refractSafe( incident, vnNormal, uIor + uDispersion ) );
        vec3 refracted = vec3(
          sampleEnv( refrR, uRefractBlur ).r,
          sampleEnv( refrG, uRefractBlur ).g,
          sampleEnv( refrB, uRefractBlur ).b
        );

        vec3 reflected = sampleEnv( envJitter( viewToWorld * reflect( incident, vnNormal ) ), uReflectBlur );

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

  // The envMap presence flips USE_ENVMAP, which produces a genuinely different program.
  // Omitting it here would let three hand back the fallback program for a material that
  // has an env map, or vice versa.
  material.customProgramCacheKey = () => `node-glass-${palette.theme}-${envMap ? 'baked' : 'proc'}`;

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
  material.envMapIntensity = themed.material.envMapIntensity;

  uniforms.uRimPower.value = themed.material.rimPower;
  uniforms.uDispersion.value = themed.material.dispersion;
  uniforms.uIor.value = shared.material.ior;
  uniforms.uRefractBlur.value = shared.material.envRefractBlur;
  uniforms.uReflectBlur.value = shared.material.envReflectBlur;
  uniforms.uEnvJitter.value = shared.material.envJitter;
  uniforms.uEnvFilterGain.value = shared.material.envFilterGain;
  uniforms.uHoverSwell.value = shared.material.hoverSwell;
  uniforms.uSelectSwell.value = shared.material.selectSwell;
}