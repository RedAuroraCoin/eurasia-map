import { parse } from '@shaderfrog/glsl-parser';
import { describe, expect, it } from 'vitest';
import { WATER_FRAGMENT, WATER_VERTEX } from './water-shaders';

/**
 * Shader source cannot be compiled without a GPU, but it can be parsed — and a
 * typo in a shader is a black screen, which is the one failure mode a unit test
 * can still catch from here.
 */

interface Declarations {
  readonly uniforms: Map<string, string>;
  readonly varyings: Map<string, string>;
  readonly attributes: Map<string, string>;
}

function declarations(source: string): Declarations {
  const collect = (kind: string): Map<string, string> => {
    const found = new Map<string, string>();
    const pattern = new RegExp(`\\b${kind}\\s+(\\w+)\\s+(\\w+)\\s*;`, 'g');
    for (const match of source.matchAll(pattern)) {
      const [, type, name] = match;
      if (type && name) found.set(name, type);
    }
    return found;
  };
  return {
    uniforms: collect('uniform'),
    varyings: collect('varying'),
    attributes: collect('attribute'),
  };
}

/** Everything buildWater() actually puts in the uniforms object. */
const PROVIDED_UNIFORMS = new Set([
  'uTime',
  'uAmplitude',
  'uDepth',
  'uSize',
  'uShallow',
  'uDeep',
  'uSun',
  'uFog',
  'uFoam',
  'uFogNear',
  'uFogFar',
]);

/** Injected by three.js for every ShaderMaterial. */
const BUILTIN = new Set(['cameraPosition']);

describe('water shaders', () => {
  it('parse as GLSL', () => {
    expect(() => parse(WATER_VERTEX)).not.toThrow();
    expect(() => parse(WATER_FRAGMENT)).not.toThrow();
  });

  it('declares the same varyings on both sides', () => {
    const vertex = declarations(WATER_VERTEX).varyings;
    const fragment = declarations(WATER_FRAGMENT).varyings;

    expect([...vertex.keys()].sort()).toEqual([...fragment.keys()].sort());
    for (const [name, type] of vertex) {
      expect(fragment.get(name)).toBe(type);
    }
  });

  it('only uses uniforms the scene provides', () => {
    for (const source of [WATER_VERTEX, WATER_FRAGMENT]) {
      for (const name of declarations(source).uniforms.keys()) {
        expect(PROVIDED_UNIFORMS.has(name) || BUILTIN.has(name)).toBe(true);
      }
    }
  });

  it('writes to gl_FragColor and reads the position attribute', () => {
    expect(WATER_FRAGMENT).toContain('gl_FragColor');
    expect(WATER_VERTEX).toMatch(/\bposition\b/);
  });

  it('has balanced braces', () => {
    for (const source of [WATER_VERTEX, WATER_FRAGMENT]) {
      const open = (source.match(/\{/g) ?? []).length;
      const close = (source.match(/\}/g) ?? []).length;
      expect(open).toBe(close);
    }
  });
});
