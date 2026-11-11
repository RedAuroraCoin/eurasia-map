import { cellColor, cssRgb, type GameState, type MapEntry } from '@eurasia/shared';
import { buildBuildings } from './geometry';
import type { View } from './scene3d';
import type { Lighting } from './palette';

/**
 * The no-WebGL view, and the low tier for phones that cannot hold 60 fps.
 *
 * It is deliberately the same colour model as the 3D one, so switching between
 * them does not change what the map means — only how much depth it has.
 */
export class Flat2D implements View {
  private readonly ctx: CanvasRenderingContext2D | null;
  private map: MapEntry;
  private state: GameState | null = null;
  private relief: boolean;
  private selected = -1;
  private hovered = -1;
  private lighting: Lighting | null = null;
  private layout = { cell: 1, ox: 0, oy: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    map: MapEntry,
    relief: boolean,
  ) {
    this.map = map;
    this.relief = relief;
    this.ctx = canvas.getContext('2d');
  }

  setMap(map: MapEntry): void {
    this.map = map;
  }

  setState(state: GameState): void {
    this.state = state;
  }

  setLighting(lighting: Lighting): void {
    this.lighting = lighting;
  }

  setRelief(relief: boolean): void {
    this.relief = relief;
  }

  setQuality(): void {
    // nothing to trade away: this is already the cheap path
  }

  setSelected(index: number): void {
    this.selected = index;
  }

  setHovered(index: number): void {
    this.hovered = index;
  }

  setReducedMotion(): void {
    // the flat view has no motion to reduce
  }

  pick(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const { cell, ox, oy } = this.layout;
    const col = Math.floor((clientX - rect.left - ox) / cell);
    const row = Math.floor((clientY - rect.top - oy) / cell);
    if (row < 0 || row >= this.map.rows || col < 0 || col >= this.map.cols) return -1;
    return row * this.map.cols + col;
  }

  resize(): void {
    // sizes are derived at draw time
  }

  render(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { canvas } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || 1));

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080e17';
    ctx.fillRect(0, 0, width, height);

    const map = this.map;
    const cell = Math.max(2, Math.floor(Math.min(width / map.cols, height / map.rows)));
    const ox = Math.floor((width - cell * map.cols) / 2);
    const oy = Math.floor((height - cell * map.rows) / 2);
    this.layout = { cell, ox, oy };

    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const index = row * map.cols + col;
        ctx.fillStyle = cssRgb(cellColor(map, index));
        ctx.fillRect(ox + col * cell, oy + row * cell, cell, cell);
      }
    }

    if (this.state) {
      const night = this.lighting?.night ?? 0;
      const buildings = buildBuildings(map, this.state, now, this.relief);
      for (const building of buildings) {
        const col = building.index % map.cols;
        const row = Math.floor(building.index / map.cols);
        const inset = Math.max(1, Math.round(cell * 0.18));
        const size = Math.max(2, cell - inset * 2);
        const shade = 0.55 + 0.45 * Math.min(1, building.scale);
        ctx.fillStyle = `rgb(${Math.round(205 * shade + 50 * night)} ${Math.round(
          120 * shade + 40 * night,
        )} ${Math.round(60 * shade)})`;
        ctx.fillRect(ox + col * cell + inset, oy + row * cell + inset, size, size);
      }
    }

    if (cell >= 7) {
      ctx.strokeStyle = 'rgba(4, 8, 14, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let col = 1; col < map.cols; col++) {
        const x = Math.round(ox + col * cell) + 0.5;
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + map.rows * cell);
      }
      for (let row = 1; row < map.rows; row++) {
        const y = Math.round(oy + row * cell) + 0.5;
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + map.cols * cell, y);
      }
      ctx.stroke();
    }

    const outline = (index: number, color: string, lineWidth: number): void => {
      if (index < 0) return;
      const col = index % map.cols;
      const row = Math.floor(index / map.cols);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(
        ox + col * cell + lineWidth / 2,
        oy + row * cell + lineWidth / 2,
        cell - lineWidth,
        cell - lineWidth,
      );
    };

    if (this.hovered >= 0 && this.hovered !== this.selected) {
      outline(this.hovered, 'rgba(255,255,255,0.55)', 1);
    }
    outline(this.selected, 'rgba(0,0,0,0.6)', 3);
    outline(this.selected, 'rgba(255,255,255,0.95)', 1.5);
  }

  dispose(): void {
    // nothing to release
  }
}
