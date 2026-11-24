// @vitest-environment happy-dom
import {
  BALANCE,
  SAVE_VERSION,
  createChessGame,
  createInitialState,
  getMap,
} from '@eurasia/shared';
import { saveChessGame } from './state/chess-save';
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
  vi.restoreAllMocks();
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

  // The app probes /api/health to learn whether rooms exist; in a DOM test that
  // would reach for a server that is not running.
  globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;

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

/**
 * Boots with nothing saved, which is what a first visit does: the shipped
 * default is the chess board.
 */
const bootFresh = async () => {
  const module = await import('./main');
  flushFrames();
  return module.__eurasia;
};

/**
 * Boots the city game. Most of these tests are about the city, and the default
 * mode is chess now, so the choice is written where the app reads it — unless the
 * test has already written its own settings file.
 */
const boot = async () => {
  if (localStorage.getItem('eurasia.settings.v2') === null) {
    localStorage.setItem('eurasia.settings.v2', JSON.stringify({ mode: 'build', size: 500 }));
  }
  return bootFresh();
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
  it('opens in chess on a first visit', async () => {
    const { getChess } = await bootFresh();

    // No save, no room, no choice made: the board is there at once.
    expect(getChess()).not.toBeNull();
    expect(getChess()?.pieces).toHaveLength(32);
    expect(document.querySelector('.build-bar')?.classList.contains('hidden')).toBe(false);
    const mode = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    );
    expect(mode?.getAttribute('aria-pressed')).toBe('true');
  });

  it('boots with a board, a panel and stats', async () => {
    await boot();

    expect(document.querySelector('h1')?.textContent).toBe('Eurasia Map');
    expect(document.querySelector('canvas')).not.toBeNull();
    expect(document.querySelectorAll('.segmented')).toHaveLength(9);
    // The panel is positioned against the stage: inside the app grid it slid
    // under the topbar and ignored that row in its max-height.
    expect(document.querySelector('.stage > .panel')).not.toBeNull();
    expect(document.querySelector('.connection-status')?.classList.contains('hidden')).toBe(true);
    const invite = document.querySelector<HTMLButtonElement>('.room-code');
    expect(invite).not.toBeNull();
    expect(invite?.classList.contains('hidden')).toBe(false);
    expect(invite?.textContent).toBe('Play with a friend');
    expect(document.querySelector('.stats')?.textContent).toContain('Coins');
    expect(document.querySelector('.stats')?.textContent).toContain(
      String(BALANCE.claim.startCoins),
    );
    // The sea is the late-game clock: it starts at the level in the balance file.
    expect(document.querySelector('.sea-stat .stat-value')?.textContent).toBe('0 m');
    expect(drawCalls).toContain('fillRect');
  });

  it('starts a new world when the saved map has drowned completely', async () => {
    const drowned = {
      ...createInitialState(1, Date.UTC(2026, 0, 1)),
      seaLevel: BALANCE.flood.maxLevel,
    };
    localStorage.setItem(
      'eurasia.save.500',
      JSON.stringify({ v: SAVE_VERSION, savedAt: Date.now(), state: drowned }),
    );

    const { getState } = await boot();

    // The old save left nothing above the waterline: a dead map, not a game.
    expect(getState().seaLevel).toBe(BALANCE.flood.startLevel);
    expect(getState().claimed[0]).toBe(0);
  });

  it('keeps a copy of a save from a newer version instead of overwriting it', async () => {
    // The version lives inside the state, not only in the envelope.
    const raw = JSON.stringify({
      v: SAVE_VERSION,
      savedAt: 1,
      state: { ...createInitialState(1, Date.UTC(2026, 0, 1)), v: SAVE_VERSION + 5 },
    });
    localStorage.setItem('eurasia.save.500', raw);

    const { getState } = await boot();

    // A fresh city, and the unreadable file is still there under a backup key.
    expect(getState().claimed[0]).toBe(0);
    const backup = Object.keys(localStorage).find((key) =>
      key.startsWith('eurasia.save.500.backup.'),
    );
    expect(backup).toBeDefined();
    expect(localStorage.getItem(backup as string)).toBe(raw);
  });

  it('boots straight into chess when that is the saved mode', async () => {
    localStorage.setItem('eurasia.settings.v2', JSON.stringify({ mode: 'chess', size: 500 }));

    const { getChess } = await boot();

    // The regression: chess used to start before the game state existed.
    expect(getChess()?.pieces).toHaveLength(32);
    expect(getChess()?.seaLevel).toBe(BALANCE.flood.startLevel);
  });

  it('keeps building-game hurricanes out of chess', async () => {
    // The world clock in the app is Date.now(), so the storm schedule is driven
    // by it; freezing and stepping it is how a fresh boot sees a hurricane.
    let world = Date.UTC(2026, 0, 1, 12);
    vi.spyOn(Date, 'now').mockImplementation(() => world);
    const step = (frames: number): void => {
      for (let i = 0; i < frames; i++) {
        world += 1000;
        flushFrames(1);
      }
    };

    const { getStormCount } = await boot();

    // Building game: a hurricane arrives within the first seconds.
    step(12);
    expect(getStormCount()).toBeGreaterThan(0);

    // Chess: the same clock, and no storm may ever appear.
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();
    expect(getStormCount()).toBe(0);

    step(30);
    expect(getStormCount()).toBe(0);
  });

  it('switches to chess and fields two armies', async () => {
    const { getChess } = await boot();
    expect(getChess()).toBeNull();
    // No building in the city game: the bar is there but hidden.
    expect(document.querySelector('.build-bar')?.classList.contains('hidden')).toBe(true);

    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement | undefined;
    expect(chessButton).toBeDefined();
    chessButton?.click();
    flushFrames();

    const game = getChess();
    expect(game).not.toBeNull();
    expect(game?.pieces).toHaveLength(32);
    expect(game?.turn).toBe(0);
    expect(game?.pieces.filter((p) => p.side === 0)).toHaveLength(16);
    // The build bar belongs to this mode only, and sits over the board.
    const bar = document.querySelector('.build-bar');
    expect(bar?.classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('.panel-actions .build-action')).toHaveLength(0);
    // And the time-speed control is gone: a turn-based game has no world clock.
    const visibleSegments = [...document.querySelectorAll('.segmented')].filter(
      (element) => element.closest('.hidden') === null,
    );
    // Nine in the building game; chess drops the map size and the time speed.
    expect(visibleSegments).toHaveLength(7);
  });

  it('opens the menu with the hamburger and deals a new game from it', async () => {
    // happy-dom has no modal dialog; without it askReset() refuses and the
    // button would look broken in the test for the wrong reason.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };

    const { getChess } = await boot();
    const app = document.querySelector('.app') as HTMLElement;
    const menu = document.querySelector('.menu-toggle') as HTMLButtonElement;
    expect(menu).not.toBeNull();

    menu.click();
    expect(app.classList.contains('panel-open')).toBe(true);
    menu.click();
    expect(app.classList.contains('panel-open')).toBe(false);

    // Play a move in chess, then reset from the menu.
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();

    const map = getMap(800);
    const game = getChess();
    if (!game) throw new Error('chess mode did not start');
    const pawn = game.pieces.find(
      (piece) =>
        piece.side === 0 &&
        piece.kind === 'pawn' &&
        map.mask[piece.cell + 1] === '#' &&
        !game.pieces.some((other) => other.cell === piece.cell + 1),
    );
    if (!pawn) throw new Error('no pawn with a free cell ahead');
    const from = cellCentre(map.cols, map.rows, pawn.cell);
    const to = cellCentre(map.cols, map.rows, pawn.cell + 1);
    clickCell(from.x, from.y);
    clickCell(to.x, to.y);
    expect(getChess()?.turn).toBe(1);

    const newGame = document.querySelector('.panel-primary .button') as HTMLButtonElement;
    expect(newGame?.textContent).toBe('New game');
    newGame.click();
    const confirm = document.querySelector('.dialog .button-danger') as HTMLButtonElement;
    confirm.click();
    await Promise.resolve();
    flushFrames();

    const fresh = getChess();
    expect(fresh?.turn).toBe(0);
    expect(fresh?.round).toBe(0);
    expect(fresh?.pieces.find((p) => p.id === pawn.id)?.cell).toBe(pawn.cell);
  });

  it('shows where the selected piece may go', async () => {
    const { getChess, getHints } = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();
    expect(getHints()).toHaveLength(0);

    const map = getMap(800);
    const game = getChess();
    if (!game) throw new Error('chess mode did not start');
    const pawn = game.pieces.find(
      (piece) =>
        piece.side === 0 &&
        piece.kind === 'pawn' &&
        map.mask[piece.cell + 1] === '#' &&
        !game.pieces.some((other) => other.cell === piece.cell + 1),
    );
    if (!pawn) throw new Error('no pawn with a free cell ahead');

    const at = cellCentre(map.cols, map.rows, pawn.cell);
    clickCell(at.x, at.y);

    const hints = getHints();
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.map((hint) => hint.cell)).toContain(pawn.cell + 1);
    expect(hints.every((hint) => hint.kind === 'move' || hint.kind === 'capture')).toBe(true);

    // Clicking the same piece again lets it go, and the hints with it.
    clickCell(at.x, at.y);
    expect(getHints()).toHaveLength(0);
  });

  it('moves the camera to the side whose turn it is', async () => {
    const { getChess, getFocus } = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();
    expect(getFocus()).toBeNull();

    const map = getMap(800);
    const game = getChess();
    if (!game) throw new Error('chess mode did not start');
    const pawn = game.pieces.find(
      (piece) => piece.side === 0 && piece.kind === 'pawn' && map.mask[piece.cell + 1] === '#',
    );
    const blackKing = game.pieces.find((piece) => piece.side === 1 && piece.kind === 'king');
    if (!pawn || !blackKing) throw new Error('no pawn or king');

    const from = cellCentre(map.cols, map.rows, pawn.cell);
    const to = cellCentre(map.cols, map.rows, pawn.cell + 1);
    clickCell(from.x, from.y);
    clickCell(to.x, to.y);

    // Black now has the move, so the view is sent to Black's king.
    expect(getChess()?.turn).toBe(1);
    expect(getFocus()).toBe(blackKing.cell);
  });

  it('says whose turn it is exactly once', async () => {
    const { getChess } = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();

    const marked = (): (string | null | undefined)[] =>
      [...document.querySelectorAll('.stat.to-move')].map(
        (node) => node.querySelector('.stat-label')?.textContent,
      );

    expect(marked()).toEqual(['White']);
    // The duplicate turn lines are gone: nothing claims both sides are to move.
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('to move');

    // Play a pawn two squares, and the marker moves to the other side.
    const map = getMap(800);
    const game = getChess();
    if (!game) throw new Error('chess mode did not start');
    const pawn = game.pieces.find(
      (piece) => piece.side === 0 && piece.kind === 'pawn' && map.mask[piece.cell + 2] === '#',
    );
    if (!pawn) throw new Error('no pawn with two free squares');
    const from = cellCentre(map.cols, map.rows, pawn.cell);
    const to = cellCentre(map.cols, map.rows, pawn.cell + 2);
    clickCell(from.x, from.y);
    clickCell(to.x, to.y);

    expect(getChess()?.turn).toBe(1);
    expect(marked()).toEqual(['Black']);
  });

  it('shows where the king could build when the build action is armed', async () => {
    const { getHints } = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();

    const build = document.querySelector('.build-bar .button') as HTMLButtonElement;
    expect(build?.textContent).toBe(`Tower · ${BALANCE.chess.towerCost}`);
    // The bar lives over the board, and the settings sheet no longer carries it.
    expect(document.querySelector('.panel-actions .build-action')).toBeNull();
    expect(document.querySelector('.build-bar')?.classList.contains('hidden')).toBe(false);
    build.click();
    flushFrames();

    const hints = getHints();
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((hint) => hint.kind === 'build')).toBe(true);
  });

  it('arms the pawn recruit on your own tower', async () => {
    // Seeded rather than played: a tower now costs more than a side starts with,
    // so the position is written straight into the save.
    const map = getMap(800);
    const base = createChessGame(800, 7, {
      isLand: (cell) => map.mask[cell] === '#',
      elev: map.elev,
      rows: map.rows,
      cols: map.cols,
      cellCount: map.mask.length,
    });
    const taken = new Set(base.pieces.map((piece) => piece.cell));
    const freeNeighbour = (cell: number): number => {
      const col = cell % map.cols;
      const row = Math.floor(cell / map.cols);
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = (row + dr) * map.cols + (col + dc);
        if (map.mask[next] === '#' && !taken.has(next)) return next;
      }
      throw new Error('the king is boxed in');
    };
    const kingOf = (side: 0 | 1): number => {
      const king = base.pieces.find((piece) => piece.side === side && piece.kind === 'king');
      if (!king) throw new Error('no king');
      return king.cell;
    };
    const whiteTower = freeNeighbour(kingOf(0));
    const blackTower = freeNeighbour(kingOf(1));
    saveChessGame(localStorage, {
      ...base,
      coins: [BALANCE.chess.pawnCost, BALANCE.chess.pawnCost],
      towers: { [String(whiteTower)]: 0, [String(blackTower)]: 1 },
    });
    localStorage.setItem('eurasia.settings.v2', JSON.stringify({ mode: 'chess', size: 800 }));

    const { getChess, getHints } = await boot();
    flushFrames();

    const buttons = [...document.querySelectorAll('.build-bar .button')] as HTMLButtonElement[];
    const recruit = buttons.find((button) => button.textContent?.startsWith('Pawn · '));
    if (!recruit) throw new Error('the recruit action is missing');
    expect(recruit.textContent).toBe(`Pawn · ${BALANCE.chess.pawnCost}`);
    expect(getChess()?.towers[String(whiteTower)]).toBe(0);
    expect(getChess()?.towers[String(blackTower)]).toBe(1);

    // Both wallets show their own income: one tower each, so the same figure
    // twice. The mobile rule keys off these two classes, so they are pinned here.
    const perTurn = BALANCE.chess.coinsPerRound + BALANCE.chess.towerIncome;
    const incomes = [...document.querySelectorAll('.stat .stat-value')]
      .map((node) => node.textContent ?? '')
      .filter((text) => text.endsWith('/ turn'));
    expect(incomes).toHaveLength(2);
    expect(incomes).toEqual([`+${perTurn} / turn`, `+${perTurn} / turn`]);
    expect(document.querySelector('.app')?.classList.contains('chess')).toBe(true);
    expect(document.querySelector('.stats')?.classList.contains('multi')).toBe(true);

    recruit.click();
    flushFrames();

    const hints = getHints();
    // Only your own tower, and only the one of them: the enemy's is not yours.
    expect(hints).toEqual([{ cell: whiteTower, kind: 'recruit' }]);
  });

  it('offers the rocket base and aims it at enemy pieces in range', async () => {
    const map = getMap(800);
    const base = createChessGame(800, 11, {
      isLand: (cell) => map.mask[cell] === '#',
      elev: map.elev,
      rows: map.rows,
      cols: map.cols,
      cellCount: map.mask.length,
    });
    const taken = new Set(base.pieces.map((piece) => piece.cell));
    const freeNeighbour = (cell: number): number => {
      const col = cell % map.cols;
      const row = Math.floor(cell / map.cols);
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = (row + dr) * map.cols + (col + dc);
        if (map.mask[next] === '#' && !taken.has(next)) return next;
      }
      throw new Error('the king is boxed in');
    };
    const whiteKing = base.pieces.find((piece) => piece.side === 0 && piece.kind === 'king');
    if (!whiteKing) throw new Error('no white king');
    const rocketCell = freeNeighbour(whiteKing.cell);

    // One enemy close enough to shoot at: the two camps are a continent apart,
    // so a rocket in Europe has nothing of Black's within seven cells.
    const row = Math.floor(rocketCell / map.cols);
    const col = rocketCell % map.cols;
    let quarry = -1;
    for (let step = 2; step <= 5 && quarry < 0; step++) {
      const next = row * map.cols + (col + step);
      if (col + step < map.cols && map.mask[next] === '#' && !taken.has(next)) quarry = next;
    }
    if (quarry < 0) throw new Error('no room for a target');

    saveChessGame(localStorage, {
      ...base,
      coins: [0, 0],
      rockets: { [String(rocketCell)]: 0 },
      pieces: [
        ...base.pieces,
        { id: 900, side: 1, kind: 'rook', cell: quarry, promoted: false, moved: true },
      ],
    });
    localStorage.setItem('eurasia.settings.v2', JSON.stringify({ mode: 'chess', size: 800 }));

    const { getChess, getHints, getZone } = await boot();
    flushFrames();

    const labels = [...document.querySelectorAll('.build-bar .button')].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual([
      `Tower · ${BALANCE.chess.towerCost}`,
      `Rocket · ${BALANCE.chess.rocketCost}`,
      `Pawn · ${BALANCE.chess.pawnCost}`,
      `Fire · ${BALANCE.chess.rocketShotCost}`,
    ]);

    const fire = [...document.querySelectorAll('.build-bar .button')].find((button) =>
      button.textContent?.startsWith('Fire · '),
    ) as HTMLButtonElement;
    const game = getChess();
    if (!game) throw new Error('chess mode did not start');
    const inRange = new Set(
      game.pieces
        .filter((piece) => piece.side === 1)
        .filter((piece) => {
          const a = { row: Math.floor(rocketCell / map.cols), col: rocketCell % map.cols };
          const b = { row: Math.floor(piece.cell / map.cols), col: piece.cell % map.cols };
          return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col)) <= 7;
        })
        .map((piece) => piece.cell),
    );

    fire.click();
    flushFrames();

    const hints = getHints();
    // Every piece in reach is offered, its own side's included: a rocket does not
    // check uniforms, so the list is "what could die here", not "what is hostile".
    expect(hints.every((hint) => hint.kind === 'fire')).toBe(true);
    expect(hints.map((hint) => hint.cell)).toContain(quarry);
    // A hint is "something can die here": a piece, a tower or a base.
    const occupied = new Set([
      ...game.pieces.map((piece) => piece.cell),
      ...Object.keys(game.towers).map(Number),
      ...Object.keys(game.rockets).map(Number),
    ]);
    for (const hint of hints) expect(occupied.has(hint.cell)).toBe(true);
    expect(hints.length).toBeGreaterThan(1);
    expect(inRange.has(quarry)).toBe(true);

    // The blast area follows the pointer: nine tiles, the middle one the good shot.
    const middle = 12 * map.cols + 20;
    const at = cellCentre(map.cols, map.rows, middle);
    document.querySelector('canvas')?.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: at.x,
        clientY: at.y,
        pointerType: 'mouse',
        bubbles: true,
      }),
    );
    flushFrames();

    const zone = getZone();
    expect(zone).toHaveLength(9);
    expect(zone.filter((tile) => tile.chance === BALANCE.chess.rocketCentreChance)).toHaveLength(1);
    expect(zone.find((tile) => tile.chance === BALANCE.chess.rocketCentreChance)?.cell).toBe(
      middle,
    );
  });

  it('fires only on the second tap at the same cell', async () => {
    const map = getMap(800);
    const base = createChessGame(800, 13, {
      isLand: (cell) => map.mask[cell] === '#',
      elev: map.elev,
      rows: map.rows,
      cols: map.cols,
      cellCount: map.mask.length,
    });
    const taken = new Set(base.pieces.map((piece) => piece.cell));
    const freeNeighbour = (cell: number): number => {
      const col = cell % map.cols;
      const row = Math.floor(cell / map.cols);
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = (row + dr) * map.cols + (col + dc);
        if (map.mask[next] === '#' && !taken.has(next)) return next;
      }
      throw new Error('the king is boxed in');
    };
    const whiteKing = base.pieces.find((piece) => piece.side === 0 && piece.kind === 'king');
    if (!whiteKing) throw new Error('no white king');
    const rocketCell = freeNeighbour(whiteKing.cell);

    const row = Math.floor(rocketCell / map.cols);
    const col = rocketCell % map.cols;
    let quarry = -1;
    for (let step = 2; step <= 5 && quarry < 0; step++) {
      const next = row * map.cols + (col + step);
      if (col + step < map.cols && map.mask[next] === '#' && !taken.has(next)) quarry = next;
    }
    if (quarry < 0) throw new Error('no room for a target');

    saveChessGame(localStorage, {
      ...base,
      coins: [BALANCE.chess.rocketShotCost * 2, 0],
      rockets: { [String(rocketCell)]: 0 },
      pieces: [
        ...base.pieces,
        { id: 900, side: 1, kind: 'rook', cell: quarry, promoted: false, moved: true },
      ],
    });
    localStorage.setItem('eurasia.settings.v2', JSON.stringify({ mode: 'chess', size: 800 }));

    const { getChess, getZone, getBlast } = await boot();
    flushFrames();

    const fire = [...document.querySelectorAll('.build-bar .button')].find((button) =>
      button.textContent?.startsWith('Fire · '),
    ) as HTMLButtonElement;
    fire.click();
    flushFrames();

    expect(getBlast()).toHaveLength(0);

    const at = cellCentre(map.cols, map.rows, quarry);
    clickCell(at.x, at.y);

    // First tap: the zone is shown, nothing is paid, the turn has not moved.
    expect(getZone().length).toBeGreaterThan(0);
    expect(getChess()?.coins[0]).toBe(BALANCE.chess.rocketShotCost * 2);
    expect(getChess()?.turn).toBe(0);

    // Second tap on the same cell: the rockets go.
    clickCell(at.x, at.y);
    expect(getChess()?.coins[0]).toBe(BALANCE.chess.rocketShotCost);
    expect(getChess()?.turn).toBe(1);

    // And the explosion is played over the zone that was hit.
    const blast = getBlast();
    expect(blast).toHaveLength(9);
    expect(blast.find((tile) => tile.chance === BALANCE.chess.rocketCentreChance)?.cell).toBe(
      quarry,
    );
  });

  it('recovers after a refused shot instead of swallowing the next tap', async () => {
    const { getChess, getHints } = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();

    const fire = [...document.querySelectorAll('.build-bar .button')].find((button) =>
      button.textContent?.startsWith('Fire · '),
    ) as HTMLButtonElement;
    fire.click();
    flushFrames();
    expect(fire.classList.contains('armed')).toBe(true);

    // There is no base yet: the first tap only shows the zone, the second asks the
    // engine — which refuses, and the mode lets go instead of turning every later
    // tap into another refused shot.
    const map = getMap(800);
    const game = getChess();
    const target = game?.pieces.find((piece) => piece.side === 1 && piece.kind === 'pawn');
    if (!target) throw new Error('no black pawn');
    const at = cellCentre(map.cols, map.rows, target.cell);
    clickCell(at.x, at.y);
    expect(fire.classList.contains('armed')).toBe(true);
    clickCell(at.x, at.y);

    expect(fire.classList.contains('armed')).toBe(false);

    // The next tap is a normal selection again.
    const mine = game?.pieces.find((piece) => piece.side === 0 && piece.kind === 'pawn');
    if (!mine) throw new Error('no white pawn');
    const own = cellCentre(map.cols, map.rows, mine.cell);
    clickCell(own.x, own.y);

    const hints = getHints();
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((hint) => hint.kind === 'move' || hint.kind === 'capture')).toBe(true);
  });

  it('refuses a tower when the side cannot pay for one', async () => {
    const { getChess, getHints } = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();

    const game = getChess();
    if (!game) throw new Error('chess mode did not start');
    expect(game.coins[0]).toBe(BALANCE.chess.startCoins);
    expect(BALANCE.chess.startCoins).toBeLessThan(BALANCE.chess.towerCost);

    const build = document.querySelector('.build-bar .button') as HTMLButtonElement;
    build.click();
    const spot = getHints()[0];
    if (!spot) throw new Error('no build spot to try');
    const map = getMap(800);
    const at = cellCentre(map.cols, map.rows, spot.cell);
    clickCell(at.x, at.y);

    // The turn is not spent and nothing is built: the wallet is simply too small.
    expect(getChess()?.towers[String(spot.cell)]).toBeUndefined();
    expect(getChess()?.coins[0]).toBe(BALANCE.chess.startCoins);
    expect(getChess()?.turn).toBe(0);
  });

  it('does not claim a building cell when Enter is pressed in chess', async () => {
    const { getChess, getState } = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();
    expect(getChess()).not.toBeNull();

    const canvas = document.querySelector('canvas');
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushFrames();

    // The building game is behind the board and must stay untouched.
    expect(getState().claimed[0]).toBe(0);
    expect(getState().coins[0]).toBe(BALANCE.claim.startCoins);
  });

  it('resumes the chess game after a reload', async () => {
    const first = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();

    const map = getMap(800);
    const game = first.getChess();
    if (!game) throw new Error('chess mode did not start');
    const pawn = game.pieces.find(
      (piece) =>
        piece.side === 0 &&
        piece.kind === 'pawn' &&
        map.mask[piece.cell + 1] === '#' &&
        !game.pieces.some((other) => other.cell === piece.cell + 1),
    );
    if (!pawn) throw new Error('no pawn with a free cell ahead');
    const from = cellCentre(map.cols, map.rows, pawn.cell);
    const to = cellCentre(map.cols, map.rows, pawn.cell + 1);
    clickCell(from.x, from.y);
    clickCell(to.x, to.y);

    const played = first.getChess();
    expect(played?.turn).toBe(1);

    // A reload is a fresh module with the same storage.
    const second = await boot();
    const resumed = second.getChess();
    expect(resumed).not.toBeNull();
    expect(resumed?.turn).toBe(1);
    expect(resumed?.round).toBe(played?.round);
    expect(resumed?.pieces.map((p) => [p.id, p.cell])).toEqual(
      played?.pieces.map((p) => [p.id, p.cell]),
    );
  });

  it('moves a chess piece by clicking it and then its destination', async () => {
    const { getChess } = await boot();
    const chessButton = [...document.querySelectorAll('.segmented button')].find(
      (button) => button.textContent === 'Chess',
    ) as HTMLButtonElement;
    chessButton.click();
    flushFrames();

    // Chess is played on the 800-cell board whatever the building game uses.
    const map = getMap(800);
    const game = getChess();
    if (!game) throw new Error('chess mode did not start');
    const pawn = game.pieces.find(
      (piece) =>
        piece.side === 0 &&
        piece.kind === 'pawn' &&
        map.mask[piece.cell + 1] === '#' &&
        !game.pieces.some((other) => other.cell === piece.cell + 1),
    );
    if (!pawn) throw new Error('no pawn with a free cell ahead');

    const from = cellCentre(map.cols, map.rows, pawn.cell);
    const to = cellCentre(map.cols, map.rows, pawn.cell + 1);
    clickCell(from.x, from.y);
    clickCell(to.x, to.y);

    const after = getChess();
    expect(after?.pieces.find((p) => p.id === pawn.id)?.cell).toBe(pawn.cell + 1);
    expect(after?.turn).toBe(1);
  });

  it('claims a cell on Enter, and refuses to demolish the king square', async () => {
    const { getState } = await boot();
    const canvas = document.querySelector('canvas');

    // No capital yet, so the flat view draws no king marker.
    expect(drawCalls).not.toContain('arc');
    expect(getState().coins[0]).toBe(BALANCE.claim.startCoins);
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushFrames();

    const afterClaim = getState();
    // The first claim places the king, and the flat view marks it with an arc.
    expect(drawCalls).toContain('arc');
    expect(afterClaim.claimed[0]).toBe(1);
    expect(afterClaim.coins[0]).toBe(BALANCE.claim.startCoins - BALANCE.claim.cost);
    expect(afterClaim.kings[0]).toBeGreaterThanOrEqual(0);

    // The king stands on the cell it just built: no second press, no refund.
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushFrames();
    expect(getState().claimed[0]).toBe(1);
    expect(getState().coins[0]).toBe(BALANCE.claim.startCoins - BALANCE.claim.cost);
    expect(document.querySelector('.status')?.textContent).toContain('king is standing here');
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
    expect(second.getState().coins[0]).toBe(BALANCE.claim.startCoins - BALANCE.claim.cost);
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
