import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Custom building models.
 *
 * The game ships with a procedural castle, but a real model is better if you
 * have one. Drop a GLB at `packages/client/public/models/castle.glb` and it
 * replaces the procedural castle on the next load — nothing else to change.
 * If the file is missing, is not a GLB, or fails to parse, the procedural castle
 * stays and the console says why. A bad export can never break the game.
 *
 * Two reasons this is a runtime load and not a build step: the artist workflow
 * is "export, drop in, refresh", and users who never add a model never download
 * the loader (it is a dynamic import).
 */

/**
 * Relative on purpose: resolved against the page, so the game works at the site
 * root, under a sub-path, and inside the Worker's static assets without config.
 * Nothing here touches `document`, so the module also loads under Node tests.
 */
export const BUILDING_MODEL_URL = 'models/castle.glb';

/** Used for meshes that carry no material colour of their own. */
const DEFAULT_HEX = '#cfc7b4';

const scratch = new THREE.Color();

/**
 * Keep only what the instanced material reads, and give every mesh a vertex
 * colour. Models exported from Blender arrive with uv, tangents and sometimes
 * skin weights; merging geometries with mismatched attributes throws.
 */
function flatten(geometry: THREE.BufferGeometry, materialHex: string | null): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', geometry.getAttribute('position'));

  const normal = geometry.getAttribute('normal');
  if (normal) out.setAttribute('normal', normal);

  const color = geometry.getAttribute('color');
  if (color) {
    out.setAttribute('color', color);
  } else {
    scratch.set(materialHex ?? DEFAULT_HEX);
    const count = out.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

function materialHex(mesh: THREE.Mesh): string | null {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const color = (material as THREE.MeshStandardMaterial | undefined)?.color;
  return color ? `#${color.getHexString()}` : null;
}

/**
 * Flatten a loaded scene into one geometry, in world space. One geometry is what
 * lets eight hundred castles stay a single instanced draw call.
 */
export function mergeObject(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const flat = flatten(mesh.geometry, materialHex(mesh));
    const part = flat.index ? flat.toNonIndexed() : flat;
    part.applyMatrix4(mesh.matrixWorld);
    parts.push(part);
  });

  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * Fit the model into the unit box the instancing contract expects: base at
 * y = 0, centred on x/z, no dimension above 1. Scaling is uniform, so a model
 * wider than it is tall ends up shorter than a full unit rather than distorted.
 */
export function normalizeToUnitBox(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;

  const size = new THREE.Vector3();
  box.getSize(size);
  const widest = Math.max(size.x, size.z);
  const scale = Math.min(size.y > 1e-6 ? 1 / size.y : 1, widest > 1e-6 ? 1 / widest : 1);

  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -box.min.y, -center.z);
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Returns null when there is no model at `url` — the caller keeps its fallback. */
export async function loadBuildingModel(url: string): Promise<THREE.BufferGeometry | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.arrayBuffer();
    // Imported only once a model actually exists, so it is not in the main bundle.
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const merged = mergeObject(gltf.scene);
    return merged ? normalizeToUnitBox(merged) : null;
  } catch (error) {
    console.warn('[eurasia] custom building model ignored:', error);
    return null;
  }
}
