#!/usr/bin/env node
/**
 * Inspect a GLB the way the game will use it: merge every mesh into one
 * geometry, fit it into the unit box, and report what survives.
 *
 *   node tools/inspect-glb.mjs packages/client/public/models/castle-b.glb
 *
 * Prints triangles, meshes, material colours, animations, and the final unit-box
 * size — so a model can be checked before it ships instead of after it looks
 * wrong in a browser.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Front view, no GPU: rasterise the triangles in XY. Crude, but it catches a
 * model that is lying on its side, inside out, or three times too tall.
 */
function silhouette(geometry, width = 44, height = 26) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const vertexAt = (i) => (index ? index.getX(i) : i);
  const triangles = index ? index.count : position.count;
  const grid = Array.from({ length: height }, () => new Array(width).fill(' '));

  const box = geometry.boundingBox;
  const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) || 1;
  const originX = (box.min.x + box.max.x) / 2;
  const toPx = (x, y) => [
    ((x - originX) / span + 0.5) * (width - 1),
    (1 - (y - box.min.y) / span) * (height - 1),
  ];

  for (let t = 0; t < triangles; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => {
      const v = vertexAt(t + k);
      return toPx(position.getX(v), position.getY(v));
    });
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    for (
      let y = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      y <= Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
        x <= Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        x++
      ) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
        if (w0 >= -0.02 && w1 >= -0.02 && 1 - w0 - w1 >= -0.02) grid[y][x] = '#';
      }
    }
  }
  return grid.map((row) => row.join('')).join('\n');
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/inspect-glb.mjs <file.glb>');
  process.exit(1);
}

const bytes = readFileSync(file);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

let gltf;
try {
  gltf = await new GLTFLoader().parseAsync(buffer, '');
} catch (error) {
  console.error(`FAILED to parse: ${error instanceof Error ? error.message : String(error)}`);
  console.error('A Draco-compressed or corrupt GLB cannot be loaded by the game either.');
  process.exit(1);
}

const meshes = [];
gltf.scene.traverse((object) => {
  if (object.isMesh && object.geometry) meshes.push(object);
});

let triangles = 0;
let vertices = 0;
const materials = new Set();
const attributes = new Set();

for (const mesh of meshes) {
  const geometry = mesh.geometry;
  const count = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
  triangles += Math.floor(count / 3);
  vertices += geometry.getAttribute('position').count;
  for (const name of Object.keys(geometry.attributes)) attributes.add(name);
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of list) {
    const colour = material?.color ? `#${material.color.getHexString()}` : 'none';
    materials.add(`${material?.type ?? '?'}:${colour}`);
  }
}

// exactly what render/model.ts does
const parts = meshes.map((mesh) => {
  mesh.updateMatrixWorld(true);
  const flat = new THREE.BufferGeometry();
  flat.setAttribute('position', mesh.geometry.getAttribute('position'));
  if (mesh.geometry.getAttribute('normal'))
    flat.setAttribute('normal', mesh.geometry.getAttribute('normal'));
  const part = mesh.geometry.index ? flat.toNonIndexed() : flat.clone();
  part.applyMatrix4(mesh.matrixWorld);
  return part;
});

let merged = parts.length > 0 ? mergeGeometries(parts, false) : null;
if (merged) {
  merged.computeBoundingBox();
  const box = merged.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);
  const widest = Math.max(size.x, size.z);
  // same rule as render/model.ts: height and footprint fitted independently
  const scaleY = size.y > 1e-6 ? 1 / size.y : 1;
  const scaleXZ = widest > 1e-6 ? 1 / widest : 1;

  console.log(`${basename(file)} — ${(bytes.length / 1024).toFixed(0)} KB`);
  console.log(`  meshes      ${meshes.length}`);
  console.log(`  triangles   ${triangles.toLocaleString('en-US')}`);
  console.log(
    `  vertices    ${vertices.toLocaleString('en-US')} (${merged.getAttribute('position').count.toLocaleString('en-US')} after merge)`,
  );
  console.log(`  attributes  ${[...attributes].join(', ')}`);
  console.log(`  materials   ${[...materials].join(', ') || 'none'}`);
  console.log(`  animations  ${gltf.animations?.length ?? 0}`);
  console.log(`  raw size    ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
  console.log(
    `  unit box    ${(size.x * scaleXZ).toFixed(2)} x ${(size.y * scaleY).toFixed(2)} x ${(size.z * scaleXZ).toFixed(2)} (x${scaleXZ.toFixed(2)} across, x${scaleY.toFixed(2)} tall)`,
  );
  console.log(
    `  in game     ${(size.x * scaleXZ * 0.66).toFixed(2)} cells wide, ${(size.y * scaleY * 1.3).toFixed(2)} units tall at full growth`,
  );
  console.log(`  aspect      authored ${(size.y / widest).toFixed(2)} : 1 tall, in game 1.97 : 1`);
  console.log(
    `  cost        ${(triangles * 800).toLocaleString('en-US')} triangles on an 800-cell map`,
  );

  if (process.argv.includes('--ascii')) {
    console.log(`\n${silhouette(merged)}\n`);
  }
} else {
  console.log(`${basename(file)}: no meshes found`);
}
