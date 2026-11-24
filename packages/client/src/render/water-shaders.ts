/**
 * Water shaders, kept apart from the scene so they can be syntax-checked in a
 * unit test without a GPU.
 *
 * Two things this shader has learned the hard way:
 *
 * 1. Colours arrive as display values (they are authored as hex in the palette) and
 *    are converted to linear here, then `colorspace_fragment` lets three encode the
 *    result for whichever buffer it is drawing into — the canvas, or the composer's
 *    linear target. Without that, adding bloom brightened the whole sea, because
 *    display values were re-encoded as if they had been linear.
 * 2. The sun's reflection must never become a white disc. A single smooth normal
 *    field and a tight highlight made a band that followed the camera and blinded at
 *    grazing angles; bloom then smeared it across the screen.
 */

export const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  varying vec3 vWorld;
  varying vec3 vNormal;

  // Long wavelengths on purpose: the sea mesh is coarse far from the board,
  // and a short wave there is aliasing, not water.
  float waveHeight(vec2 p, float t) {
    return sin(p.x * 0.80 + t * 1.1) * 0.034
         + sin(p.y * 1.10 - t * 0.85) * 0.026
         + sin((p.x + p.y) * 0.60 + t * 1.60) * 0.020;
  }

  void main() {
    vec3 p = position;
    float h = waveHeight(p.xz, uTime) * uAmplitude;
    p.y += h;

    float e = 0.35;
    float hx = waveHeight(p.xz + vec2(e, 0.0), uTime) * uAmplitude;
    float hz = waveHeight(p.xz + vec2(0.0, e), uTime) * uAmplitude;
    vNormal = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const WATER_FRAGMENT = /* glsl */ `
  uniform sampler2D uDepth;
  /* Seamless noise: swell, chop, foam. Built once, sampled twice, scrolling. */
  uniform sampler2D uNoise;
  uniform vec2 uSize;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSun;
  uniform vec3 uFog;
  uniform float uFoam;
  uniform float uTime;
  uniform float uFogNear;
  uniform float uFogFar;
  /* 1 when drawing into the composer's linear target, 0 for the sRGB canvas. */
  uniform float uLinear;
  /* Half-diagonal of the board; beyond it the sea fades into the sky. */
  uniform float uRadius;
  varying vec3 vWorld;
  varying vec3 vNormal;

  /* The palette is authored as it should look on screen; the pipeline wants
     linear. One approximation at the door beats re-authoring every colour. */
  vec3 toLinear(vec3 c) {
    return pow(c, vec3(2.2));
  }

  void main() {
    vec2 uv = vWorld.xz / uSize + 0.5;
    float depth = texture2D(uDepth, uv).r;

    vec3 color = mix(toLinear(uDeep), toLinear(uShallow), pow(1.0 - depth, 1.8));

    // Two scrolling octaves: one broad swell, one tighter chop. Scrolling in
    // different directions is what stops the pattern from simply sliding.
    vec2 flowSwell = vWorld.xz * 0.018 + vec2(uTime * 0.021, uTime * -0.013);
    vec2 flowChop = vWorld.xz * 0.047 + vec2(uTime * -0.017, uTime * 0.026);
    vec2 swell = texture2D(uNoise, flowSwell).rg * 2.0 - 1.0;
    vec2 chop = texture2D(uNoise, flowChop).rg * 2.0 - 1.0;

    // Tilt the surface normal with the noise: the highlight then breaks into
    // glints instead of sitting in one place.
    vec3 n = normalize(
      vNormal + vec3(swell.x * 0.11 + chop.x * 0.05, 0.0, swell.y * 0.11 + chop.y * 0.05)
    );

    // A shore band, not a white halo: 0.055 of the depth range is the shelf.
    float shore = smoothstep(0.055, 0.0, depth);
    float foamA = texture2D(uNoise, vWorld.xz * 0.07 + vec2(uTime * 0.012)).b;
    float foamB = texture2D(uNoise, vWorld.xz * 0.16 - vec2(uTime * 0.022)).g;
    float foam = smoothstep(0.40, 0.80, foamA * 0.55 + foamB * 0.55);
    color = mix(
      color,
      toLinear(vec3(0.90, 0.95, 0.97)),
      shore * (0.30 + 0.70 * foam) * uFoam * 0.75
    );

    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 halfDir = normalize(normalize(uSun) + viewDir);
    float facing = max(dot(n, halfDir), 0.0);

    // Two lobes: a broad sheen that carries the colour, a tight sparkle that rides
    // the noise. Neither may blow out — a clipped white disc is exactly the glare.
    float sheen = pow(facing, 18.0) * 0.30;
    float sparkle = pow(facing, 260.0) * 0.55;
    float glare = sheen + sparkle;
    // A soft ceiling: bright, never blinding, and below the bloom threshold so the
    // sea glows with the sunset rather than whitening the screen.
    glare = glare / (1.0 + glare * 1.35);

    // Grazing angles reflect most — that is where it used to hurt the eye. Kept,
    // but capped.
    float fresnel = clamp(pow(1.0 - max(dot(n, viewDir), 0.0), 5.0), 0.0, 0.6);
    color += toLinear(vec3(0.95, 0.92, 0.85)) * glare * (0.45 + fresnel * 0.55);

    float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
    color = mix(color, toLinear(uFog), fog);

    // The plane is finite. Fading it out by distance from the board centre hides
    // the cut edge behind the horizon instead of showing a floating slab.
    float radial = length(vWorld.xz) / uRadius;
    color = mix(color, toLinear(uFog), smoothstep(0.95, 1.55, radial));

    // Where the frame lands decides the encoding: the canvas wants sRGB, the
    // composer's half-float target wants linear, because OutputPass encodes the
    // whole frame at the end. Doing it here keeps the sea the same colour whether
    // glow is on or off.
    color = mix(pow(color, vec3(1.0 / 2.2)), color, uLinear);
    gl_FragColor = vec4(color, 1.0);
  }
`;
