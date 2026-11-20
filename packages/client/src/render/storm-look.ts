import * as THREE from 'three';
import type { StormPlan } from '@eurasia/shared';

/**
 * The hurricane's look: a flattened cloud dome, a tapering funnel with a spiral
 * of rings, and debris at the base. All primitives, no textures, three draw
 * calls per storm — and at most two storms, so the budget is not a question.
 *
 * The animation is a pure function of the plan and the clock: position from the
 * plan's path, spin from time, a grow/shrink envelope at the ends. Nothing here
 * decides anything; the damage was resolved by the engine.
 */

const SEGMENTS = 18;

interface Palette {
  readonly cloud: number;
  readonly funnel: number;
  readonly debris: number;
}

const DAY: Palette = { cloud: 0xaab3c2, funnel: 0x8b95a6, debris: 0x6b6257 };
const NIGHT: Palette = { cloud: 0x3d4655, funnel: 0x2f3745, debris: 0x24211d };

export interface StormLook {
  readonly group: THREE.Group;
  /** Position comes from Scene3D (it knows the terrain); this only animates. */
  update(plan: StormPlan, now: number): void;
  setNight(night: number): void;
  dispose(): void;
}

export function createStormLook(radius: number): StormLook {
  const height = radius * 2.6;
  const group = new THREE.Group();

  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: DAY.cloud,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const funnelMaterial = new THREE.MeshStandardMaterial({
    color: DAY.funnel,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.94,
  });
  const debrisMaterial = new THREE.PointsMaterial({
    color: DAY.debris,
    size: radius * 0.16,
    sizeAttenuation: true,
  });

  // Dome: an icosahedron squashed flat, slightly wider than the funnel.
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 2), cloudMaterial);
  dome.scale.set(1.05, 0.5, 1.05);
  dome.position.y = height * 0.82;
  group.add(dome);

  // A second, smaller dome inside gives the top some depth.
  const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 0.62, 1), cloudMaterial);
  cap.scale.set(1, 0.62, 1);
  cap.position.y = height * 1.02;
  group.add(cap);

  // Funnel: wide at the cloud, narrow at the ground.
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.62, radius * 0.1, height * 0.92, SEGMENTS, 4, true),
    funnelMaterial,
  );
  funnel.position.y = height * 0.46;
  group.add(funnel);

  // Spiral: rings of decreasing radius, spun at different speeds.
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * (0.58 - i * 0.15), radius * 0.035, 3, 16),
      funnelMaterial,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = height * (0.72 - i * 0.16);
    group.add(ring);
    rings.push(ring);
  }

  // Debris: a small ring of points kicking up around the base.
  const debrisCount = 90;
  const debrisGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(debrisCount * 3);
  for (let i = 0; i < debrisCount; i++) {
    const angle = (i / debrisCount) * Math.PI * 2;
    const spread = radius * (0.12 + (i % 7) / 12);
    positions[i * 3] = Math.cos(angle) * spread;
    positions[i * 3 + 1] = (i % 5) * 0.05;
    positions[i * 3 + 2] = Math.sin(angle) * spread;
  }
  debrisGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const debris = new THREE.Points(debrisGeometry, debrisMaterial);
  group.add(debris);

  let night = 0;

  return {
    group,

    update(plan: StormPlan, now: number): void {
      const span = Math.max(1, plan.endsAt - plan.startAt);
      const life = Math.min(1, Math.max(0, (now - plan.startAt) / span));

      // Grow over the first tenth, shrink over the last sixth: the storm arrives
      // and leaves instead of popping in and out.
      const grow = Math.min(1, life / 0.1) * Math.min(1, (1 - life) / 0.16);
      group.scale.setScalar(0.35 + 0.65 * Math.max(0, grow));

      const spin = now * 0.0016;
      funnel.rotation.y = spin * 1.4;
      dome.rotation.y = spin * 0.35;
      cap.rotation.y = -spin * 0.5;
      rings.forEach((ring, index) => {
        ring.rotation.z = spin * (1.2 + index * 0.7) * (index % 2 === 0 ? 1 : -1);
        ring.position.y = height * (0.72 - index * 0.16) + Math.sin(spin * 2 + index) * 0.06;
      });
      debris.rotation.y = -spin * 2.2;

      // A hurricane leans as it travels, so the funnel does not look pasted on.
      funnel.rotation.z = Math.sin(spin * 0.8) * 0.06;
      dome.position.x = Math.sin(spin * 0.5) * radius * 0.08;

      void night;
    },

    setNight(value: number): void {
      const k = Math.min(1, Math.max(0, value));
      const mix = (a: number, b: number): number => a + (b - a) * k;
      const tone = (day: number, dark: number): number => {
        const c = new THREE.Color(day);
        const d = new THREE.Color(dark);
        return new THREE.Color(mix(c.r, d.r), mix(c.g, d.g), mix(c.b, d.b)).getHex();
      };
      cloudMaterial.color.setHex(tone(DAY.cloud, NIGHT.cloud));
      funnelMaterial.color.setHex(tone(DAY.funnel, NIGHT.funnel));
      debrisMaterial.color.setHex(tone(DAY.debris, NIGHT.debris));
      night = k;
    },

    dispose(): void {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      cloudMaterial.dispose();
      funnelMaterial.dispose();
      debrisMaterial.dispose();
    },
  };
}
