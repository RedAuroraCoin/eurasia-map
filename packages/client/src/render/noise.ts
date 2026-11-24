import * as THREE from 'three';
import { createNoise4D } from 'simplex-noise';

/**
 * A seamless noise texture for the sea.
 *
 * The water used to be three sine waves and nothing else, which is why it read as
 * glass: no small-scale structure means the sun's reflection is one smooth, coherent
 * patch — a white band that travelled across the sea as the camera turned, and with
 * bloom on it turned into a glare.
 *
 * The texture is sampled on a torus in 4D, so it tiles perfectly in both directions
 * and the sea never shows a seam. Two channels: one coarse for swell, one finer for
 * chop. It is built once per view, from a fixed seed, so every device sees the same
 * sea.
 */

/** A small deterministic generator: the same sea on every load and every device. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOISE_SIZE = 128;
export const NOISE_SEED = 0x5ea51de;

export function createNoiseTexture(size = NOISE_SIZE, seed = NOISE_SEED): THREE.DataTexture {
  const noise = createNoise4D(mulberry32(seed));
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      // Two circles make a torus: the field wraps in u and in v, so the texture
      // repeats without a visible edge.
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);

      const coarse = noise(cu, su, cv, sv);
      // The second octave runs at twice the frequency; still an integer multiple of
      // the period, so it wraps too.
      const fine = noise(cu * 2 + 11.3, su * 2 + 7.1, cv * 2 - 5.7, sv * 2 + 3.9);

      const index = (y * size + x) * 4;
      data[index] = Math.round((coarse * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((fine * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((coarse * fine * 0.5 + 0.5) * 255);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  // Data bytes are red-noise, not colour: leave them alone.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
