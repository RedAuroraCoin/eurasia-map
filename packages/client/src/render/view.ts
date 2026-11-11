import type { MapEntry } from '@eurasia/shared';
import { Flat2D } from './flat2d';
import { Scene3D, type Quality, type View } from './scene3d';

export type { Quality, View };

export interface ViewResult {
  readonly view: View;
  readonly mode: '3d' | '2d';
}

/**
 * Probing before constructing the renderer costs one throwaway canvas and saves
 * a scary "Error creating WebGL context" in the console of every device that
 * cannot draw it — the fallback is an expected path here, not a failure.
 */
function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
    return context !== null;
  } catch {
    return false;
  }
}

export function createView(
  canvas: HTMLCanvasElement,
  map: MapEntry,
  relief: boolean,
  quality: Quality,
): ViewResult {
  if (!hasWebGL()) return { view: new Flat2D(canvas, map, relief), mode: '2d' };

  try {
    return { view: new Scene3D(canvas, map, relief, quality), mode: '3d' };
  } catch {
    return { view: new Flat2D(canvas, map, relief), mode: '2d' };
  }
}
