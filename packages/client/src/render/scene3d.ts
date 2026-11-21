import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { stormPointAt, type GameState, type MapEntry, type StormPlan } from '@eurasia/shared';
import { createCastleGeometry } from './castle';
import { createKingGeometry } from './king';
import { createStormLook, type StormLook } from './storm-look';
import { loadSideModels } from './model';
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
import {
  boardSize,
  CELL,
  elevationToHeight,
  fitDistance,
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
  pick(clientX: number, clientY: number): number;
  resize(): void;
  render(now: number): void;
  dispose(): void;
}

const FOV = 36;
/** The sea plane is larger than the board so the horizon is water, not a cut edge. */
const SEA_SCALE = 3.5;

/** A three-quarter view from the south-east, at exactly `distance` from the target. */
function cameraPositionFor(distance: number): THREE.Vector3 {
  // Same direction the fit solved for — a different one would crop the corners.
  return new THREE.Vector3(...VIEW_DIRECTION).normalize().multiplyScalar(distance);
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
  private glow: THREE.Points | null = null;
  private selection: THREE.LineSegments | null = null;
  private hoverRing: THREE.LineSegments | null = null;

  private terrainCells: number[] = [];
  private buildingCells: [number[], number[]] = [[], []];
  private depthTexture: THREE.DataTexture;

  /** GLBs in public/models replace the procedural castles, per side. */
  private models: [THREE.BufferGeometry | null, THREE.BufferGeometry | null] = [null, null];
  private modelRequested = false;

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
    this.camera.position.copy(cameraPositionFor(fitDistance(map, FOV, 1)));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.35, 0);
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
        uFogNear: { value: this.fogNear },
        uFogFar: { value: this.fogFar },
        uRadius: { value: Math.hypot(width, depth) / 2 },
      },
    });

    this.water = new THREE.Mesh(geometry, material);
    this.water.position.y = 0;
    this.water.receiveShadow = false;
    this.scene.add(this.water);
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

    const cells = buildTerrain(this.map, this.relief, this.state?.cells ?? {});
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

  setSidePreview(preview: boolean): void {
    if (preview === this.sidePreview) return;
    this.sidePreview = preview;
    this.updateBuildings(this.state, performance.now(), true);
  }

  setState(state: GameState, now: number): void {
    const previous = this.state;
    this.state = state;
    if (!previous || Object.keys(previous.cells).length !== Object.keys(state.cells).length) {
      this.rebuildTerrainColors();
    }
    this.updateBuildings(state, now, true);
  }

  private rebuildTerrainColors(): void {
    if (!this.terrain) return;
    const cells = buildTerrain(this.map, this.relief, this.state?.cells ?? {});
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

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);

    // The camera is built before the canvas has a size, so its fit was computed
    // for the wrong aspect. Re-fit until the player takes over the camera.
    if (!this.userMoved) {
      this.camera.position.copy(cameraPositionFor(fitDistance(this.map, FOV, this.camera.aspect)));
      this.controls.update();
    }
  }

  private resetCamera(): void {
    const distance = fitDistance(this.map, FOV, this.camera.aspect || 1);
    this.camera.position.copy(cameraPositionFor(distance));
    this.controls.target.set(0, 0.35, 0);
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

  render(now: number): void {
    this.updateStorms(now);
    const delta = this.reducedMotion ? 0 : 1 / 60;
    this.waterTime += delta;
    if (this.water) {
      const uniforms = (this.water.material as THREE.ShaderMaterial).uniforms;
      uniforms.uTime!.value = this.waterTime;
    }
    this.updateBuildings(this.state, now, false);
    this.controls.update();
    this.keepAboveGround();

    if (this.selection && this.selection.visible && !this.reducedMotion) {
      const pulse = 1 + Math.sin(now / 420) * 0.012;
      this.selection.scale.x = pulse;
      this.selection.scale.z = pulse;
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.depthTexture.dispose();
  }
}
