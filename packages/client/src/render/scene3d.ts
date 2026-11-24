import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { stormPointAt, type GameState, type MapEntry, type StormPlan } from '@eurasia/shared';
import { createCastleGeometry, towerFromCastle } from './castle';
import { createKingGeometry } from './king';
import { createStormLook, type StormLook } from './storm-look';
import { loadSideModels } from './model';
import { createRocketGeometry } from './rocket';
import { FIRE_PARTS, HALO_OUTER, firePartY } from './fire';
import { blastFrame } from './blast';
import { createNoiseTexture } from './noise';
import {
  buildBuildings,
  buildingTint,
  MODEL_TINT_STRENGTH,
  ownerTint,
  buildTerrain,
  depthTextureData,
  sideFor,
  unitColor,
} from './geometry';
import { unitColour, unitGeometry, type UnitInstance } from './pieces';
import { ZONE_COLOURS, hintGeometry, hintMaterial, type MoveHint } from './hints';
import {
  boardSize,
  CELL,
  cellToWorld,
  elevationToHeight,
  fitDistance,
  fitTarget,
  VIEW_DIRECTION,
  worldToCell,
} from './grid';
import type { Lighting } from './palette';
import { WATER_FRAGMENT, WATER_VERTEX } from './water-shaders';

/**
 * The three.js layer. Everything interesting — where the cells are, how tall
 * they are, what colour they take — is computed in geometry.ts and arrives here
 * as numbers; this file is scene assembly and per-frame bookkeeping only.
 */

export type Quality = 'high' | 'low';

export interface View {
  setMap(map: MapEntry): void;
  setState(state: GameState, now: number): void;
  setLighting(lighting: Lighting): void;
  setRelief(relief: boolean): void;
  setQuality(quality: Quality): void;
  setSelected(index: number): void;
  setHovered(index: number): void;
  setReducedMotion(reduced: boolean): void;
  /** Render the claimed cells as two sides, alternating. A display switch. */
  setSidePreview(preview: boolean): void;
  /** The storms currently alive. The engine has already decided their damage. */
  setStorms(plans: readonly StormPlan[]): void;
  /** Chess mode: pieces and fortifications, in place of claimed cells. */
  setUnits(units: readonly UnitInstance[]): void;
  /** Chess mode: where the selected piece may go. Empty clears them. */
  setHints(hints: readonly MoveHint[]): void;
  /** The 3x3 blast area under the pointer while a rocket is being aimed. */
  setZone(cells: readonly ZoneCell[] | null): void;
  /** One explosion over a fired zone: flash, shockwave and fireball, then gone. */
  playBlast(cells: readonly ZoneCell[]): void;
  /** Glide the camera onto a cell — used to show the side whose turn it is. */
  focusCell(cell: number): void;
  /** Burning tips on the given rocket bases: the side that is about to fire. */
  setRocketGlow(cells: readonly number[] | null): void;
  /** Bloom on explosions and fire. Off renders straight to the canvas. */
  setGlow(enabled: boolean): void;
  pick(clientX: number, clientY: number): number;
  resize(): void;
  /**
   * `worldNow` is simulated time (growth, storms, the sea); `frameNow` is real
   * frame time. They are not the same thing: in chess the world clock can stand
   * still, and anything animated on it — the explosion above all — would freeze.
   */
  render(worldNow: number, frameNow: number): void;
  dispose(): void;
}

const FOV = 36;
/**
 * A garrisoned piece stands in the tower's cell, and the tower now overtops it.
 * Nudging the piece towards the viewer keeps it visible without moving the cell
 * it actually occupies.
 */
const GARRISON_OFFSET = 0.22;
/** The rocket base stands well clear of the towers: it is the tallest thing here. */
const ROCKET_WIDTH = 0.95;
const ROCKET_HEIGHT = 3.2;

/** A cell of the blast preview. `chance` is what a piece there would face. */
export interface ZoneCell {
  readonly cell: number;
  readonly chance: number;
}
/**
 * Bloom. Everything that is meant to be *light* — the explosion, the fire under an
 * armed rocket, the selected-cell pulse — is drawn additively, so it pushes past
 * white and only a bloom pass turns that into glare. The threshold is high on
 * purpose: the sea and the snow line are bright, and a low one would smear the whole
 * map into a haze.
 */
const BLOOM_STRENGTH = 0.85;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 0.82;

/** How long the camera takes to glide to the side whose turn it is. */
const FOCUS_MS = 750;
/**
 * How long an explosion lives, in milliseconds. The first attempt was 900 ms and
 * players on a phone did not see it at all — a small screen and a thumb still on
 * the glass eat a second. Long enough to read, short enough not to block the turn.
 */
export /** The sea plane is larger than the board so the horizon is water, not a cut edge. */
const SEA_SCALE = 3.5;

/** A three-quarter view from the south-east, at exactly `distance` from the target. */
function cameraPositionFor(
  distance: number,
  target: readonly [number, number, number],
): THREE.Vector3 {
  // Same direction the fit solved for — a different one would crop the corners.
  return new THREE.Vector3(...target).add(
    new THREE.Vector3(...VIEW_DIRECTION).normalize().multiplyScalar(distance),
  );
}

/** One byte per cell: 0 at the shore, 255 in the abyss. Sampled by the water shader. */
function createDepthTexture(map: MapEntry): THREE.DataTexture {
  const texture = new THREE.DataTexture(depthTextureData(map), map.cols, map.rows, THREE.RedFormat);
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class Scene3D implements View {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  private map: MapEntry;
  private state: GameState | null = null;
  private relief: boolean;
  private quality: Quality;
  private reducedMotion = false;

  private terrain: THREE.InstancedMesh | null = null;
  /** One mesh per side: two silhouettes cannot share an instanced geometry. */
  private buildings: [THREE.InstancedMesh, THREE.InstancedMesh] | null = null;
  /** One chess king per side; only two ever exist, so no instancing. */
  private kingMeshes: [THREE.Mesh | null, THREE.Mesh | null] = [null, null];
  private storms = new Map<number, StormLook>();
  private night = 0;
  private stormPlans: readonly StormPlan[] = [];
  private water: THREE.Mesh | null = null;
  private seaLevel = 0;
  private unitMeshes: THREE.InstancedMesh[] = [];
  private hintMeshes: THREE.Mesh[] = [];
  private zoneMeshes: THREE.Mesh[] = [];
  private zoneGeometry: THREE.PlaneGeometry | null = null;
  /** Seamless sea noise, built once and shared by every water material. */
  private readonly noiseTexture = createNoiseTexture();
  /** Post-processing chain: only used while glow is on. */
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private glowOn = true;
  /** The fire under the bases that are about to shoot; one group, many cones. */
  private rocketGlow: THREE.Group | null = null;
  private focus: {
    readonly fromTarget: THREE.Vector3;
    readonly toTarget: THREE.Vector3;
    readonly fromCamera: THREE.Vector3;
    readonly toCamera: THREE.Vector3;
    start: number;
  } | null = null;
  private blast: {
    readonly group: THREE.Group;
    readonly ring: THREE.Mesh;
    readonly fireball: THREE.Mesh;
    readonly scorch: THREE.Mesh;
    start: number;
  } | null = null;
  private glow: THREE.Points | null = null;
  private selection: THREE.LineSegments | null = null;
  private hoverRing: THREE.LineSegments | null = null;

  private terrainCells: number[] = [];
  private buildingCells: [number[], number[]] = [[], []];
  private depthTexture: THREE.DataTexture;

  /** GLBs in public/models replace the procedural castles, per side. */
  private models: [THREE.BufferGeometry | null, THREE.BufferGeometry | null] = [null, null];
  private modelRequested = false;
  /** The chess towers: the same castle models, shrunk to a cell. Cached per side. */
  private towerGeometries: [THREE.BufferGeometry | null, THREE.BufferGeometry | null] = [
    null,
    null,
  ];
  private lastUnits: readonly UnitInstance[] = [];
  /** The rocket base is built in code, one geometry per side, cached. */
  private rocketGeometries: [THREE.BufferGeometry | null, THREE.BufferGeometry | null] = [
    null,
    null,
  ];

  /** Review switch: alternate owners so both castle designs are visible. */
  private sidePreview = false;

  /**
   * Asked once per view. If the file is not there the request 404s and the
   * procedural castle stays — no error, no download, no loader in the bundle.
   */
  private loadCustomModelOnce(): void {
    if (this.modelRequested) return;
    this.modelRequested = true;
    void loadSideModels().then((models) => {
      if (!models[0] && !models[1]) return;
      this.models = models;
      // The chess towers are the same castles, so they change with the file too.
      for (const side of [0, 1] as const) {
        this.towerGeometries[side]?.dispose();
        this.towerGeometries[side] = null;
      }
      if (this.lastUnits.some((unit) => unit.role === 'tower')) this.setUnits(this.lastUnits);

      if (!this.buildings) return;
      for (const side of [0, 1] as const) {
        const geometry = models[side];
        if (!geometry) continue;
        const mesh = this.buildings[side];
        const previous = mesh.geometry;
        mesh.geometry = geometry;
        if (previous !== geometry) previous.dispose();
      }
    });
  }

  private fogNear = 60;
  private fogFar = 200;
  private userMoved = false;
  private waterTime = 0;
  private lastBuildingUpdate = 0;
  private selected = -1;
  private hovered = -1;

  constructor(
    canvas: HTMLCanvasElement,
    map: MapEntry,
    relief: boolean,
    quality: Quality,
    sidePreview = false,
  ) {
    this.map = map;
    this.relief = relief;
    this.quality = quality;
    this.sidePreview = sidePreview;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality === 'high',
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // No tone mapping on purpose: the palette is authored as final display
    // colours, and a filmic curve would desaturate the elevation ramp.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = quality === 'high';
    // PCFSoftShadowMap was removed in r187; plain PCF is what is left.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
    this.camera.position.copy(cameraPositionFor(fitDistance(map, FOV, 1), fitTarget(map)));

    this.controls = new OrbitControls(this.camera, canvas);
    // The moment the player grabs the view, an automatic glide stops: their hands
    // always win over the camera's own idea of where to look.
    this.controls.addEventListener('start', () => {
      this.focus = null;
    });
    const home = fitTarget(map);
    this.controls.target.set(home[0], home[1], home[2]);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // Close enough to read a single cell, far enough that the near plane cannot
    // slice into a mountain and show the sky through it.
    this.controls.minDistance = 12;
    this.controls.maxDistance = 160;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = 1.22;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.zoomSpeed = 0.85;
    this.controls.rotateSpeed = 0.65;
    this.controls.addEventListener('start', () => {
      this.userMoved = true;
    });
    this.controls.update();

    this.buildComposer();

    this.hemi = new THREE.HemisphereLight(0xbfd4e6, 0x2a2b25, 0.8);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = quality === 'high';
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const { width, depth } = boardSize(map);
    const diagonal = Math.hypot(width, depth);
    this.fogNear = diagonal * 1.5;
    this.fogFar = diagonal * 4;
    const span = Math.max(width, depth) * 0.78;
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -span;
    shadowCamera.right = span;
    shadowCamera.top = span;
    shadowCamera.bottom = -span;
    shadowCamera.near = 1;
    shadowCamera.far = 260;
    shadowCamera.updateProjectionMatrix();

    this.depthTexture = createDepthTexture(map);
    this.buildWater();
    this.rebuildTerrain();
    this.rebuildSelection();
  }

  // ------------------------------------------------------------------ scene

  private buildWater(): void {
    const { width, depth } = boardSize(this.map);
    // Geometry is the wide sea; UVs still map the board, so far outside the
    // board the depth texture clamps to its edge — open ocean, no seam.
    const geometry = new THREE.PlaneGeometry(
      width * SEA_SCALE,
      depth * SEA_SCALE,
      64 * (this.quality === 'high' ? 1 : 0.5),
      64 * (this.quality === 'high' ? 1 : 0.5),
    );
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: 1 },
        uDepth: { value: this.depthTexture },
        uSize: { value: new THREE.Vector2(width, depth) },
        // The water shader writes straight to the framebuffer, so these are
        // display-referred values, not linear ones — no colour-space conversion.
        uShallow: { value: new THREE.Color().setRGB(0.247, 0.584, 0.722, THREE.NoColorSpace) },
        uDeep: { value: new THREE.Color().setRGB(0.047, 0.153, 0.251, THREE.NoColorSpace) },
        uSun: { value: new THREE.Vector3(0.5, 0.8, 0.4) },
        uFog: { value: new THREE.Color('#8fb4c9') },
        uFoam: { value: 1 },
        uNoise: { value: this.noiseTexture },
        // The composer's target is linear, the canvas is not; the shader encodes
        // accordingly so the sea keeps its colour either way.
        uLinear: { value: 1 },
        uFogNear: { value: this.fogNear },
        uFogFar: { value: this.fogFar },
        uRadius: { value: Math.hypot(width, depth) / 2 },
      },
    });

    this.water = new THREE.Mesh(geometry, material);
    this.water.position.y = this.seaSurface();
    this.water.receiveShadow = false;
    this.scene.add(this.water);
  }

  /** Puts the sea plane on the contour of the current level. */
  private placeWater(): void {
    if (this.water) this.water.position.y = this.seaSurface();
  }

  private rebuildTerrain(): void {
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.geometry.dispose();
      (this.terrain.material as THREE.Material).dispose();
      this.terrain = null;
    }
    for (const side of [0, 1] as const) {
      const king = this.kingMeshes[side];
      if (!king) continue;
      this.scene.remove(king);
      (king.material as THREE.Material).dispose();
      this.kingMeshes[side] = null;
    }
    if (this.buildings) {
      for (const side of [0, 1] as const) {
        const mesh = this.buildings[side];
        this.scene.remove(mesh);
        // A custom model outlives its mesh: it is reused on every rebuild.
        if (mesh.geometry !== this.models[side]) mesh.geometry.dispose();
        if (side === 0) (mesh.material as THREE.Material).dispose();
      }
      this.buildings = null;
    }
    if (this.glow) {
      this.scene.remove(this.glow);
      this.glow.geometry.dispose();
      (this.glow.material as THREE.Material).dispose();
      this.glow = null;
    }

    this.placeWater();
    const cells = buildTerrain(this.map, this.relief, this.state?.cells ?? {}, this.seaLevel);
    this.terrainCells = cells.map((cell) => cell.index);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });

    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, cells.length));
    mesh.castShadow = this.quality === 'high';
    mesh.receiveShadow = this.quality === 'high';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    cells.forEach((cell, i) => {
      // Exactly one cell: a cosmetic inset leaves a seam between neighbours, and
      // whatever lies under the seam becomes visible the moment the camera nears.
      matrix.makeScale(1, cell.height, 1);
      matrix.setPosition(cell.x, 0, cell.z);
      mesh.setMatrixAt(i, matrix);
      color.setRGB(...unitColor(cell.color), THREE.SRGBColorSpace);
      mesh.setColorAt(i, color);
    });
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();

    this.terrain = mesh;
    this.scene.add(mesh);

    // Buildings are rebuilt whenever the map or the state changes shape; their
    // height is then refreshed from the state at 10 Hz.
    // Two castles, one per side, each instanced: two draw calls for every
    // building on the map, with part colours baked into vertex colours.
    this.loadCustomModelOnce();
    const buildingMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.05,
      vertexColors: true,
      color: 0xffffff,
    });
    const capacity = Math.max(1, this.map.land);
    const keepMesh = new THREE.InstancedMesh(
      this.models[0] ?? createCastleGeometry('keep'),
      buildingMaterial,
      capacity,
    );
    const bastionMesh = new THREE.InstancedMesh(
      this.models[1] ?? createCastleGeometry('bastion'),
      buildingMaterial,
      capacity,
    );
    for (const mesh of [keepMesh, bastionMesh]) {
      mesh.castShadow = this.quality === 'high';
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.scene.add(mesh);
    }
    this.buildings = [keepMesh, bastionMesh];

    // Kings: one geometry, two materials, because the colour is the side.
    const kingGeometry = createKingGeometry();
    for (const side of [0, 1] as const) {
      const tint = unitColor(ownerTint(side));
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace),
        roughness: 0.45,
        metalness: 0.25,
      });
      const king = new THREE.Mesh(kingGeometry, material);
      // Nearly double the old 0.26 × 0.44: at map scale the piece was reading as
      // a finial on the roof, not as the figure that does the building. The
      // footprint stays inside the 0.66-wide castle, so it never overhangs.
      king.scale.set(0.46, 0.8, 0.46);
      king.castShadow = this.quality === 'high';
      king.visible = false;
      this.scene.add(king);
      this.kingMeshes[side] = king;
    }

    this.rebuildGlow();
    this.rebuildSelection();
    this.updateBuildings(this.state, performance.now(), true);
  }

  private rebuildGlow(): void {
    if (this.glow) {
      this.scene.remove(this.glow);
      this.glow.geometry.dispose();
      (this.glow.material as THREE.Material).dispose();
    }
    const capacity = Math.max(1, this.map.land);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    const material = new THREE.PointsMaterial({
      color: 0xffd9a0,
      size: 0.42,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.glow = points;
    this.scene.add(points);
  }

  private rebuildSelection(): void {
    const make = (color: number, opacity: number): THREE.LineSegments => {
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, 0.5, 0);
      const edges = new THREE.EdgesGeometry(box);
      box.dispose();
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      );
      line.visible = false;
      this.scene.add(line);
      return line;
    };
    if (!this.selection) this.selection = make(0xffffff, 0.95);
    if (!this.hoverRing) this.hoverRing = make(0xffffff, 0.35);
  }

  // ------------------------------------------------------------------ state

  setMap(map: MapEntry): void {
    if (map.size === this.map.size) {
      this.map = map;
      return;
    }
    this.map = map;
    this.selected = -1;
    this.hovered = -1;
    const { width, depth } = boardSize(map);
    const diagonal = Math.hypot(width, depth);
    this.fogNear = diagonal * 1.5;
    this.fogFar = diagonal * 4;

    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      (this.water.material as THREE.Material).dispose();
      this.water = null;
    }
    this.depthTexture.dispose();
    this.depthTexture = createDepthTexture(map);

    this.buildWater();
    this.rebuildTerrain();
    this.resetCamera();
  }

  setStorms(plans: readonly StormPlan[]): void {
    this.stormPlans = plans;
    const alive = new Set(plans.map((plan) => plan.id));

    for (const [id, look] of this.storms) {
      if (alive.has(id)) continue;
      this.scene.remove(look.group);
      look.dispose();
      this.storms.delete(id);
    }

    for (const plan of plans) {
      if (this.storms.has(plan.id)) continue;
      const look = createStormLook(plan.radius);
      look.setNight(this.night);
      this.scene.add(look.group);
      this.storms.set(plan.id, look);
    }
  }

  /**
   * Rebuilds the chess pieces. There are at most thirty-two plus towers, and the
   * state changes once per move, so a full rebuild is cheaper than bookkeeping.
   */
  /**
   * A chess tower is a castle model scaled to sit inside a cell. Copied rather
   * than scaled in place: the building game draws the same geometry at full size.
   */
  private towerGeometry(side: 0 | 1): THREE.BufferGeometry | null {
    const model = this.models[side];
    if (!model) return null;
    const cached = this.towerGeometries[side];
    if (cached) return cached;
    const copy = towerFromCastle(model);
    this.towerGeometries[side] = copy;
    return copy;
  }

  /**
   * Lights the tips of the given rocket bases: a flame above each one and a halo on
   * the ground, pulsing. It marks the side that is about to fire, so a player sees
   * which of their bases the shot will come from.
   */
  setRocketGlow(cells: readonly number[] | null): void {
    this.clearRocketGlow();
    if (!cells || cells.length === 0) return;

    const group = new THREE.Group();
    group.renderOrder = 8;

    for (const cell of cells) {
      const { x, z } = cellToWorld(this.map, cell);
      const ground = elevationToHeight(this.map.elev[cell] ?? 0, this.relief);

      for (const part of FIRE_PARTS) {
        const geometry =
          part.kind === 'halo'
            ? new THREE.RingGeometry(CELL * part.radius, CELL * HALO_OUTER, 28).rotateX(
                -Math.PI / 2,
              )
            : new THREE.ConeGeometry(CELL * part.radius, CELL * part.height, 12, 1, true);

        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(part.colour),
            transparent: true,
            opacity: part.opacity,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
        );

        const dx = Math.cos(part.angle) * CELL * part.distance;
        const dz = Math.sin(part.angle) * CELL * part.distance;
        mesh.position.set(x + dx, ground + CELL * firePartY(part), z + dz);
        mesh.userData.baseOpacity = part.opacity;
        mesh.userData.phase = cell * 0.7 + part.angle * 2.4;
        mesh.userData.baseY = mesh.position.y;
        mesh.userData.isHalo = part.kind === 'halo';
        group.add(mesh);
      }
    }

    this.scene.add(group);
    this.rocketGlow = group;
  }

  /**
   * Flicker. Each cone breathes on its own phase — a row of flames pulsing in
   * lockstep reads as a blink — and the halo swells against them, so the base looks
   * like it is burning rather than blinking.
   */
  private updateRocketGlow(now: number): void {
    const glow = this.rocketGlow;
    if (!glow) return;

    for (const child of glow.children) {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      const phase = (mesh.userData.phase as number) ?? 0;
      const base = (mesh.userData.baseOpacity as number) ?? 0.8;

      if (mesh.userData.isHalo as boolean) {
        const swell = 0.5 + 0.5 * Math.abs(Math.sin(now / 260 + phase));
        mesh.scale.setScalar(0.92 + 0.16 * swell);
        material.opacity = base * (0.55 + 0.45 * swell);
        continue;
      }

      // Taller and brighter together, quicker than the halo: real fire is nervous.
      const flicker = 0.5 + 0.5 * Math.sin(now / 110 + phase * 3.1);
      mesh.scale.set(1 + 0.12 * flicker, 0.86 + 0.34 * flicker, 1 + 0.12 * flicker);
      material.opacity = base * (0.62 + 0.38 * flicker);
      // Grow from the ground, never from the middle: the base stays planted.
      mesh.position.y = (mesh.userData.baseY as number) * (0.94 + 0.12 * flicker);
    }
  }

  private clearRocketGlow(): void {
    const glow = this.rocketGlow;
    if (!glow) return;
    this.scene.remove(glow);
    for (const child of glow.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.rocketGlow = null;
  }

  /**
   * Glides the view onto a cell without changing where the camera looks from: the
   * offset direction is kept, so the board does not spin, and the height is clamped
   * like any other camera move.
   */
  focusCell(cell: number): void {
    if (!this.map || cell < 0 || cell >= this.map.rows * this.map.cols) return;

    const { x, z } = cellToWorld(this.map, cell);
    const ground = elevationToHeight(this.map.elev[cell] ?? 0, this.relief);
    const toTarget = new THREE.Vector3(x, ground, z);
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);

    this.focus = {
      fromTarget: this.controls.target.clone(),
      toTarget,
      fromCamera: this.camera.position.clone(),
      toCamera: toTarget.clone().add(offset),
      start: -1,
    };
  }

  /** The glide itself: one ease, then the camera belongs to the player again. */
  private updateFocus(now: number): void {
    const focus = this.focus;
    if (!focus) return;
    if (focus.start < 0) focus.start = now;

    const t = Math.min(1, (now - focus.start) / FOCUS_MS);
    // Smoothstep: no jolt at either end.
    const ease = t * t * (3 - 2 * t);

    this.controls.target.lerpVectors(focus.fromTarget, focus.toTarget, ease);
    this.camera.position.lerpVectors(focus.fromCamera, focus.toCamera, ease);

    if (t >= 1) this.focus = null;
  }

  /**
   * The explosion: a white flash, a red fireball that rises, and a shockwave ring
   * that runs out to the edge of the zone. Animated in `render`, removed when spent.
   */
  playBlast(cells: readonly ZoneCell[]): void {
    this.clearBlast();
    if (cells.length === 0) return;

    const centre = cells.reduce(
      (best, cell) => (cell.chance > best.chance ? cell : best),
      cells[0]!,
    );
    const { x, z } = cellToWorld(this.map, centre.cell);
    const ground = elevationToHeight(this.map.elev[centre.cell] ?? 0, this.relief);

    const group = new THREE.Group();
    group.position.set(x, ground + 0.02, z);

    const scorch = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 3, CELL * 3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#1a0d08'),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    scorch.position.y = 0.01;

    const fireball = new THREE.Mesh(
      new THREE.SphereGeometry(CELL * 1.15, 16, 12),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#ff7a1f'),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    fireball.position.y = CELL * 0.5;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CELL * 0.6, CELL * 0.78, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#ffd8a8'),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.position.y = 0.03;

    group.add(scorch, fireball, ring);
    group.renderOrder = 6;
    this.scene.add(group);
    this.blast = { group, ring, fireball, scorch, start: -1 };
  }

  /** One explosion: shockwave out, fireball up, a bright flash, then the scorch. */
  private updateBlast(now: number): void {
    const blast = this.blast;
    if (!blast) return;
    if (blast.start < 0) blast.start = now;

    // A clock that goes backwards (a reload, a jumped world) restarts the frame
    // rather than freezing the explosion on screen forever.
    if (now < blast.start) blast.start = now;

    const frame = blastFrame(now - blast.start);
    blast.ring.scale.setScalar(frame.ringScale);
    (blast.ring.material as THREE.MeshBasicMaterial).opacity = frame.ringOpacity;

    blast.fireball.scale.setScalar(frame.fireballScale);
    blast.fireball.position.y = CELL * frame.fireballY;
    (blast.fireball.material as THREE.MeshBasicMaterial).opacity = frame.fireballOpacity;

    (blast.scorch.material as THREE.MeshBasicMaterial).opacity = frame.scorchOpacity;

    if (frame.done) this.clearBlast();
  }

  /**
   * A drag on the camera cancels a glide: the player's hands always win over an
   * automatic move.
   */
  cancelFocus(): void {
    this.focus = null;
  }

  private clearBlast(): void {
    if (!this.blast) return;
    this.scene.remove(this.blast.group);
    for (const mesh of [this.blast.ring, this.blast.fireball, this.blast.scorch]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.blast = null;
  }

  /**
   * The rocket base for a side, sized to stand over the board. Built once per side
   * and scaled: the geometry itself is a unit box, like the castles.
   */
  private rocketGeometry(side: 0 | 1): THREE.BufferGeometry {
    const cached = this.rocketGeometries[side];
    if (cached) return cached;

    const made = createRocketGeometry(side);
    made.scale(ROCKET_WIDTH, ROCKET_HEIGHT, ROCKET_WIDTH);
    made.computeBoundingBox();
    this.rocketGeometries[side] = made;
    return made;
  }

  setUnits(units: readonly UnitInstance[]): void {
    this.lastUnits = units;
    // Chess never builds a city, so the castles are requested from here too — and
    // a tower drawn before the file arrived is rebuilt by the loader callback.
    if (units.some((unit) => unit.role === 'tower' || unit.role === 'rocket')) {
      this.loadCustomModelOnce();
    }
    for (const mesh of this.unitMeshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.unitMeshes = [];
    if (units.length === 0) return;

    const groups = new Map<string, UnitInstance[]>();
    for (const unit of units) {
      const key = `${unit.role}:${unit.side}`;
      const list = groups.get(key);
      if (list) list.push(unit);
      else groups.set(key, [unit]);
    }

    const towers = new Set(units.filter((unit) => unit.role === 'tower').map((unit) => unit.cell));
    const matrix = new THREE.Matrix4();
    for (const list of groups.values()) {
      const first = list[0] as UnitInstance;
      // A tower prefers the side's castle model; without one it falls back to the
      // procedural drum, tinted per side so the two are still told apart. A rocket
      // base is always procedural, and already carries its side's colours.
      const castle = first.role === 'tower' ? this.towerGeometry(first.side) : null;
      const rocket = first.role === 'rocket' ? this.rocketGeometry(first.side) : null;
      const model = castle ?? rocket;
      const tint = model ? buildingTint(first.side, MODEL_TINT_STRENGTH) : null;
      const material = new THREE.MeshLambertMaterial({
        // A tinted model keeps its own palette: only a light lean towards the
        // owner's colour, the same rule the buildings follow.
        color: tint
          ? new THREE.Color(tint[0] / 255, tint[1] / 255, tint[2] / 255)
          : new THREE.Color(unitColour(first.role, first.side)),
        vertexColors: model !== null,
      });
      const mesh = new THREE.InstancedMesh(
        model ?? unitGeometry(first.role),
        material,
        list.length,
      );
      mesh.castShadow = this.quality === 'high';
      list.forEach((unit, index) => {
        const { x, z } = cellToWorld(this.map, unit.cell);
        const ground = elevationToHeight(this.map.elev[unit.cell] ?? 0, this.relief);
        const inside = unit.role !== 'tower' && towers.has(unit.cell);
        matrix.makeTranslation(
          inside ? x + GARRISON_OFFSET : x,
          ground,
          inside ? z + GARRISON_OFFSET : z,
        );
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.unitMeshes.push(mesh);
    }
  }

  /** Rebuilds the move hints. There are at most a few dozen, once per click. */
  setHints(hints: readonly MoveHint[]): void {
    for (const mesh of this.hintMeshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.hintMeshes = [];
    if (hints.length === 0) return;

    const groups = new Map<MoveHint['kind'], number[]>();
    for (const hint of hints) {
      const list = groups.get(hint.kind);
      if (list) list.push(hint.cell);
      else groups.set(hint.kind, [hint.cell]);
    }

    const matrix = new THREE.Matrix4();
    for (const [kind, cells] of groups) {
      const mesh = new THREE.InstancedMesh(hintGeometry(kind), hintMaterial(kind), cells.length);
      mesh.renderOrder = 5;
      cells.forEach((cell, index) => {
        const { x, z } = cellToWorld(this.map, cell);
        const ground = elevationToHeight(this.map.elev[cell] ?? 0, this.relief);
        // A hair above the terrain so the marker is not buried by its own cell.
        matrix.makeTranslation(x, ground + 0.02, z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.hintMeshes.push(mesh);
    }
  }

  /**
   * The blast area of a rocket under the pointer: nine filled tiles, the centre
   * one darker than the ring, so the 50/20 split is visible before the shot.
   */
  setZone(cells: readonly ZoneCell[] | null): void {
    for (const mesh of this.zoneMeshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.zoneMeshes = [];
    if (!cells || cells.length === 0) return;

    if (!this.zoneGeometry) {
      const tile = new THREE.PlaneGeometry(0.96, 0.96);
      tile.rotateX(-Math.PI / 2);
      this.zoneGeometry = tile;
    }

    const centre = cells.reduce((best, cell) => Math.max(best, cell.chance), 0);
    for (const { cell, chance } of cells) {
      const best = chance >= centre;
      const material = new THREE.MeshBasicMaterial({
        // Red where pieces die: the centre is a bright red, the ring a dark one.
        color: new THREE.Color(best ? ZONE_COLOURS.centre : ZONE_COLOURS.ring),
        transparent: true,
        opacity: best ? 0.42 : 0.22,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.zoneGeometry, material);
      const { x, z } = cellToWorld(this.map, cell);
      const ground = elevationToHeight(this.map.elev[cell] ?? 0, this.relief);
      mesh.position.set(x, ground + 0.015, z);
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      this.zoneMeshes.push(mesh);
    }
  }

  setSidePreview(preview: boolean): void {
    if (preview === this.sidePreview) return;
    this.sidePreview = preview;
    this.updateBuildings(this.state, performance.now(), true);
  }

  setState(state: GameState, now: number): void {
    const previous = this.state;
    this.state = state;
    // Terrain below the waterline is not drawn, so a rise changes which cells
    // exist at all: that is a rebuild, not a recolour.
    const risen = state.seaLevel !== this.seaLevel;
    this.seaLevel = state.seaLevel;
    // The plane follows the level, and also any rebuild that changed the
    // vertical mapping (relief, map size, quality) without changing the level.
    this.placeWater();
    if (risen) {
      this.rebuildTerrain();
    } else if (
      !previous ||
      Object.keys(previous.cells).length !== Object.keys(state.cells).length
    ) {
      this.rebuildTerrainColors();
    }
    this.updateBuildings(state, now, true);
  }

  /**
   * Height of the sea surface for the current level. Mapped through the same
   * exaggeration as the land so the plane sits on the contour it is drowning,
   * and offset so level 0 leaves the water exactly where it has always been.
   */
  private seaSurface(): number {
    const flat = elevationToHeight(0, this.relief);
    // A hair above the contour: a cell standing exactly at the waterline would
    // otherwise fight the plane for the same depth and flicker dry and wet.
    return elevationToHeight(this.seaLevel, this.relief) - flat + 0.015;
  }

  private rebuildTerrainColors(): void {
    if (!this.terrain) return;
    const cells = buildTerrain(this.map, this.relief, this.state?.cells ?? {}, this.seaLevel);
    const color = new THREE.Color();
    cells.forEach((cell, i) => {
      color.setRGB(...unitColor(cell.color), THREE.SRGBColorSpace);
      this.terrain?.setColorAt(i, color);
    });
    if (this.terrain.instanceColor) this.terrain.instanceColor.needsUpdate = true;
  }

  /**
   * Storms follow their plan's path in cell space; the funnel's base sits on the
   * terrain under it, which is what makes it look like it touches the ground.
   */
  private updateStorms(now: number): void {
    if (this.storms.size === 0) return;
    for (const plan of this.stormPlans) {
      const look = this.storms.get(plan.id);
      if (!look) continue;
      const [col, row] = stormPointAt(plan, now);
      const x = (col - this.map.cols / 2 + 0.5) * CELL;
      const z = (row - this.map.rows / 2 + 0.5) * CELL;

      const cellCol = Math.min(this.map.cols - 1, Math.max(0, Math.round(col)));
      const cellRow = Math.min(this.map.rows - 1, Math.max(0, Math.round(row)));
      const index = cellRow * this.map.cols + cellCol;
      const ground =
        this.map.mask[index] === '#'
          ? elevationToHeight(this.map.elev[index] ?? 0, this.relief)
          : 0;

      look.group.position.set(x, ground, z);
      look.update(plan, now);
    }
  }

  private updateBuildings(state: GameState | null, now: number, force: boolean): void {
    const meshes = this.buildings;
    if (!meshes || !this.glow) return;
    if (!state) {
      meshes[0].count = 0;
      meshes[1].count = 0;
      return;
    }
    if (!force && now - this.lastBuildingUpdate < 100) return;
    this.lastBuildingUpdate = now;

    const cells = buildBuildings(this.map, state, now, this.relief);

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const positions = this.glow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const glowCapacity = positions.count;
    const counts: [number, number] = [0, 0];
    this.buildingCells = [[], []];

    cells.forEach((cell, i) => {
      const side = sideFor(cell.index, this.sidePreview);
      const mesh = meshes[side];
      const slot = counts[side]++;
      this.buildingCells[side].push(cell.index);

      matrix.makeScale(cell.width, cell.height, cell.width);
      matrix.setPosition(cell.x, cell.y - cell.height / 2, cell.z);
      mesh.setMatrixAt(slot, matrix);

      const shade = 0.92 + 0.08 * Math.min(1, cell.scale);
      const tint = unitColor(
        buildingTint(side, this.models[side] ? MODEL_TINT_STRENGTH : undefined),
      );
      color.setRGB(tint[0] * shade, tint[1] * shade, tint[2] * shade);
      mesh.setColorAt(slot, color);

      if (i < glowCapacity) {
        positions.setXYZ(i, cell.x, cell.y + cell.height * 0.55, cell.z);
      }
    });

    // Kings stand on their square, on top of whatever was built there.
    for (const side of [0, 1] as const) {
      const king = this.kingMeshes[side];
      if (!king) continue;
      const index = state.kings[side];
      const cell = cells.find((candidate) => candidate.index === index);
      king.visible = cell !== undefined;
      if (cell) king.position.set(cell.x, cell.y + cell.height / 2 + 0.02, cell.z);
    }

    for (const side of [0, 1] as const) {
      const mesh = meshes[side];
      mesh.count = counts[side];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }

    positions.needsUpdate = true;
    this.glow.geometry.setDrawRange(0, Math.min(cells.length, glowCapacity));
  }

  setLighting(lighting: Lighting): void {
    this.night = lighting.night;
    for (const look of this.storms.values()) look.setNight(this.night);
    const sun = new THREE.Vector3(...lighting.sunDir).normalize();
    const distance = Math.max(...Object.values(boardSize(this.map))) * 1.6;
    this.sun.position.set(sun.x * distance, Math.max(2, sun.y) * distance, sun.z * distance);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.setRGB(lighting.sun[0], lighting.sun[1], lighting.sun[2], THREE.SRGBColorSpace);
    this.sun.intensity = 0.35 + (1 - lighting.night) * 1.55;

    this.hemi.intensity = lighting.ambient * 1.25;
    this.hemi.color.setRGB(
      lighting.sky[0] * 0.9 + 0.1,
      lighting.sky[1] * 0.9 + 0.1,
      lighting.sky[2] * 0.9 + 0.1,
      THREE.SRGBColorSpace,
    );

    const background = new THREE.Color().setRGB(
      lighting.sky[0],
      lighting.sky[1],
      lighting.sky[2],
      THREE.SRGBColorSpace,
    );
    this.scene.background = background;
    this.scene.fog = new THREE.Fog(background, this.fogNear, this.fogFar);

    if (this.water) {
      const uniforms = (this.water.material as THREE.ShaderMaterial).uniforms;
      // Same values as the scene background, and in the same space: the shader
      // output is display-referred, so no conversion here either.
      uniforms.uFog?.value.setRGB(
        lighting.sky[0],
        lighting.sky[1],
        lighting.sky[2],
        THREE.NoColorSpace,
      );
      uniforms.uSun?.value.set(sun.x, sun.y, sun.z);
      uniforms.uShallow?.value.setRGB(
        0.247 - 0.06 * lighting.night,
        0.584 - 0.2 * lighting.night,
        0.722 - 0.2 * lighting.night,
        THREE.NoColorSpace,
      );
    }

    if (this.glow) {
      (this.glow.material as THREE.PointsMaterial).opacity = 0.85 * lighting.night;
    }
  }

  setRelief(relief: boolean): void {
    if (relief === this.relief) return;
    this.relief = relief;
    this.rebuildTerrain();
    this.setState(this.state ?? this.emptyState(), performance.now());
  }

  private emptyState(): GameState {
    return {
      v: 1,
      seed: 0,
      cells: {},
      seaLevel: 0,
      coins: [0, 0],
      claimed: [0, 0],
      lastDay: 0,
      kings: [-1, -1],
    };
  }

  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
    this.resize();
    this.rebuildTerrain();
    this.setState(this.state ?? this.emptyState(), performance.now());
  }

  setSelected(index: number): void {
    this.selected = index;
    this.placeHighlight(this.selection, index);
  }

  setHovered(index: number): void {
    if (index === this.hovered) return;
    this.hovered = index;
    if (index >= 0 && index === this.selected) {
      if (this.hoverRing) this.hoverRing.visible = false;
      return;
    }
    this.placeHighlight(this.hoverRing, index);
  }

  private placeHighlight(line: THREE.LineSegments | null, index: number): void {
    if (!line) return;
    if (index < 0 || index >= this.map.rows * this.map.cols) {
      line.visible = false;
      return;
    }
    const col = index % this.map.cols;
    const row = Math.floor(index / this.map.cols);
    const x = col - this.map.cols / 2 + 0.5;
    const z = row - this.map.rows / 2 + 0.5;
    const land = this.map.mask[index] === '#';
    const height = land ? elevationToHeight(this.map.elev[index] ?? 0, this.relief) : 0.02;
    line.position.set(x, 0, z);
    line.scale.set(1.02, Math.max(0.03, height + 0.02), 1.02);
    line.visible = true;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.controls.enableDamping = !reduced;
    if (this.water) {
      (this.water.material as THREE.ShaderMaterial).uniforms.uAmplitude!.value = reduced ? 0 : 1;
    }
  }

  // ------------------------------------------------------------------- loop

  pick(clientX: number, clientY: number): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const targets: THREE.Object3D[] = [];
    if (this.buildings) {
      for (const side of [0, 1] as const) {
        if (this.buildings[side].count > 0) targets.push(this.buildings[side]);
      }
    }
    if (this.terrain) targets.push(this.terrain);

    const hits = this.raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      if (hit.instanceId !== undefined && this.buildings) {
        for (const side of [0, 1] as const) {
          if (hit.object === this.buildings[side]) {
            return this.buildingCells[side][hit.instanceId] ?? -1;
          }
        }
      }
      if (hit.object === this.terrain && hit.instanceId !== undefined) {
        return this.terrainCells[hit.instanceId] ?? -1;
      }
    }
    return -1;
  }

  /**
   * The post chain. Half-float targets so an additive flame can actually exceed
   * white — a clamped 8-bit buffer would put a hard ceiling on the glare — and MSAA
   * only where the quality setting pays for it, because the composer renders into
   * its own buffer and loses the canvas's antialiasing otherwise.
   */
  private buildComposer(): void {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, canvas.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || 1);

    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'high' ? 4 : 0,
    });

    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    composer.addPass(bloom);
    // OutputPass does the linear-to-sRGB and tone-mapping step the canvas would
    // have done, so the composer path and the plain path look the same.
    composer.addPass(new OutputPass());

    this.composer = composer;
    this.bloom = bloom;
  }

  /** Glow on or off. Off also means "render straight to the canvas", which is the cheap path. */
  setGlow(enabled: boolean): void {
    this.glowOn = enabled;
    // The sea has to know where the frame is going: the composer's half-float
    // target is linear, a direct draw to the canvas is not.
    const uniforms = (this.water?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (uniforms?.uLinear) uniforms.uLinear.value = enabled ? 1 : 0;
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setSize(width, height);
      // Bloom is a blur: at half resolution nothing is lost, and it costs a quarter
      // of the fill. This is the whole reason the effect is affordable on a phone.
      this.bloom?.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
    }

    // The camera is built before the canvas has a size, so its fit was computed
    // for the wrong aspect. Re-fit until the player takes over the camera.
    if (!this.userMoved) {
      this.camera.position.copy(
        cameraPositionFor(fitDistance(this.map, FOV, this.camera.aspect), fitTarget(this.map)),
      );
      this.controls.update();
    }
  }

  private resetCamera(): void {
    const target = fitTarget(this.map);
    const distance = fitDistance(this.map, FOV, this.camera.aspect || 1, 1.06, target);
    this.camera.position.copy(cameraPositionFor(distance, target));
    this.controls.target.set(target[0], target[1], target[2]);
    this.userMoved = false;
    this.controls.update();
  }

  /**
   * A guard, not a control: the orbit target sits on the ground, so a close,
   * low camera can end up inside a mountain, where the near plane cuts the
   * geometry open and the screen fills with sky. Lifting the camera is cheap and
   * never fights the controls for long.
   */
  private keepAboveGround(): void {
    const position = this.camera.position;
    const cell = worldToCell(this.map, position.x, position.z);
    const ground = cell >= 0 ? elevationToHeight(this.map.elev[cell] ?? 0, this.relief) : 0;
    const minimum = ground + 0.55;
    if (position.y < minimum) {
      position.y = minimum;
      this.camera.lookAt(this.controls.target);
    }
  }

  render(worldNow: number, frameNow: number): void {
    // Everything the player watches move runs on the real frame clock: the world
    // clock stops when the save is ahead of it, and a stopped clock once left a
    // fireball burning on the board forever.
    this.updateRocketGlow(frameNow);
    this.updateFocus(frameNow);
    this.updateBlast(frameNow);
    this.updateStorms(worldNow);
    const delta = this.reducedMotion ? 0 : 1 / 60;
    this.waterTime += delta;
    if (this.water) {
      const uniforms = (this.water.material as THREE.ShaderMaterial).uniforms;
      uniforms.uTime!.value = this.waterTime;
    }
    this.updateBuildings(this.state, worldNow, false);
    this.controls.update();
    this.keepAboveGround();

    if (this.selection && this.selection.visible && !this.reducedMotion) {
      const pulse = 1 + Math.sin(frameNow / 420) * 0.012;
      this.selection.scale.x = pulse;
      this.selection.scale.z = pulse;
    }

    if (this.glowOn && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    for (const mesh of this.unitMeshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.unitMeshes = [];
    for (const side of [0, 1] as const) {
      this.towerGeometries[side]?.dispose();
      this.towerGeometries[side] = null;
    }
    for (const side of [0, 1] as const) {
      this.rocketGeometries[side]?.dispose();
      this.rocketGeometries[side] = null;
    }
    this.clearBlast();
    this.clearRocketGlow();
    for (const mesh of this.hintMeshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.hintMeshes = [];
    for (const mesh of this.zoneMeshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.zoneMeshes = [];
    this.zoneGeometry?.dispose();
    this.zoneGeometry = null;
    this.controls.dispose();
    this.noiseTexture.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.renderer.dispose();
    this.depthTexture.dispose();
  }
}
