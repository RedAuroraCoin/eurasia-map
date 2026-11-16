import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { loadBuildingModel, mergeObject, normalizeToUnitBox } from './model';

/**
 * Node has no FileReader; GLTFExporter uses one to pack the binary chunk. This
 * is test scaffolding for the *exporter* only — the game never exports.
 */
class BlobReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = BlobReader;

/** Two boxes, one of them red, the other without a colour of its own. */
function sampleScene(): THREE.Object3D {
  const root = new THREE.Group();

  const keep = new THREE.Mesh(
    new THREE.BoxGeometry(4, 6, 4),
    new THREE.MeshStandardMaterial({ color: 0x8c3f2b }),
  );
  keep.position.set(0, 3, 0);

  const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), new THREE.MeshStandardMaterial());
  tower.position.set(3, 5, 0);

  const uvOnly = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  uvOnly.position.set(-3, 4, 0);

  root.add(keep, tower, uvOnly);
  return root;
}

describe('custom model pipeline', () => {
  it('merges a scene into one geometry with per-mesh colours', () => {
    const merged = mergeObject(sampleScene());
    expect(merged).not.toBeNull();
    const color = merged!.getAttribute('color');
    const position = merged!.getAttribute('position');
    expect(color.count).toBe(position.count);

    const distinct = new Set<string>();
    for (let i = 0; i < color.count; i += 3) distinct.add(color.getX(i).toFixed(3));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('drops uv and keeps only what the instanced material reads', () => {
    const merged = mergeObject(sampleScene())!;
    expect(merged.getAttribute('uv')).toBeUndefined();
    expect(merged.getAttribute('position')).toBeDefined();
    expect(merged.getAttribute('normal')).toBeDefined();
  });

  it('fits any export into the unit box, base on the ground', () => {
    const geometry = new THREE.BoxGeometry(14, 10, 14);
    geometry.translate(37, 55, -12);
    normalizeToUnitBox(geometry);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;

    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y - box.min.y).toBeLessThanOrEqual(1.0001);
    expect(box.max.x).toBeLessThanOrEqual(0.5001);
    expect(box.max.z).toBeLessThanOrEqual(0.5001);
    expect((box.max.x + box.min.x) / 2).toBeCloseTo(0, 5);
  });

  it('keeps a wide model inside the cell instead of letting it bulge', () => {
    const geometry = new THREE.BoxGeometry(40, 5, 10);
    normalizeToUnitBox(geometry);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.x).toBeLessThanOrEqual(0.5001);
    expect(box.max.y).toBeLessThanOrEqual(1.0001);
  });

  it('loads a GLB over fetch and fits it, exactly as the scene does', async () => {
    const glb = (await new GLTFExporter().parseAsync(sampleScene(), {
      binary: true,
    })) as ArrayBuffer;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(glb, { status: 200 })) as typeof fetch;
    try {
      const geometry = await loadBuildingModel('models/castle.glb');
      expect(geometry).not.toBeNull();
      geometry!.computeBoundingBox();
      const box = geometry!.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 4);
      expect(box.max.y).toBeGreaterThan(0.2);
      expect(box.max.y).toBeLessThanOrEqual(1.0001);
      expect(geometry!.getAttribute('color')).toBeDefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('returns null instead of throwing when there is no model', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
    try {
      await expect(loadBuildingModel('models/castle.glb')).resolves.toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('survives a real GLB round trip', async () => {
    const scene = sampleScene();
    const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
    expect(glb.byteLength).toBeGreaterThan(100);

    const gltf = await new GLTFLoader().parseAsync(glb, '');
    const merged = mergeObject(gltf.scene);
    expect(merged).not.toBeNull();
    normalizeToUnitBox(merged!);
    merged!.computeBoundingBox();
    const box = merged!.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 4);
    expect(box.max.y).toBeGreaterThan(0.2);
    expect(box.max.y).toBeLessThanOrEqual(1.0001);
  });
});
