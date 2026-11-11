// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A DOM smoke test, not a rendering test.
 *
 * There is no headless Chromium in this environment, so this proves what can be
 * proven without pixels: the module boots without throwing, builds the panel,
 * wires the controls, and keeps the accessible status line in sync. The canvas
 * is a recording stub — it confirms the draw path ran, not that the map is pretty.
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

function flushFrames(): void {
  const queue = rafQueue;
  rafQueue = [];
  for (const callback of queue) callback(0);
}

beforeEach(() => {
  vi.resetModules();
  drawCalls.length = 0;
  rafQueue = [];

  document.body.innerHTML = '<div id="app"></div>';

  HTMLCanvasElement.prototype.getContext = (() =>
    recordingContext()) as unknown as HTMLCanvasElement['getContext'];
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
});

describe('client shell', () => {
  it('boots and renders the panel', async () => {
    await import('./main');
    flushFrames();

    expect(document.querySelector('h1')?.textContent).toBe('Карта Евразии');
    expect(document.querySelectorAll('.segmented button')).toHaveLength(6); // 3 sizes + 3 themes
    expect(document.querySelector('canvas')).not.toBeNull();
    expect(drawCalls).toContain('fillRect');
    expect(document.querySelector('.facts')?.textContent).toContain('500');
  });

  it('switches map size and updates the facts', async () => {
    await import('./main');
    flushFrames();

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.segmented button')];
    const size800 = buttons.find((b) => b.textContent === '800 клеток');
    expect(size800?.getAttribute('aria-pressed')).toBe('false');

    size800?.click();
    flushFrames();

    expect(size800?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.facts')?.textContent).toContain('44 × 36');
  });

  it('moves the cursor with the keyboard and announces the cell', async () => {
    await import('./main');
    flushFrames();

    const status = () => document.querySelector('.status span')?.textContent ?? '';
    const first = status();

    const canvas = document.querySelector('canvas');
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushFrames();

    expect(status()).not.toBe(first);
    expect(status()).toContain('Строка 1');
  });

  it('applies the theme to the document element', async () => {
    await import('./main');
    flushFrames();

    const dark = [...document.querySelectorAll<HTMLButtonElement>('.segmented button')].find(
      (b) => b.textContent === 'Тёмная',
    );
    dark?.click();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
