// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The room path of the client: `?room=CODE` must stop reducing locally and
 * start talking the wire protocol. There is no browser here, so a fake
 * WebSocket stands in for the Durable Object and records what the client sends.
 */

const ROOM = 'ABCD234567';

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;

  readyState = 0;
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  get commands(): { t: string; cmd?: { k: string; cell?: number } }[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }

  send(raw: string): void {
    this.sent.push(raw);
  }

  close(): void {
    this.readyState = 3;
  }
}

const initialState = {
  v: 3,
  seed: 7,
  cells: {},
  coins: [10, 10] as [number, number],
  claimed: [0, 0] as [number, number],
  lastDay: 0,
  kings: [-1, -1] as [number, number],
};

function recordingContext(): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, property) {
      if (property in target) return target[property as string];
      return () => undefined;
    },
    set(target, property, value) {
      target[property as string] = value;
      return true;
    },
  };
  // Gradient factories must return something with addColorStop: fire and blast
  // drawing build gradients, and a stub that returns undefined throws.
  const gradient = { addColorStop: () => undefined };
  const seeded: Record<string, unknown> = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
  };
  return new Proxy(seeded, handler) as unknown as CanvasRenderingContext2D;
}

const rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  vi.resetModules();
  FakeSocket.instances = [];
  rafQueue.length = 0;
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, '', `/?room=${ROOM}`);

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  }) as typeof requestAnimationFrame;
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
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

const flush = (): void => {
  for (const callback of rafQueue.splice(0)) callback(16);
};

const boot = async () => {
  const module = await import('./main');
  flush();
  return module.__eurasia;
};

const socket = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('the client never opened a socket');
  return socket;
};

describe('the invite button', () => {
  it('creates a room from single-player and goes there', async () => {
    history.replaceState({}, '', '/');
    // The Worker probe decides whether rooms exist; pretend it answered.
    globalThis.fetch = (async () => ({ ok: true })) as unknown as typeof fetch;
    vi.resetModules();

    await boot();
    const invite = document.querySelector<HTMLButtonElement>('.room-code');
    expect(invite?.textContent).toBe('Play with a friend');

    invite?.click();
    expect(location.search).toMatch(/room=[0-9A-Z]{10}/);
  });

  it('says why instead of navigating when there is no server', async () => {
    history.replaceState({}, '', '/');
    globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;
    vi.resetModules();

    await boot();
    document.querySelector<HTMLButtonElement>('.room-code')?.click();

    expect(location.search).toBe('');
    expect(document.querySelector('.status')?.textContent).toContain('game server');
  });
});

describe('multiplayer room', () => {
  it('opens one socket to the room and shows the waiting overlay', async () => {
    const game = await boot();

    expect(game.isMultiplayer()).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket().url).toContain(`/api/room/${ROOM}`);

    socket().open();
    const hello = socket().commands.find((message) => message.t === 'hello');
    expect(hello).toBeDefined();

    expect(document.querySelector('.waiting-overlay')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.room-code')?.textContent).toContain(ROOM);
  });

  it('adopts the server state on welcome and hides the overlay', async () => {
    const game = await boot();
    socket().open();
    socket().receive({
      t: 'welcome',
      proto: 1,
      seat: 1,
      rev: 4,
      state: initialState,
      serverTime: 0,
    });

    expect(game.getSeat()).toBe(1);
    expect(document.querySelector('.waiting-overlay')?.classList.contains('hidden')).toBe(true);

    const stats = document.querySelector('.stats');
    expect(stats?.classList.contains('multi')).toBe(true);
    expect(stats?.textContent).toContain('10');
    expect(stats?.textContent).toContain('Opponent');
  });

  it('sends a claim for a free cell instead of reducing locally', async () => {
    const game = await boot();
    socket().open();
    socket().receive({
      t: 'welcome',
      proto: 1,
      seat: 0,
      rev: 1,
      state: initialState,
      serverTime: 0,
    });

    const canvas = document.querySelector('canvas');
    canvas?.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 440, clientY: 360, bubbles: true }),
    );
    canvas?.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 440, clientY: 360, bubbles: true }),
    );
    flush();

    const claim = socket().commands.find((message) => message.t === 'cmd');
    expect(claim?.cmd?.k).toBe('claim');
    // The authoritative state has not changed yet: nothing was claimed locally.
    expect(game.getState().claimed[0]).toBe(0);
  });

  it('applies a broadcast state and reports rejected commands', async () => {
    const game = await boot();
    socket().open();
    socket().receive({
      t: 'welcome',
      proto: 1,
      seat: 0,
      rev: 1,
      state: initialState,
      serverTime: 0,
    });

    socket().receive({
      t: 'state',
      rev: 2,
      ack: 0,
      events: [{ t: 'claimed', cell: 5, cost: 5 }],
      state: {
        ...initialState,
        cells: { '5': { o: 0, t: 0, hp: 100 } },
        coins: [5, 10],
        claimed: [1, 0],
        kings: [5, -1],
      },
    });

    expect(game.getState().claimed[0]).toBe(1);
    expect(document.querySelector('.status')?.textContent).toContain('Cell claimed');

    socket().receive({ t: 'reject', id: 9, code: 'sea', rev: 2 });
    expect(document.querySelector('.status')?.textContent).toContain('water');
  });

  it('shows the server error text when the room is full', async () => {
    await boot();
    socket().open();
    socket().receive({ t: 'error', code: 'room_full' });

    expect(document.querySelector('.status')?.textContent).toContain('Room is full');
  });
});
