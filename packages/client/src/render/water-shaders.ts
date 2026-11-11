/**
 * Water shaders, kept apart from the scene so they can be syntax-checked in a
 * unit test without a GPU.
 */

export const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  varying vec3 vWorld;
  varying vec3 vNormal;

  float waveHeight(vec2 p, float t) {
    return sin(p.x * 1.35 + t * 1.1) * 0.030
         + sin(p.y * 1.90 - t * 0.85) * 0.024
         + sin((p.x + p.y) * 1.05 + t * 1.60) * 0.018;
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
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    vec2 uv = vWorld.xz / uSize + 0.5;
    float depth = texture2D(uDepth, uv).r;

    vec3 color = mix(uDeep, uShallow, pow(1.0 - depth, 1.8));

    float shore = smoothstep(0.14, 0.0, depth);
    float ripple = 0.72 + 0.28 * sin(vWorld.x * 4.5 + uTime * 2.2) * sin(vWorld.z * 3.7 - uTime * 1.7);
    color = mix(color, vec3(0.93, 0.96, 0.97), shore * ripple * uFoam);

    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 halfDir = normalize(normalize(uSun) + viewDir);
    float spec = pow(max(dot(n, halfDir), 0.0), 90.0);
    color += vec3(0.95, 0.92, 0.85) * spec * 0.5;

    float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
    color = mix(color, uFog, fog);

    gl_FragColor = vec4(color, 1.0);
  }
`;
