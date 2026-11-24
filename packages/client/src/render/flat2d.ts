import {
  cellColor,
  cssRgb,
  seaColor,
  type GameState,
  type MapEntry,
  type StormPlan,
} from '@eurasia/shared';
import { buildBuildings, ownerTint } from './geometry';
import { SIDE_COLOURS, TOWER_COLOURS, type UnitInstance, type UnitRole } from './pieces';
import { HINT_COLOURS, ZONE_COLOURS, type MoveHint } from './hints';
import { blastFrame } from './blast';
import { flatLayout } from './grid';
import type { View, ZoneCell } from './scene3d';
import type { Lighting } from './palette';

/** One character per piece, so the flat view still says what is standing there. */
const GLYPHS: Record<UnitRole, string> = {
  king: 'K',
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
  pawn: 'P',
  tower: '',
  rocket: 'M',
};

const glyphFor = (role: UnitRole): string => GLYPHS[role];

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
  private units: readonly UnitInstance[] = [];
  private hints: readonly MoveHint[] = [];
  private zone: readonly ZoneCell[] = [];
  private blast: { readonly cells: readonly ZoneCell[]; start: number } | null = null;
  /** Rocket bases about to fire: a pulsing ring on those cells. */
  private glow: number[] = [];

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

  /** Pieces are drawn as discs with a role mark: the flat view has no silhouettes. */
  setUnits(units: readonly UnitInstance[]): void {
    this.units = units;
  }

  setHints(hints: readonly MoveHint[]): void {
    this.hints = hints;
  }

  setZone(cells: readonly ZoneCell[] | null): void {
    this.zone = cells ?? [];
  }

  playBlast(cells: readonly ZoneCell[]): void {
    this.blast = cells.length > 0 ? { cells, start: -1 } : null;
  }

  /** The flat view fills the canvas, so there is nothing to glide to. */
  focusCell(_cell: number): void {
    // No camera: the whole board is always in frame.
  }

  setRocketGlow(cells: readonly number[] | null): void {
    this.glow = cells ? [...cells] : [];
  }

  /** There is no HDR buffer here: the flat view paints by hand and needs no glare. */
  setGlow(_enabled: boolean): void {
    // nothing to switch
  }

  setState(state: GameState): void {
    this.state = state;
  }

  /**
   * The flat view has no castle geometry to swap — two sides are a 3D concern.
   * The method exists so the panel toggle works the same on both views.
   */
  setSidePreview(_preview: boolean): void {}

  /** The flat view has no storm geometry; the message line still reports damage. */
  setStorms(_plans: readonly StormPlan[]): void {}

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

  render(worldNow: number, frameNow: number): void {
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

    const map = this.map;
    const { cell, ox, oy } = flatLayout(map, width, height);
    this.layout = { cell, ox, oy };

    // The margins are ocean, not black: a board that is wider than it is tall sits
    // in a strip on a phone, and a strip floating in a void reads as a broken page.
    ctx.fillStyle = cssRgb(seaColor(-3000));
    ctx.fillRect(0, 0, width, height);

    // Land the sea has taken is drawn as sea: the same rule the 3D view uses to
    // stop drawing the plate, so both views lose the same cells.
    const seaLevel = this.state?.seaLevel ?? 0;
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const index = row * map.cols + col;
        const drowned = map.mask[index] === '#' && (map.elev[index] ?? 0) < seaLevel;
        ctx.fillStyle = cssRgb(drowned ? seaColor(-40) : cellColor(map, index));
        ctx.fillRect(ox + col * cell, oy + row * cell, cell, cell);
      }
    }

    if (this.state) {
      const night = this.lighting?.night ?? 0;
      const buildings = buildBuildings(map, this.state, worldNow, this.relief);
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

      // The blast area sits below the hints: a filled tile per cell, the centre
      // one darker, so the 50/20 split is visible while aiming.
      if (this.zone.length > 0) {
        const top = this.zone.reduce((best, tile) => Math.max(best, tile.chance), 0);
        for (const tile of this.zone) {
          const col = tile.cell % map.cols;
          const row = Math.floor(tile.cell / map.cols);
          const best = tile.chance >= top;
          ctx.globalAlpha = best ? 0.42 : 0.22;
          ctx.fillStyle = best ? ZONE_COLOURS.centre : ZONE_COLOURS.ring;
          ctx.fillRect(ox + col * cell, oy + row * cell, cell, cell);
        }
        ctx.globalAlpha = 1;
      }

      // Hints go under the pieces: a dot for a step, a ring for a capture, a
      // square for a tower the king could build.
      for (const hint of this.hints) {
        const col = hint.cell % map.cols;
        const row = Math.floor(hint.cell / map.cols);
        const cx = ox + col * cell + cell / 2;
        const cy = oy + row * cell + cell / 2;
        const radius = Math.max(2, cell * (hint.kind === 'build' ? 0.3 : 0.22));
        ctx.strokeStyle = HINT_COLOURS[hint.kind];
        ctx.lineWidth = Math.max(1, cell * 0.09);
        ctx.beginPath();
        if (hint.kind === 'build') {
          ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2);
        } else if (hint.kind === 'move') {
          ctx.arc(cx, cy, Math.max(1.5, radius * 0.55), 0, Math.PI * 2);
          ctx.fillStyle = HINT_COLOURS[hint.kind];
          ctx.fill();
          ctx.stroke();
          continue;
        } else {
          // Captures and recruitments are rings: the wider one takes, the
          // narrower one is a tower of yours.
          ctx.arc(cx, cy, hint.kind === 'recruit' ? radius * 0.66 : radius, 0, Math.PI * 2);
        }
        ctx.stroke();
      }

      for (const unit of this.units) {
        const col = unit.cell % map.cols;
        const row = Math.floor(unit.cell / map.cols);
        const cx = ox + col * cell + cell / 2;
        const cy = oy + row * cell + cell / 2;
        const radius = Math.max(2, cell * (unit.role === 'tower' ? 0.46 : 0.4));
        // Towers keep the side's own colour, as the two castle models do.
        ctx.fillStyle = unit.role === 'tower' ? TOWER_COLOURS[unit.side] : SIDE_COLOURS[unit.side];
        ctx.beginPath();
        if (unit.role === 'tower') {
          ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2);
        } else {
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(6, 10, 16, 0.85)';
        ctx.lineWidth = Math.max(1, cell * 0.07);
        ctx.stroke();
        const glyph = glyphFor(unit.role);
        if (glyph && cell >= 14) {
          ctx.fillStyle = unit.side === 0 ? '#1b2028' : '#e9e2d4';
          ctx.font = `${Math.round(cell * 0.5)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(glyph, cx, cy + cell * 0.02);
        }
      }

      // No meshes exist in the flat view, so the king — the only piece that can
      // build — gets a marker of its own side colour.
      for (const side of [0, 1] as const) {
        const index = this.state.kings[side];
        if (index < 0) continue;
        const col = index % map.cols;
        const row = Math.floor(index / map.cols);
        const cx = ox + col * cell + cell / 2;
        const cy = oy + row * cell + cell / 2;
        const radius = Math.max(2, cell * 0.32);
        const tint = ownerTint(side);
        ctx.fillStyle = `rgb(${tint[0]} ${tint[1]} ${tint[2]})`;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(6, 10, 16, 0.85)';
        ctx.lineWidth = Math.max(1, cell * 0.08);
        ctx.stroke();
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

    // The bases that are about to fire: a pool of fire on the ground under each,
    // drawn additively so it reads as light rather than paint.
    if (this.glow.length > 0) {
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(frameNow / 220));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const index of this.glow) {
        const col = index % map.cols;
        const row = Math.floor(index / map.cols);
        const cx = ox + col * cell + cell / 2;
        const cy = oy + row * cell + cell / 2;

        // The pool: bright at the centre, gone by the cell edge.
        const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.62);
        pool.addColorStop(0, `rgba(255, 209, 102, ${(0.75 + 0.25 * pulse).toFixed(3)})`);
        pool.addColorStop(0.45, `rgba(255, 122, 31, ${(0.5 + 0.2 * pulse).toFixed(3)})`);
        pool.addColorStop(1, 'rgba(255, 90, 18, 0)');
        ctx.fillStyle = pool;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.62, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ff9a3c';
        ctx.lineWidth = Math.max(2, cell * 0.12);
        ctx.beginPath();
        ctx.arc(cx, cy, cell * (0.34 + 0.06 * pulse), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    this.drawBlast(ctx, map, cell, ox, oy, frameNow);
  }

  /** The explosion in the flat view: a white flash core inside a red shockwave. */
  private drawBlast(
    ctx: CanvasRenderingContext2D,
    map: MapEntry,
    cell: number,
    ox: number,
    oy: number,
    now: number,
  ): void {
    const blast = this.blast;
    if (!blast) return;
    if (blast.start < 0) blast.start = now;

    if (now < blast.start) blast.start = now;
    const { t } = blastFrame(now - blast.start);
    const centre = blast.cells.reduce((best, tile) => (tile.chance > best.chance ? tile : best));
    const col = centre.cell % map.cols;
    const row = Math.floor(centre.cell / map.cols);
    const cx = ox + col * cell + cell / 2;
    const cy = oy + row * cell + cell / 2;
    const ease = 1 - Math.pow(1 - t, 3);
    // Same hold as the 3D scene: full strength for the first frames, then fade.
    const alpha = t < 0.12 ? 1 : 1 - (t - 0.12) / 0.88;

    // Scorch: the cells stay dark for a moment, then fade with the rest.
    ctx.globalAlpha = 0.45 * Math.min(1, t * 4) * (1 - t);
    ctx.fillStyle = '#1a0d08';
    for (const tile of blast.cells) {
      const tileCol = tile.cell % map.cols;
      const tileRow = Math.floor(tile.cell / map.cols);
      ctx.fillRect(ox + tileCol * cell, oy + tileRow * cell, cell, cell);
    }

    // Shockwave out to the edge of the zone.
    ctx.globalAlpha = 0.95 * alpha;
    ctx.strokeStyle = '#ffd8a8';
    ctx.lineWidth = Math.max(2, cell * 0.26 * alpha);
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.4 + ease * cell * 2.1, 0, Math.PI * 2);
    ctx.stroke();

    // Fireball: bright in the middle, fades with the rest.
    ctx.globalAlpha = 0.95 * Math.min(1, alpha * 1.6);
    ctx.fillStyle = '#ff7a1f';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * (0.4 + ease * 1.1), 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.95 * alpha;
    ctx.fillStyle = '#fff3d6';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * (0.25 + ease * 0.6), 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    if (t >= 1) this.blast = null;
  }

  dispose(): void {
    // nothing to release
  }
}
