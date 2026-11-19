#!/usr/bin/env node
/**
 * Builds the side-B castle-tower as a GLB: golden stone, dark green roofs,
 * ~1 500 triangles, one merged mesh, flat vertex colours with per-block jitter
 * so the wall reads as stone without a texture.
 *
 *   node tools/make-castle-b.mjs
 *
 * The output is deterministic — same seed, same bytes — so the model can be
 * regenerated after a tweak instead of being an opaque blob in the repo.
 *
 * Contract (see packages/client/public/models/README.md): one mesh, Y-up, height
 * exactly 1, width 0.5 (2 : 1), vertex colours only, no animation, no textures.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/client/public/models/castle-b.glb',
);
const TRIANGLE_BUDGET = { min: 1400, max: 1600 };

// ------------------------------------------------------------------ palette
/**
 * Authored as sRGB hex and converted, because vertex colours are consumed in the
 * renderer's linear working space. Writing the sRGB numbers straight into the
 * buffer is the classic mistake: everything comes out washed out and flat.
 */
const linear = (hex) => {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => c / 255);
  return channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
};

const STONE = linear('#c8a86a'); // golden sandstone
const STONE_DARK = linear('#a8874a');
const STONE_LIGHT = linear('#d9bd85');
const ROOF = linear('#1c3621'); // dark green
const ROOF_DARK = linear('#142817');
const WOOD = linear('#3d2617');
const SHADOW = linear('#171310'); // window reveals

// ------------------------------------------------------------- deterministic
let seed = 0x9e3779b9;
function random() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Per-quad tone jitter: the whole trick behind "looks like stone, no texture". */
function shade(color, spread = 0.09) {
  const k = 1 + (random() * 2 - 1) * spread;
  return [Math.min(1, color[0] * k), Math.min(1, color[1] * k), Math.min(1, color[2] * k)];
}

// ------------------------------------------------------------------ builder
const positions = [];
const normals = [];
const colors = [];

function addTriangle(a, b, c, color) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  for (const p of [a, b, c]) {
    positions.push(p[0], p[1], p[2]);
    normals.push(nx, ny, nz);
    colors.push(color[0], color[1], color[2]);
  }
}

/** Adds a quad and flips it if the normal points at `inside` instead of away. */
function addQuad(p0, p1, p2, p3, color, inside) {
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4;
  const cy = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
  const cz = (p0[2] + p1[2] + p2[2] + p3[2]) / 4;
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const out = (cx - inside[0]) * nx + (cy - inside[1]) * ny + (cz - inside[2]) * nz;
  if (out >= 0) {
    addTriangle(p0, p1, p2, color);
    addTriangle(p0, p2, p3, color);
  } else {
    addTriangle(p0, p2, p1, color);
    addTriangle(p0, p3, p2, color);
  }
}

const TAU = Math.PI * 2;
const point = (angle, radius, y) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius];

/** A ring of quads between two radii/heights — the tower wall, plinth, cornice. */
function band(y0, y1, r0, r1, segments, color, spread = 0.09) {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * TAU;
    const a1 = ((i + 1) / segments) * TAU;
    addQuad(
      point(a0, r0, y0),
      point(a0, r1, y1),
      point(a1, r1, y1),
      point(a1, r0, y0),
      shade(color, spread),
      [0, y0, 0],
    );
  }
}

function box(cx, cy, cz, width, height, depth, color, spread = 0.07) {
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const z0 = cz - depth / 2;
  const z1 = cz + depth / 2;
  const centre = [cx, cy, cz];
  addQuad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], shade(color, spread), centre);
  addQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(color, spread), centre);
  addQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], shade(color, spread), centre);
  addQuad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], shade(color, spread), centre);
  addQuad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], shade(color, spread), centre);
  addQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(color, spread), centre);
}

/** A box rotated around Y, for merlons and buttresses sitting on a round wall. */
function radialBox(angle, radius, cy, width, height, depth, color) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const place = (dx, dz) => [cos * (radius + dz) - sin * dx, cy, sin * (radius + dz) + cos * dx];
  const w = width / 2;
  const d = depth / 2;
  const y1 = cy + height / 2;
  const y0 = cy - height / 2;
  const centre = [cos * radius, cy, sin * radius];
  const corners = [place(-w, -d), place(w, -d), place(w, d), place(-w, d)];
  addQuad(
    [corners[0][0], y1, corners[0][2]],
    [corners[1][0], y1, corners[1][2]],
    [corners[2][0], y1, corners[2][2]],
    [corners[3][0], y1, corners[3][2]],
    shade(color),
    centre,
  );
  addQuad(
    [corners[0][0], y0, corners[0][2]],
    [corners[1][0], y0, corners[1][2]],
    [corners[2][0], y0, corners[2][2]],
    [corners[3][0], y0, corners[3][2]],
    shade(color),
    centre,
  );
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    addQuad(
      [a[0], y0, a[2]],
      [b[0], y0, b[2]],
      [b[0], y1, b[2]],
      [a[0], y1, a[2]],
      shade(color),
      centre,
    );
  }
}

// ------------------------------------------------------------------- the build
const SEGMENTS = 16;

// Plinth and step: two flares before the wall starts.
band(0.0, 0.055, 0.25, 0.243, SEGMENTS, STONE_DARK);
band(0.055, 0.1, 0.243, 0.228, SEGMENTS, STONE);

// Main wall in 14 courses — more courses, more stone blocks, more silhouette.
const WALL_BOTTOM = 0.1;
const WALL_TOP = 0.7;
const COURSES = 14;
for (let i = 0; i < COURSES; i++) {
  const y0 = WALL_BOTTOM + ((WALL_TOP - WALL_BOTTOM) * i) / COURSES;
  const y1 = WALL_BOTTOM + ((WALL_TOP - WALL_BOTTOM) * (i + 1)) / COURSES;
  const r0 = 0.22 - (0.015 * i) / COURSES;
  const r1 = 0.22 - (0.015 * (i + 1)) / COURSES;
  band(y0, y1, r0, r1, SEGMENTS, i % 2 === 0 ? STONE : STONE_LIGHT, 0.1);
}

// Three string courses: thin protruding bands that break the wall up.
for (const y of [0.25, 0.4, 0.55]) {
  band(y, y + 0.018, 0.2135, 0.2135, SEGMENTS, STONE_LIGHT, 0.05);
}

// Corbel table under the parapet.
band(0.7, 0.725, 0.205, 0.245, SEGMENTS, STONE_DARK);
band(0.725, 0.755, 0.245, 0.23, SEGMENTS, STONE);

// Parapet ring, then merlons on top of it.
band(0.755, 0.8, 0.23, 0.225, SEGMENTS, STONE);
const MERLONS = 16;
for (let i = 0; i < MERLONS; i++) {
  const angle = ((i + 0.5) / MERLONS) * TAU;
  radialBox(angle, 0.212, 0.835, 0.055, 0.07, 0.05, STONE_LIGHT);
}

// Roof: two bands so it curves instead of reading as a plain cone.
band(0.78, 0.9, 0.2, 0.12, SEGMENTS, ROOF, 0.05);
band(0.9, 1.0, 0.12, 0.004, SEGMENTS, ROOF_DARK, 0.05);

// Windows: three levels, four around, recessed into the wall.
const LEVELS = [0.28, 0.44, 0.6, 0.66];
for (const y of LEVELS) {
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * TAU + 0.2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    box(cos * 0.207, y, sin * 0.207, 0.045, 0.07, 0.03, SHADOW, 0.04);
  }
}

// Arrow slits between the windows.
for (let i = 0; i < 16; i++) {
  const angle = (i / 16) * TAU + 0.55;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  box(cos * 0.209, 0.36, sin * 0.209, 0.018, 0.1, 0.022, SHADOW, 0.03);
}

// Door and lintel at the base, facing -Z.
box(0, 0.13, -0.205, 0.1, 0.17, 0.035, WOOD);
box(0, 0.225, -0.205, 0.13, 0.03, 0.045, STONE_DARK);

// Buttresses.
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * TAU + 0.5;
  radialBox(angle, 0.215, 0.3, 0.05, 0.36, 0.04, STONE_DARK);
}

// --------------------------------------------------------------- to geometry
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
geometry.computeBoundingBox();

const size = new THREE.Vector3();
geometry.boundingBox.getSize(size);
const triangles = positions.length / 9;

// Fit to the contract: height exactly 1, width exactly 0.5 (2 : 1), base at y = 0.
const scaleY = 1 / size.y;
const scaleXZ = 0.5 / Math.max(size.x, size.z);
geometry.translate(0, -geometry.boundingBox.min.y, 0);
geometry.scale(scaleXZ, scaleY, scaleXZ);
geometry.computeBoundingBox();
geometry.computeBoundingSphere();

const mesh = new THREE.Mesh(
  geometry,
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 }),
);
mesh.name = 'castle-b';
const scene = new THREE.Scene();
scene.add(mesh);

// Node has no FileReader; the exporter uses one to pack the BIN chunk.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};

const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
writeFileSync(OUT, Buffer.from(glb));

const bounds = geometry.boundingBox;
console.log(`wrote ${OUT}`);
console.log(`  triangles ${triangles}`);
console.log(
  `  size      ${(bounds.max.x - bounds.min.x).toFixed(3)} x ${(bounds.max.y - bounds.min.y).toFixed(3)} x ${(bounds.max.z - bounds.min.z).toFixed(3)}`,
);
console.log(
  `  aspect    ${((bounds.max.y - bounds.min.y) / (bounds.max.x - bounds.min.x)).toFixed(2)} : 1`,
);
console.log(`  bytes     ${Buffer.from(glb).byteLength}`);

if (triangles < TRIANGLE_BUDGET.min || triangles > TRIANGLE_BUDGET.max) {
  console.error(
    `\nOUT OF BUDGET: ${triangles} triangles, want ${TRIANGLE_BUDGET.min}-${TRIANGLE_BUDGET.max}`,
  );
  process.exit(1);
}
