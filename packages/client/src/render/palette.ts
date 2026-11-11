/**
 * Sky, sun and ambient colour as a function of the time of day.
 *
 * Pure on purpose: the whole day/night look is a handful of keyframes and an
 * interpolation, which is testable, instead of colour picks buried in the scene.
 * `t` is 0..1, where 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
 */

export type Rgb = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

export interface Lighting {
  /** Unit vector from the scene towards the sun. */
  readonly sunDir: Vec3;
  readonly sky: Rgb;
  readonly sun: Rgb;
  /** 0..1, multiplier for the hemisphere light. */
  readonly ambient: number;
  /** 0 at full day, 1 at full night — drives the window glow. */
  readonly night: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [
  mix(a[0], b[0], k),
  mix(a[1], b[1], k),
  mix(a[2], b[2], k),
];

interface Key {
  at: number;
  sky: Rgb;
  sun: Rgb;
  ambient: number;
}

// Four anchors are enough: night, dawn, day, dusk, wrapping back to night.
const KEYS: readonly Key[] = [
  { at: 0.0, sky: [0.043, 0.063, 0.11], sun: [0.35, 0.42, 0.62], ambient: 0.22 },
  { at: 0.22, sky: [0.09, 0.11, 0.19], sun: [0.55, 0.42, 0.45], ambient: 0.24 },
  { at: 0.28, sky: [0.79, 0.47, 0.31], sun: [1.0, 0.63, 0.36], ambient: 0.5 },
  { at: 0.36, sky: [0.73, 0.78, 0.82], sun: [1.0, 0.9, 0.78], ambient: 0.72 },
  { at: 0.5, sky: [0.69, 0.8, 0.87], sun: [1.0, 0.97, 0.9], ambient: 0.85 },
  { at: 0.66, sky: [0.75, 0.79, 0.82], sun: [1.0, 0.88, 0.72], ambient: 0.72 },
  { at: 0.74, sky: [0.83, 0.45, 0.3], sun: [1.0, 0.56, 0.32], ambient: 0.48 },
  { at: 0.8, sky: [0.14, 0.15, 0.24], sun: [0.6, 0.42, 0.45], ambient: 0.27 },
  { at: 1.0, sky: [0.043, 0.063, 0.11], sun: [0.35, 0.42, 0.62], ambient: 0.22 },
];

export function lightingAt(timeOfDay: number): Lighting {
  const t = ((timeOfDay % 1) + 1) % 1;

  let previous = KEYS[0] as Key;
  let next = KEYS[KEYS.length - 1] as Key;
  for (let i = 1; i < KEYS.length; i++) {
    const candidate = KEYS[i] as Key;
    if (t <= candidate.at) {
      next = candidate;
      previous = KEYS[i - 1] as Key;
      break;
    }
  }

  const span = next.at - previous.at || 1;
  const k = clamp01((t - previous.at) / span);

  const sky = mixRgb(previous.sky, next.sky, k);
  const sun = mixRgb(previous.sun, next.sun, k);
  const ambient = mix(previous.ambient, next.ambient, k);

  // A simple arc: east at sunrise, overhead at noon, west at sunset, below the
  // horizon at night. Not astronomically exact; it only has to read as "day".
  const angle = (t - 0.25) * Math.PI * 2;
  const elevation = Math.sin(angle);
  const dir: Vec3 = normalize([Math.cos(angle) * 0.75, elevation, 0.42]);

  const night = clamp01(-elevation * 3.2);

  return { sunDir: dir, sky, sun, ambient, night };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Local wall-clock time as 0..1, used by the "auto" lighting mode. */
export function timeOfDayFromDate(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  return hours / 24;
}

export const toCss = (color: Rgb): string =>
  `rgb(${Math.round(color[0] * 255)} ${Math.round(color[1] * 255)} ${Math.round(color[2] * 255)})`;
