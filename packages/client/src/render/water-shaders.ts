/**
 * Water shaders, kept apart from the scene so they can be syntax-checked in a
 * unit test without a GPU.
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
  uniform vec2 uSize;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSun;
  uniform vec3 uFog;
  uniform float uFoam;
  uniform float uTime;
  uniform float uFogNear;
  uniform float uFogFar;
  /* Half-diagonal of the board; beyond it the sea fades into the sky. */
  uniform float uRadius;
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    vec2 uv = vWorld.xz / uSize + 0.5;
    float depth = texture2D(uDepth, uv).r;

    vec3 color = mix(uDeep, uShallow, pow(1.0 - depth, 1.8));

    // A narrow band, not a white halo: 0.14 of the depth range is ~800 m of
    // shelf, which at this cell size paints a ring several cells wide.
    float shore = smoothstep(0.055, 0.0, depth);
    float ripple = 0.72 + 0.28 * sin(vWorld.x * 4.5 + uTime * 2.2) * sin(vWorld.z * 3.7 - uTime * 1.7);
    color = mix(color, vec3(0.90, 0.95, 0.97), shore * ripple * uFoam * 0.55);

    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 halfDir = normalize(normalize(uSun) + viewDir);
    float spec = pow(max(dot(n, halfDir), 0.0), 90.0);
    color += vec3(0.95, 0.92, 0.85) * spec * 0.5;

    float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
    color = mix(color, uFog, fog);

    // The plane is finite. Fading it out by distance from the board centre hides
    // the cut edge behind the horizon instead of showing a floating slab.
    float radial = length(vWorld.xz) / uRadius;
    color = mix(color, uFog, smoothstep(0.95, 1.55, radial));

    gl_FragColor = vec4(color, 1.0);
  }
`;
