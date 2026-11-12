// @vitest-environment happy-dom
import { getMap } from '@eurasia/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A DOM smoke test, not a rendering test.
 *
 * There is no headless Chromium in this environment, so this proves what can be
 * proven without a GPU: the module boots, builds the interface, wires input,
 * claims a cell through the real engine, saves, and switches maps. The 3D scene
 * is never constructed here — `createView` falls back to the 2D board, which is
 * exactly the path a device without WebGL would take.
 */

const drawCalls: string[] = [];

function recordingContext(): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, property) {
      if (property in target) return target[property as string];
      return (..._args: unknown[]) => {
        drawCalls.push(String(property));
        return undefined;
      };
    },
    set(target, property, value) {
      target[property as string] = value;
      return true;
    },
  };
  return new Proxy({} as Record<string, unknown>, handler) as unknown as CanvasRenderingContext2D;
}

let rafQueue: FrameRequestCallback[] = [];

function flushFrames(limit = 4): void {
  for (let i = 0; i < limit; i++) {
    const queue = rafQueue;
    rafQueue = [];
    for (const callback of queue) callback(i * 16);
  }
}

beforeEach(() => {
  vi.resetModules();
  drawCalls.length = 0;
  rafQueue = [];
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  delete document.documentElement.dataset.theme;

  HTMLCanvasElement.prototype.getContext = ((type: string) =>
    type === '2d' ? recordingContext() : null) as unknown as HTMLCanvasElement['getContext'];

  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 880,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 720,
  });
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 880, height: 720, top: 0, left: 0, right: 880, bottom: 720 }) as DOMRect;

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  }) as typeof requestAnimationFrame;

  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;

  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const boot = async () => {
  const module = await import('./main');
  flushFrames();
  return module.__eurasia;
};

const clickCell = (x: number, y: number): void => {
  const canvas = document.querySelector('canvas');
  const options = { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' };
  canvas?.dispatchEvent(new PointerEvent('pointerdown', options));
  canvas?.dispatchEvent(new PointerEvent('pointerup', options));
  flushFrames();
};

/** Screen position of a cell in the 2D fallback: square cells, centred board. */
const cellCentre = (cols: number, rows: number, index: number): { x: number; y: number } => {
  const cell = Math.max(2, Math.floor(Math.min(880 / cols, 720 / rows)));
  const ox = Math.floor((880 - cell * cols) / 2);
  const oy = Math.floor((720 - cell * rows) / 2);
  return {
    x: ox + (index % cols) * cell + cell / 2,
    y: oy + Math.floor(index / cols) * cell + cell / 2,
  };
};

describe('single-player shell', () => {
  it('boots with a board, a panel and stats', async () => {
    await boot();

    expect(document.querySelector('h1')?.textContent).toBe('Eurasia Map');
    expect(document.querySelector('canvas')).not.toBeNull();
    expect(document.querySelectorAll('.segmented')).toHaveLength(7);
    expect(document.querySelector('.stats')?.textContent).toContain('Coins');
    expect(document.querySelector('.stats')?.textContent).toContain('10');
    expect(drawCalls).toContain('fillRect');
  });

  it('claims a cell on Enter and refunds it on a second press', async () => {
    const { getState } = await boot();
    const canvas = document.querySelector('canvas');

    expect(getState().coins[0]).toBe(10);
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushFrames();

    const afterClaim = getState();
    expect(afterClaim.claimed[0]).toBe(1);
    expect(afterClaim.coins[0]).toBe(5);

    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushFrames();
    expect(getState().claimed[0]).toBe(0);
    expect(getState().coins[0]).toBe(10);
  });

  it('claims a land cell on click and refuses the sea', async () => {
    const { getState } = await boot();
    const map = getMap(500);

    let land = -1;
    let sea = -1;
    for (let i = 0; i < map.mask.length; i++) {
      if (map.mask[i] === '#' && land < 0) land = i;
      if (map.mask[i] === '.' && sea < 0) sea = i;
      if (land >= 0 && sea >= 0) break;
    }

    const landPoint = cellCentre(map.cols, map.rows, land);
    clickCell(landPoint.x, landPoint.y);
    expect(getState().cells[String(land)]).toBeDefined();
    expect(document.querySelector('.status')?.textContent).toContain('Cell claimed');

    const seaPoint = cellCentre(map.cols, map.rows, sea);
    clickCell(seaPoint.x, seaPoint.y);
    expect(document.querySelector('.status')?.textContent).toContain('water');
  });

  it('persists progress between boots', async () => {
    const first = await boot();
    document
      .querySelector('canvas')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushFrames();
    expect(first.getState().claimed[0]).toBe(1);

    // the debounced save needs a nudge: the module also writes on unload
    window.dispatchEvent(new Event('beforeunload'));
    vi.resetModules();

    const second = await boot();
    expect(second.getState().claimed[0]).toBe(1);
    expect(second.getState().coins[0]).toBe(5);
  });

  it('switches map size and starts a separate city there', async () => {
    await boot();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.segmented button')];
    const size800 = buttons.find((button) => button.textContent === '800');
    expect(size800).toBeDefined();

    size800?.click();
    flushFrames();

    expect(size800?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.stats')?.textContent).toContain('0 / 800');
  });

  it('applies the theme to the document', async () => {
    await boot();
    const dark = [...document.querySelectorAll<HTMLButtonElement>('.segmented button')].find(
      (button) => button.textContent === 'Dark',
    );
    dark?.click();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('enters demo mode without touching the saved city', async () => {
    const { getState } = await boot();
    const demoButton = [...document.querySelectorAll<HTMLButtonElement>('.button')].find(
      (button) => button.textContent === 'Demo city',
    );
    expect(demoButton).toBeDefined();

    demoButton?.click();
    flushFrames();

    const state = getState();
    expect(state.claimed[0]).toBe(getMap(500).land);
    expect(state.coins[0]).toBe(0);
    expect(document.querySelector('.status')?.textContent).toContain('Demo');
  });
});
