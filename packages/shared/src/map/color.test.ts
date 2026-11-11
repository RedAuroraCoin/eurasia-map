import { describe, expect, it } from 'vitest';
import { cellColor, getMap, landColor, seaColor } from './index';

const distance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('elevation colour ramp', () => {
  it('separates the elevations that actually occur', () => {
    const plain = landColor(150);
    const hill = landColor(900);
    const mountain = landColor(3000);
    expect(distance(plain, hill)).toBeGreaterThan(25);
    expect(distance(hill, mountain)).toBeGreaterThan(25);
  });

  it('does not repeat colours across the range', () => {
    const seen = new Set<string>();
    for (let elevation = 0; elevation <= 5200; elevation += 100) {
      seen.add(landColor(elevation).join(','));
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it('gets darker with sea depth', () => {
    expect(distance(seaColor(-200), seaColor(-5000))).toBeGreaterThan(30);
  });

  it('clamps outside the range instead of wrapping', () => {
    expect(landColor(-500)).toEqual(landColor(0));
    expect(landColor(9000)).toEqual(landColor(5200));
  });

  it('picks land or sea by the mask', () => {
    const map = getMap(300);
    let land = -1;
    let sea = -1;
    for (let i = 0; i < map.mask.length; i++) {
      if (map.mask[i] === '#' && land < 0) land = i;
      if (map.mask[i] === '.' && sea < 0) sea = i;
      if (land >= 0 && sea >= 0) break;
    }
    expect(cellColor(map, land)).toEqual(landColor(map.elev[land] ?? 0));
    expect(cellColor(map, sea)).toEqual(seaColor(map.elev[sea] ?? 0));
  });
});
