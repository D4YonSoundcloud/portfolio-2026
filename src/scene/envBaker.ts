import {
  BufferAttribute,
  Color,
  HalfFloatType,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  WebGLRenderTarget,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';

import {
  ENV_EQUIRECT_DIRECTION,
  ENV_PATTERN_FUNCTION,
  ENV_PATTERN_UNIFORMS,
} from './envPattern.ts';
import type { ScenePalette } from './palette.ts';
import type { SharedValues } from './sceneConfig.ts';
import type { EnvPreviewImage } from './envStore.ts';

/**
 * Bakes the procedural pattern into a real, PMREM-prefiltered environment map.
 *
 * ── Why bake at all ──────────────────────────────────────────────────────────────────
 * The pattern used to be evaluated per fragment, four times over (three dispersion
 * samples plus one reflection). That capped how much structure it could afford to have —
 * every extra feature was paid for on every pixel of every one of ~2600 nodes. Baking it
 * once inverts that: the pattern can be as elaborate as you like, because at render time
 * it is a texture fetch.
 *
 * It also buys the things only a real map can give: three's actual IBL path, and a PMREM
 * mip chain so roughness selects a genuinely prefiltered blur level rather than being
 * approximated.
 *
 * And it ships zero bytes. The environment is still authored in GLSL.
 *
 * ── The two hazards this class exists to contain ─────────────────────────────────────
 * 1. LEAKS. `PMREMGenerator.fromEquirectangular` allocates a NEW render target on every
 *    call. Dragging a slider for thirty seconds at ten bakes a second orphans three
 *    hundred of them, and you lose the WebGL context mid-session and blame the shader.
 *    Every target this class creates is tracked and disposed.
 * 2. STALLS. The equirect pass is a single fullscreen quad — sub-millisecond. The PMREM
 *    prefilter is a multi-pass blur chain costing 5–15ms, which is the entire frame
 *    budget. So the two are separated: `bakeSource` runs live during a drag, `prefilter`
 *    runs on a trailing edge. See `EnvironmentBaker.tsx` for the scheduling.
 */

/** Vertex stage shared by both fullscreen passes. */
const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const EQUIRECT_FRAG = /* glsl */ `
varying vec2 vUv;
${ENV_PATTERN_UNIFORMS}
${ENV_PATTERN_FUNCTION}
${ENV_EQUIRECT_DIRECTION}

void main() {
  gl_FragColor = vec4( astEnv( normalize( envDirectionFromUv( vUv ) ) ), 1.0 );
}
`;

/**
 * The preview pass differs from the bake in one way: it tone maps and gamma encodes, so
 * the readback is display-ready bytes.
 *
 * Doing the encode here rather than relying on the render target's colour space keeps it
 * unambiguous — target colour-space handling has shifted across three releases, and a
 * preview that is subtly wrong is worse than no preview. Reinhard rather than ACES on
 * purpose: it is monotonic and gentle, so what you see maps predictably back to the
 * numbers in the sliders instead of being reshaped by a filmic curve.
 */
const PREVIEW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uExposure;
uniform float uPreviewScale;
${ENV_PATTERN_UNIFORMS}
${ENV_PATTERN_FUNCTION}
${ENV_EQUIRECT_DIRECTION}

void main() {
  // Normalised by the theme's own bright end before exposure is applied. Without this
  // the dark theme previews as a black rectangle at exposure 1 and the light theme as a
  // white one — in both cases indistinguishable from a preview that is simply broken.
  vec3 c = astEnv( normalize( envDirectionFromUv( vUv ) ) ) * uPreviewScale * uExposure;
  c = c / ( c + vec3( 1.0 ) );
  gl_FragColor = vec4( pow( c, vec3( 1.0 / 2.2 ) ), 1.0 );
}
`;

export interface EnvPatternUniforms {
  [name: string]: IUniform<unknown>;
}

/** Builds the uniform block. Values are filled by `updateUniforms`. */
function createUniforms(): EnvPatternUniforms {
  return {
    uEnvLow: { value: new Color() },
    uEnvHigh: { value: new Color() },
    uLineColor: { value: new Color() },
    uKeyColor: { value: new Color() },
    uRotation: { value: 0 },
    uHorizonHeight: { value: 0 },
    uHorizonSharp: { value: 0 },
    uPanelSteps: { value: 0 },
    uBandCount: { value: 0 },
    uBandWidth: { value: 0 },
    uBandGain: { value: 0 },
    uMeridianCount: { value: 0 },
    uMeridianWidth: { value: 0 },
    uMeridianGain: { value: 0 },
    uMeridianPolarFade: { value: 1 },
    uKeyElevation: { value: 0 },
    uKeyAzimuth: { value: 0 },
    uKeyPower: { value: 1 },
    uKeyGain: { value: 0 },
  };
}

const DEG = Math.PI / 180;

function updateUniforms(
  uniforms: EnvPatternUniforms,
  palette: ScenePalette,
  shared: SharedValues,
): void {
  const p = shared.envPattern;

  (uniforms['uEnvLow']!.value as Color).copy(palette.envLow);
  (uniforms['uEnvHigh']!.value as Color).copy(palette.envHigh);
  // Lines and key take their colour from the bright end of the theme's own environment
  // gradient, so the pattern can never introduce a hue that is not already in the design.
  (uniforms['uLineColor']!.value as Color).copy(palette.envHigh);
  (uniforms['uKeyColor']!.value as Color).copy(palette.envHigh);

  uniforms['uRotation']!.value = p.rotation * DEG;
  uniforms['uHorizonHeight']!.value = p.horizonHeight;
  uniforms['uHorizonSharp']!.value = p.horizonSharpness;
  uniforms['uPanelSteps']!.value = p.panelSteps;
  uniforms['uBandCount']!.value = p.bandCount;
  uniforms['uBandWidth']!.value = p.bandWidth;
  uniforms['uBandGain']!.value = p.bandGain;
  uniforms['uMeridianCount']!.value = p.meridianCount;
  uniforms['uMeridianWidth']!.value = p.meridianWidth;
  uniforms['uMeridianGain']!.value = p.meridianGain;
  uniforms['uMeridianPolarFade']!.value = p.meridianPolarFade;
  uniforms['uKeyElevation']!.value = p.keyElevation * DEG;
  uniforms['uKeyAzimuth']!.value = p.keyAzimuth * DEG;
  uniforms['uKeyPower']!.value = p.keyPower;
  uniforms['uKeyGain']!.value = p.keyGain;
}

/** Flips a WebGL bottom-up readback into a top-down image. */
function toImage(raw: Uint8Array, width: number, height: number): EnvPreviewImage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * stride;
    pixels.set(raw.subarray(src, src + stride), y * stride);
  }
  return { width, height, pixels };
}

const PREVIEW_WIDTH = 320;
const PROBE_SIZE = 180;

export class EnvBaker {
  private readonly renderer: WebGLRenderer;
  private readonly pmrem: PMREMGenerator;

  private readonly uniforms = createUniforms();
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly bakeMaterial: ShaderMaterial;
  private readonly previewMaterial: ShaderMaterial;
  private readonly quad: Mesh;

  private sourceTarget: WebGLRenderTarget | null = null;
  private sourceResolution = 0;
  private prefiltered: WebGLRenderTarget | null = null;

  /** Editor-only preview resources, created lazily on first preview request. */
  private previewTarget: WebGLRenderTarget | null = null;
  private probeTarget: WebGLRenderTarget | null = null;
  private probeScene: Scene | null = null;
  private probeCamera: PerspectiveCamera | null = null;
  private probeMirror: Mesh | null = null;
  private probeGlass: Mesh | null = null;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.pmrem = new PMREMGenerator(renderer);
    // Warms the prefilter shaders now rather than on the first user-visible bake.
    this.pmrem.compileEquirectangularShader();

    this.bakeMaterial = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: EQUIRECT_FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });

    this.previewMaterial = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: PREVIEW_FRAG,
      uniforms: { ...this.uniforms, uExposure: { value: 1 }, uPreviewScale: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new Mesh(new PlaneGeometry(2, 2), this.bakeMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /**
   * Renders the pattern to the equirectangular source target. Cheap — safe to run on
   * every slider tick.
   */
  bakeSource(palette: ScenePalette, shared: SharedValues): void {
    const width = Math.max(64, Math.round(shared.envPattern.bakeResolution));

    if (!this.sourceTarget || this.sourceResolution !== width) {
      this.sourceTarget?.dispose();
      this.sourceTarget = new WebGLRenderTarget(width, width / 2, {
        type: HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      // Linear throughout: PMREM expects unencoded values, and the pattern emits them.
      this.sourceTarget.texture.colorSpace = NoColorSpace;
      this.sourceResolution = width;
    }

    updateUniforms(this.uniforms, palette, shared);

    const previousTarget = this.renderer.getRenderTarget();
    this.quad.material = this.bakeMaterial;
    this.renderer.setRenderTarget(this.sourceTarget);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.setRenderTarget(previousTarget);
  }

  /**
   * Runs the PMREM prefilter over the current source and returns the usable env map.
   *
   * Expensive. Call on a trailing edge, not during a drag.
   */
  prefilter(): Texture | null {
    if (!this.sourceTarget) return null;

    const previous = this.prefiltered;
    this.prefiltered = this.pmrem.fromEquirectangular(this.sourceTarget.texture);
    // Dispose AFTER the new one exists: the material may still reference the old texture
    // for the few milliseconds before the swap propagates.
    previous?.dispose();

    return this.prefiltered.texture;
  }

  /**
   * EDITOR ONLY — the unwrapped environment, tone mapped and read back to bytes.
   *
   * This is the view that changes the workflow: without it you are inferring the
   * environment's shape from its reflection on faceted objects, which is like tuning a
   * light by looking at the shadows.
   */
  renderEquirectPreview(
    palette: ScenePalette,
    shared: SharedValues,
    exposure: number,
  ): EnvPreviewImage | null {
    if (!__SCENE_EDITOR__) return null;

    const width = PREVIEW_WIDTH;
    const height = width / 2;

    if (!this.previewTarget) {
      this.previewTarget = new WebGLRenderTarget(width, height, {
        type: UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      this.previewTarget.texture.colorSpace = NoColorSpace;
    }

    updateUniforms(this.uniforms, palette, shared);
    // The preview material holds its own uniform objects for the shared names, so they
    // have to be re-pointed rather than assumed to alias.
    for (const [name, uniform] of Object.entries(this.uniforms)) {
      const target = this.previewMaterial.uniforms[name];
      if (target) target.value = uniform.value;
    }
    this.previewMaterial.uniforms['uExposure']!.value = exposure;
    // 1 / the brightest channel of the theme's env-high token, so mid-grey in the
    // preview corresponds to the top of the gradient in either theme.
    const { r, g, b } = palette.envHigh;
    this.previewMaterial.uniforms['uPreviewScale']!.value = 1 / Math.max(r, g, b, 0.02);

    const previousTarget = this.renderer.getRenderTarget();
    this.quad.material = this.previewMaterial;
    this.renderer.setRenderTarget(this.previewTarget);
    this.renderer.render(this.quadScene, this.quadCamera);

    const raw = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(this.previewTarget, 0, 0, width, height, raw);
    this.renderer.setRenderTarget(previousTarget);
    this.quad.material = this.bakeMaterial;

    return toImage(raw, width, height);
  }

  /**
   * EDITOR ONLY — two spheres lit by the baked map.
   *
   * Left is a mirror at roughness 0, which is the honest view of what the environment
   * actually contains: at the material's real roughness the PMREM chain blurs structure
   * into the mid mips and you cannot tell a detailed map from a vague one. Right wears
   * the actual node material, so you can see what that structure does to the glass —
   * particularly whether the dispersion fringing is reading.
   */
  renderProbe(nodeMaterial: MeshPhysicalMaterial | null, envMap: Texture | null): EnvPreviewImage | null {
    if (!__SCENE_EDITOR__ || !envMap) return null;

    if (!this.probeScene) {
      this.probeScene = new Scene();
      this.probeCamera = new PerspectiveCamera(35, 2, 0.1, 100);
      this.probeCamera.position.set(0, 0, 6);

      this.probeMirror = new Mesh(
        new SphereGeometry(1, 48, 32),
        new MeshPhysicalMaterial({ roughness: 0, metalness: 1, color: 0xffffff }),
      );
      this.probeMirror.position.x = -1.25;

      // Faceted, matching the nodes — a smooth sphere would hide exactly the hard-edged
      // Fresnel behaviour the material is built around.
      const glassGeometry = new IcosahedronGeometry(1, 2);
      // The node shader declares `attribute vec2 aState`. On the instanced meshes that
      // is an InstancedBufferAttribute; here it must be supplied as an ordinary
      // per-vertex attribute, or the probe renders with an unbound attribute and the
      // hover/select term reads garbage.
      const vertexCount = glassGeometry.attributes['position']!.count;
      glassGeometry.setAttribute(
        'aState',
        new BufferAttribute(new Float32Array(vertexCount * 2), 2),
      );
      // Zeroed, so the probe samples the environment unjittered - it is a reference
      // view, and a random rotation would make it disagree with the unwrapped preview
      // sitting directly above it.
      glassGeometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(vertexCount), 1));
      this.probeGlass = new Mesh(glassGeometry, new MeshBasicMaterial());
      this.probeGlass.position.x = 1.25;

      this.probeScene.add(this.probeMirror, this.probeGlass);
    }

    if (!this.probeTarget) {
      this.probeTarget = new WebGLRenderTarget(PROBE_SIZE * 2, PROBE_SIZE, {
        type: UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      });
      this.probeTarget.texture.colorSpace = NoColorSpace;
    }

    const mirror = this.probeMirror!.material as MeshPhysicalMaterial;
    if (mirror.envMap !== envMap) {
      mirror.envMap = envMap;
      // Only on an actual change: assigning needsUpdate unconditionally forces a shader
      // recompile on every bake, which is exactly the cost the trailing edge exists to
      // avoid.
      mirror.needsUpdate = true;
    }
    if (nodeMaterial) this.probeGlass!.material = nodeMaterial;

    const previousTarget = this.renderer.getRenderTarget();
    const previousClear = this.renderer.getClearColor(new Color());
    const previousAlpha = this.renderer.getClearAlpha();

    // An opaque neutral ground, restored afterwards. R3F clears to transparent black, and
    // a transparent readback blits as nothing — which is indistinguishable from a preview
    // that never received data. It also gives the dark theme's spheres something to read
    // against.
    this.renderer.setClearColor(0x2a2a2a, 1);
    this.renderer.setRenderTarget(this.probeTarget);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.probeScene, this.probeCamera!);

    const width = PROBE_SIZE * 2;
    const raw = new Uint8Array(width * PROBE_SIZE * 4);
    this.renderer.readRenderTargetPixels(this.probeTarget, 0, 0, width, PROBE_SIZE, raw);
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousClear, previousAlpha);

    return toImage(raw, width, PROBE_SIZE);
  }

  dispose(): void {
    this.sourceTarget?.dispose();
    this.prefiltered?.dispose();
    this.previewTarget?.dispose();
    this.probeTarget?.dispose();
    this.pmrem.dispose();
    this.bakeMaterial.dispose();
    this.previewMaterial.dispose();
    this.quad.geometry.dispose();
    (this.probeMirror?.material as MeshPhysicalMaterial | undefined)?.dispose();
    this.probeMirror?.geometry.dispose();
    this.probeGlass?.geometry.dispose();
  }
}