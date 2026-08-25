/**
 * The procedural environment pattern.
 *
 * ── Why this is one named function ───────────────────────────────────────────────────
 * Three consumers evaluate the same pattern and must agree exactly: the equirectangular
 * bake that feeds PMREM, the 2D preview in the dev editor, and the probe spheres. Any
 * drift between them and the preview is lying to you, which is worse than having no
 * preview at all. So the pattern exists once, as a string, and the three call sites
 * differ only in what they do with the result.
 *
 * It also means swapping to a real HDRI later is a matter of replacing one function
 * body — the plumbing around it does not care where the colour came from.
 *
 * ── Why it looks like this ───────────────────────────────────────────────────────────
 * Refraction is only PERCEPTIBLE where the environment has a discontinuity. A smooth
 * gradient, bent, is still a smooth gradient — which is exactly why the previous
 * per-fragment version could never sell the effect no matter how it was tuned. So the
 * vocabulary here is deliberately hard-edged: a stepped horizon rather than a ramp, thin
 * bright lines at regular angular intervals rather than a broad lobe, optional posterised
 * panels. Latitude and longitude lines also keep it legible as a SCHEMATIC environment
 * (§7.1) rather than a photographic one, which would drag the whole scene toward looking
 * like a product render.
 *
 * The thin lines are what finally make the per-channel dispersion visible: until now
 * there were no edges in the environment to fringe.
 *
 * ── The bloom trap ───────────────────────────────────────────────────────────────────
 * `SCENE_DEFAULTS.themed.dark.bloom.threshold` carries a comment about raising it to
 * stop the node cloud blooming into haze. Bright environment features reopen exactly
 * that wound. The escape is to keep the lines THIN rather than BRIGHT — high spatial
 * frequency, modest luminance — which is why the default widths are small and the
 * default gains are moderate.
 */

/**
 * Uniform declarations, shared verbatim by every consumer.
 *
 * Colours come from the theme tokens (`--scene-env-low` / `--scene-env-high`, read by
 * `palette.ts`); the structure comes from `SCENE_DEFAULTS.shared.envPattern`. That split
 * mirrors the one described in `sceneConfig.ts`: colour is a design token, geometry is
 * render physics.
 */
export const ENV_PATTERN_UNIFORMS = /* glsl */ `
uniform vec3 uEnvLow;
uniform vec3 uEnvHigh;
uniform vec3 uLineColor;
uniform vec3 uKeyColor;

uniform float uRotation;
uniform float uHorizonHeight;
uniform float uHorizonSharp;
uniform float uPanelSteps;

uniform float uBandCount;
uniform float uBandWidth;
uniform float uBandGain;

uniform float uMeridianCount;
uniform float uMeridianWidth;
uniform float uMeridianGain;
uniform float uMeridianPolarFade;

uniform float uKeyElevation;
uniform float uKeyAzimuth;
uniform float uKeyPower;
uniform float uKeyGain;
`;

/**
 * The pattern itself. Takes a normalised direction, returns a linear (possibly >1) colour.
 *
 * `PI` is guarded because this string is injected both into standalone ShaderMaterials
 * (where nothing has defined it) and, for the fallback path, into a three material whose
 * `<common>` chunk already has.
 */
export const ENV_PATTERN_FUNCTION = /* glsl */ `
#ifndef PI
  #define PI 3.141592653589793
#endif

/**
 * A thin line every 1/count of the way through 'coord' (given in turns, 0..1).
 * Returns 0 away from a line, 1 on it, with a short antialiased shoulder.
 */
float envGridLine( float coord, float count, float width ) {
  if ( count < 0.5 ) return 0.0;
  float f = fract( coord * count );
  float d = min( f, 1.0 - f );
  return 1.0 - smoothstep( 0.0, max( width, 1e-4 ), d );
}

vec3 astEnv( vec3 dir ) {
  // Spin the whole pattern about Y. Baked in rather than applied at sample time: it is
  // a property of the environment, and doing it here costs nothing at render time.
  float cr = cos( uRotation );
  float sr = sin( uRotation );
  vec3 d = vec3( dir.x * cr - dir.z * sr, dir.y, dir.x * sr + dir.z * cr );

  // Ground / sky division. Sharpness 0 gives the old broad ramp; 1 gives a hard edge,
  // which is the version that actually refracts visibly.
  float edge = mix( 1.0, 0.004, clamp( uHorizonSharp, 0.0, 1.0 ) );
  float t = smoothstep( uHorizonHeight - edge, uHorizonHeight + edge, d.y );
  vec3 col = mix( uEnvLow, uEnvHigh, t );

  // Posterise into discrete panels. Every step boundary is another edge for the
  // refraction to bend, so this is a structure control, not just a stylistic one.
  if ( uPanelSteps >= 1.0 ) {
    col = floor( col * uPanelSteps + 0.5 ) / uPanelSteps;
  }

  // Latitude bands. Evenly spaced in ANGLE, not in y, so they read as a wireframe
  // globe rather than bunching toward the poles.
  float lat = asin( clamp( d.y, -1.0, 1.0 ) ) / PI + 0.5;
  col += uLineColor * envGridLine( lat, uBandCount, uBandWidth ) * uBandGain;

  // Meridians. These necessarily converge at the poles — that convergence is legible
  // as a pole rather than as an artifact, so it is left alone.
  float lon = atan( d.z, d.x ) / ( 2.0 * PI ) + 0.5;
  col += uLineColor * envGridLine( lon, uMeridianCount, uMeridianWidth ) * uMeridianGain;

  // The key lobe, carried over from the original procedural environment. Spherical
  // angles rather than a hardcoded vector, so it is steerable from the editor.
  vec3 keyDir = vec3(
    cos( uKeyElevation ) * cos( uKeyAzimuth ),
    sin( uKeyElevation ),
    cos( uKeyElevation ) * sin( uKeyAzimuth )
  );
  float key = pow( max( dot( d, keyDir ), 0.0 ), max( uKeyPower, 0.001 ) );
  col += uKeyColor * key * uKeyGain;

  return max( col, vec3( 0.0 ) );
}
`;

/**
 * Direction -> equirectangular UV, matching three's own `equirectUv` exactly.
 *
 * This convention is not ours to choose: `PMREMGenerator.fromEquirectangular` samples
 * with `u = atan(z, x) / 2PI + 0.5`, `v = asin(y) / PI + 0.5`. The bake writes the
 * inverse of that, so getting it wrong shows up as an environment that is mirrored or
 * rotated 90° relative to the preview — a subtle enough error to waste an afternoon.
 */
export const ENV_EQUIRECT_DIRECTION = /* glsl */ `
vec3 envDirectionFromUv( vec2 uv ) {
  float phi = ( uv.x - 0.5 ) * 2.0 * PI;
  float theta = ( uv.y - 0.5 ) * PI;
  float ct = cos( theta );
  return vec3( ct * cos( phi ), sin( theta ), ct * sin( phi ) );
}
`;