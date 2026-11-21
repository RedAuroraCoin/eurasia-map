import {
  BALANCE,
  MAP_CONFIG,
  SAVE_VERSION,
  createInitialState,
  dayIndex,
  getMap,
  hash01,
  isKingMove,
  nextStormGap,
  planStorm,
  reduce,
  stormCells,
  type StormPlan,
  type GameState,
  type GameEvent,
  type MapSize,
} from '@eurasia/shared';
import { t } from './i18n';
import { lightingAt, timeOfDayFromDate } from './render/palette';
import { createView, type View } from './render/view';
import { browserStorage, clearSave, loadSave, saveState } from './state/save';
import { advance, clockFor } from './state/clock';
import { loadSettings, saveSettings, speedMultiplier, type Settings } from './state/settings';
import { MultiplayerClient, createInvite, parseRoomFromUrl } from './multiplayer/client';
import {
  chessReduce,
  createChessGame,
  type ChessErrorCode,
  type ChessState,
} from '@eurasia/shared';
import type { UnitInstance } from './render/pieces';
import { App, type AppHandlers } from './ui/app';

/**
 * Single-player wiring: the engine decides, the view draws, this file is the
 * only place that knows about both — plus storage, input and the clock.
 */

/** Demo mode runs the world at one day per second. */
const DEMO_SPEED = 86_400;

const storage = browserStorage();
let settings = loadSettings(storage);
let map = getMap(settings.size);
let state: GameState;
let demo = false;
let demoState: GameState | null = null;

/**
 * Time the player has fast-forwarded past the real clock. Not saved: the save
 * carries `lastDay`, and `clockFor` resumes from it, so a reload never rewinds.
 */
let extraTime = 0;
/** Last world day the simulation settled, so a fast clock settles per day, not per minute. */
let lastWorldDay = Number.NEGATIVE_INFINITY;
let lastLighting = -1;

// ---------------------------------------------------------------- chess mode
let chess: ChessState | null = null;
let chessSelected: number | null = null;
let chessBuild = false;
let selected = 0;
let saveTimer = 0;

/**
 * Multiplayer is opt-in through the URL: `?room=CODE`. When a room is present
 * the server owns the state — this module stops reducing, stops ticking and
 * stops saving, and only sends intents and draws what comes back.
 */
const roomCode = parseRoomFromUrl();
let mp: MultiplayerClient | null = null;
let seat: 0 | 1 = 0;

/**
 * Rooms live in a Worker. The static GitHub Pages build has no `/api`, so the
 * invite button has to say that rather than navigate into a dead room.
 */
let roomsAvailable = true;
void fetch('/api/health', { method: 'GET' })
  .then((response) => {
    roomsAvailable = response.ok;
  })
  .catch(() => {
    roomsAvailable = false;
  });

// Handlers are declared before the app because the constructor wires them up;
// everything they close over (`app`, `view`) exists by the time one is called.
const handlers: AppHandlers = {
  onSize: (size) => {
    if (mp) {
      app.setMessage(t.messages.roomSizeLocked, 'error');
      return;
    }
    switchSize(size);
  },
  onTheme: (theme) => {
    settings = { ...settings, theme };
    saveSettings(storage, settings);
    applyTheme();
  },
  onQuality: (quality) => {
    settings = { ...settings, quality };
    saveSettings(storage, settings);
    view.setQuality(resolveQuality(settings));
  },
  onRelief: (relief) => {
    settings = { ...settings, relief };
    saveSettings(storage, settings);
    view.setRelief(relief);
    view.setState(active(), Date.now());
    app.setSettings(settings, demo);
  },
  onDayNight: (dayNight) => {
    settings = { ...settings, dayNight };
    saveSettings(storage, settings);
    lastLighting = -1;
    applyLighting(true);
  },
  onHurricanes: (hurricanes) => {
    settings = { ...settings, hurricanes };
    saveSettings(storage, settings);
    app.setSettings(settings, demo);
  },
  onFlood: (flood) => {
    settings = { ...settings, flood };
    saveSettings(storage, settings);
    app.setSettings(settings, demo);
  },
  onSpeed: (speed) => {
    settings = { ...settings, speed };
    saveSettings(storage, settings);
    app.setSettings(settings, demo);
  },
  onMode: (mode) => {
    settings = { ...settings, mode };
    saveSettings(storage, settings);
    app.setSettings(settings, demo);
    if (mode === 'chess') startChess();
    else leaveChess();
  },
  onBuild: () => {
    if (!chess) return;
    chessBuild = !chessBuild;
    app.setBuildActive(chessBuild);
    app.setMessage(chessBuild ? t.chess.building : t.chess.build, 'info');
  },
  onSides: (both) => {
    settings = { ...settings, sides: both ? 'both' : 'one' };
    saveSettings(storage, settings);
    view.setSidePreview(both);
    app.setSettings(settings, demo);
  },
  onInvite: () => {
    if (mp) return;
    if (!roomsAvailable) {
      app.setMessage(t.messages.roomsUnavailable, 'error');
      return;
    }
    const { url } = createInvite();
    location.assign(url);
  },
  onDemo: () => {
    if (mp) {
      app.setMessage(t.messages.roomSizeLocked, 'error');
      return;
    }
    toggleDemo();
  },
  onReset: () => {
    if (mp) {
      app.setMessage(t.messages.roomSizeLocked, 'error');
      return;
    }
    if (settings.mode === 'chess') {
      startChess();
      return;
    }
    void reset();
  },
};

const app = new App(settings, handlers);
const root = document.querySelector<HTMLDivElement>('#app') ?? document.body;
app.mount(root);

/**
 * Two sides is a display switch, not a rule: it alternates the owner of the
 * claimed cells so both castle designs can be seen before two-player mode
 * exists. It changes nothing in the engine, the wallet or the save.
 * `?castles=both` forces it on for a shared link; the panel toggle persists.
 */
const sidePreview =
  settings.sides === 'both' || new URLSearchParams(location.search).get('castles') === 'both';
const { view, mode } = createView(
  app.canvas,
  map,
  settings.relief,
  resolveQuality(settings),
  sidePreview,
);
if (mode === '2d') app.setMessage(t.messages.noWebgl, 'info');
view.resize();

// --------------------------------------------------------------------- state

const active = (): GameState => (demo ? (demoState ?? state) : state);

/**
 * The clock the world runs on. Speed moves income, growth and the sea together:
 * `reduce` is handed this, not `Date.now()`, so an accelerated day is a real
 * settled day and not just faster animation.
 */
const clock = (): number => clockFor(Date.now(), extraTime, active().lastDay);

const ctx = () => ({
  nowMs: clock(),
  isLand: (index: number) => map.mask[index] === '#',
  cellCount: map.rows * map.cols,
  cols: map.cols,
  elev: map.elev,
  flood: settings.flood,
});

function nextSeed(): number {
  const buffer = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buffer);
  }
  return (buffer[0] ?? Date.now()) >>> 0;
}

function firstLand(): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const centreCol = map.cols / 2;
  const centreRow = map.rows / 2;
  for (let index = 0; index < map.mask.length; index++) {
    if (map.mask[index] !== '#') continue;
    const col = index % map.cols;
    const row = Math.floor(index / map.cols);
    const distance = Math.hypot(col - centreCol, row - centreRow);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function updateStats(): void {
  const current = active();
  const perCell = BALANCE.income.perCellPerDay;
  app.updateSea(current.seaLevel);
  if (mp) {
    app.updateMultiStats(
      current.coins[0],
      current.claimed[0] * perCell,
      current.claimed[0],
      current.coins[1],
      current.claimed[1] * perCell,
      current.claimed[1],
      t.messages.you,
      t.messages.opponent,
    );
    return;
  }
  app.updateStats(current.coins[0], current.claimed[0] * perCell, current.claimed[0], map.land);
}

function describeError(code: string): string {
  switch (code) {
    case 'no_coins':
      return t.messages.noCoins(BALANCE.claim.cost, active().coins[0]);
    case 'sea':
      return t.messages.sea;
    case 'flooded':
      return t.messages.flooded;
    case 'taken':
    case 'already_owned':
      return t.messages.taken;
    case 'not_adjacent':
      return t.messages.notAdjacent;
    case 'king_unplaced':
      return t.messages.needKing;
    case 'king_cell':
      return t.messages.kingCell;
    default:
      return t.messages.failed;
  }
}

function toggleCell(index: number, demolish = false): void {
  if (demo) {
    app.setMessage(t.messages.demo, 'info');
    return;
  }
  if (index < 0 || index >= map.rows * map.cols) return;

  // In a room the server decides: send the intent, draw only what comes back.
  if (mp) {
    const owned = state.cells[String(index)] !== undefined;
    if (owned && !demolish) mp.move(index);
    else if (owned) mp.unclaim(index);
    else mp.claim(index);
    selected = index;
    view.setSelected(index);
    return;
  }

  const owned = state.cells[String(index)] !== undefined;
  const king = state.kings[0];
  // Shift demolishes from anywhere; a plain click on your own cell next to the
  // king steps there instead, because that is the move you will want far more often.
  const stepping = owned && !demolish && isKingMove(king, index, ctx());
  const command = stepping
    ? ({ k: 'move', cell: index, slot: 0 } as const)
    : owned
      ? ({ k: 'unclaim', cell: index, slot: 0 } as const)
      : ({ k: 'claim', cell: index, slot: 0 } as const);

  const result = reduce(state, command, ctx());
  if (!result.ok) {
    app.setMessage(describeError(result.code), 'error');
    return;
  }

  state = result.state;
  selected = index;
  view.setSelected(index);
  view.setState(state, Date.now());
  updateStats();
  scheduleSave();

  for (const change of result.events) {
    if (change.t === 'claimed') app.setMessage(t.messages.claimed(change.cost), 'good');
    if (change.t === 'unclaimed') app.setMessage(t.messages.unclaimed(change.refund), 'good');
    if (change.t === 'moved') app.setMessage(t.messages.moved, 'info');
  }
}

/** Credits income for the days that passed while the player was away. */
function settle(): void {
  if (demo || mp) return;
  const result = reduce(state, { k: 'tick' }, ctx());
  if (result.state === state) return;

  state = result.state;
  view.setState(state, clock());
  updateStats();
  scheduleSave();

  const flood = result.events.find((event) => event.t === 'flood');
  if (flood && flood.t === 'flood') {
    app.setMessage(
      t.messages.flood(flood.level, flood.destroyed),
      flood.destroyed > 0 ? 'error' : 'info',
    );
  }

  const income = result.events.find((event) => event.t === 'income');
  if (income && income.t === 'income') {
    app.setMessage(t.messages.income(income.amount, income.days), 'good');
  }
}

function scheduleSave(): void {
  if (demo || mp) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 250);
}

function saveNow(): void {
  if (demo || mp) return;
  clearTimeout(saveTimer);
  // The board the state belongs to, not the setting: chess swaps the map without
  // touching the preference, and the two must not be written over each other.
  saveState(storage, state, Date.now(), map.land);
}

/**
 * Swaps the board. `remember` is false when the switch belongs to a mode rather
 * than to the player: chess is 800 cells only, and the player's building map
 * must be waiting when they switch back.
 */
function switchSize(size: MapSize, remember = true): void {
  if (remember && size === settings.size) return;
  saveNow();

  if (remember) {
    settings = { ...settings, size };
    saveSettings(storage, settings);
  }
  map = getMap(size);

  const loaded = loadSave(storage, size);
  state = loaded.ok ? loaded.state : createInitialState(nextSeed(), Date.now());
  selected = firstLand();

  view.setMap(map);
  view.setSelected(selected);
  view.setState(state, Date.now());
  updateStats();
  app.setSettings(settings, demo);
  app.setMessage(loaded.ok ? t.messages.loaded(state.claimed[0]) : t.hud.hint, 'info');
}

function buildDemoState(): GameState {
  const now = Date.now();
  const cells: Record<string, { o: 0 | 1; t: number; hp: number }> = {};
  let claimed = 0;
  let first = -1;
  for (let index = 0; index < map.mask.length; index++) {
    if (map.mask[index] !== '#') continue;
    cells[String(index)] = {
      o: 0,
      t: now - 40 * BALANCE.time.msPerDay,
      hp: BALANCE.hurricane.cellHp,
    };
    if (first < 0) first = index;
    claimed++;
  }
  return {
    v: SAVE_VERSION,
    seed: 1,
    cells,
    seaLevel: BALANCE.flood.startLevel,
    coins: [0, 0],
    claimed: [claimed, 0],
    lastDay: dayIndex(now),
    kings: [first, -1],
  };
}

function toggleDemo(): void {
  demo = !demo;
  if (demo) {
    demoState = buildDemoState();
    extraTime = 0;
    lastLighting = -1;
  }
  app.setSettings(settings, demo);
  view.setState(active(), Date.now());
  updateStats();
  app.setMessage(demo ? t.messages.demo : t.messages.demoOff, 'info');
}

async function reset(): Promise<void> {
  const confirmed = await app.askReset();
  if (!confirmed) return;

  clearSave(storage, map.land);
  state = createInitialState(nextSeed(), Date.now());
  demo = false;
  demoState = null;
  selected = firstLand();

  app.setSettings(settings, false);
  view.setSelected(selected);
  view.setState(state, Date.now());
  updateStats();
  app.setMessage(t.messages.reset, 'good');
}

// ------------------------------------------------------------------ visuals

function applyTheme(): void {
  const element = document.documentElement;
  if (settings.theme === 'auto') delete element.dataset.theme;
  else element.dataset.theme = settings.theme;
}

function applyLighting(force = false): void {
  const timeOfDay =
    settings.dayNight === 'day'
      ? 0.45
      : settings.dayNight === 'night'
        ? 0.02
        : timeOfDayFromDate(new Date(clock()));

  if (!force && Math.abs(timeOfDay - lastLighting) < 0.0008) return;
  lastLighting = timeOfDay;
  view.setLighting(lightingAt(timeOfDay));
}

function resolveQuality(current: Settings): 'high' | 'low' {
  if (current.quality !== 'auto') return current.quality;
  const cores = navigator.hardwareConcurrency || 4;
  const ratio = window.devicePixelRatio || 1;
  return cores >= 4 && ratio <= 2.2 ? 'high' : 'low';
}

// -------------------------------------------------------------------- chess

/** Row whose centre sits at this latitude. Row 0 is the northern edge. */
function rowForLat(lat: number): number {
  const { lat0, lat1 } = MAP_CONFIG.bbox;
  const t = (lat1 - lat) / (lat1 - lat0);
  return Math.round(t * (map.rows - 1));
}

/**
 * The bands the armies camp in: white in Europe, black in East Asia. The engine
 * has no geography, so the latitude is resolved to rows here.
 */
function campRows(): readonly (readonly [number, number])[] {
  const band = (pair: readonly [number, number]): readonly [number, number] => [
    rowForLat(pair[1]),
    rowForLat(pair[0]),
  ];
  return [band(BALANCE.chess.campLat.white), band(BALANCE.chess.campLat.black)];
}

/** Column whose centre sits at this longitude. Column 0 is the western edge. */
function colForLon(lon: number): number {
  const { lon0, lon1 } = MAP_CONFIG.bbox;
  return Math.round(((lon - lon0) / (lon1 - lon0)) * (map.cols - 1));
}

function campCols(): readonly (readonly [number, number])[] {
  const band = (pair: readonly [number, number]): readonly [number, number] => [
    colForLon(pair[0]),
    colForLon(pair[1]),
  ];
  return [band(BALANCE.chess.campLon.white), band(BALANCE.chess.campLon.black)];
}

const chessCtx = () => ({
  isLand: (index: number) => map.mask[index] === '#',
  elev: map.elev,
  rows: map.rows,
  cols: map.cols,
  cellCount: map.rows * map.cols,
  campRows: campRows(),
  campCols: campCols(),
});

const unitsOf = (game: ChessState): UnitInstance[] => {
  const out: UnitInstance[] = game.pieces.map((piece) => ({
    id: piece.id,
    role: piece.kind,
    side: piece.side,
    cell: piece.cell,
  }));
  Object.entries(game.towers).forEach(([cell, side], index) => {
    out.push({ id: 10_000 + index, role: 'tower', side, cell: Number(cell) });
  });
  return out;
};

/** The 3D view draws buildings from a GameState; chess has none, only the sea. */
const chessView = (): GameState => ({
  ...state,
  cells: {},
  claimed: [0, 0],
  kings: [-1, -1],
  seaLevel: chess?.seaLevel ?? state.seaLevel,
});

function syncChess(): void {
  if (!chess) return;
  view.setState(chessView(), clock());
  view.setUnits(unitsOf(chess));
  app.updateChess({
    turn: chess.turn,
    round: chess.round,
    coins: chess.coins,
    seaLevel: chess.seaLevel,
    winner: chess.winner,
  });
}

function describeChessError(code: ChessErrorCode): string {
  switch (code) {
    case 'no_coins':
      return t.chess.noCoins(BALANCE.chess.towerCost);
    case 'not_yours':
      return t.chess.notYours;
    case 'over':
      return 'Game over';
    default:
      return t.chess.illegal;
  }
}

function applyChess(result: ReturnType<typeof chessReduce>): void {
  if (!result.ok) {
    app.setMessage(describeChessError(result.code), 'error');
    return;
  }
  chess = result.state;
  for (const event of result.events) {
    if (event.t === 'captured') app.setMessage(t.messages.taken, 'info');
    if (event.t === 'built') app.setMessage(t.chess.built, 'good');
    if (event.t === 'drowned') app.setMessage(t.chess.drowned(event.pieces), 'error');
    if (event.t === 'won') {
      app.setMessage(
        t.chess.won(event.side === 0 ? t.chess.white : t.chess.black, event.how),
        'good',
      );
    }
  }
  chessBuild = false;
  app.setBuildActive(false);
  syncChess();
}

const CHESS_SIZE: MapSize = 800;

function startChess(): void {
  if (mp) return;
  // The turn-based mode is played on one board size, so the size is not a choice
  // there: switch to it without touching the building game's saved preference.
  if (map.land !== CHESS_SIZE) switchSize(CHESS_SIZE, false);
  chess = createChessGame(CHESS_SIZE, nextSeed(), chessCtx());
  chessSelected = null;
  chessBuild = false;
  app.setChessMode(true);
  app.setBuildActive(false);
  view.setUnits(unitsOf(chess));
  syncChess();
}

function leaveChess(): void {
  chess = null;
  chessSelected = null;
  chessBuild = false;
  app.setChessMode(false);
  app.setBuildActive(false);
  view.setUnits([]);
  // Back to whatever map the building game was playing before chess.
  if (map.land !== settings.size) switchSize(settings.size, false);
  view.setState(state, clock());
  updateStats();
}

/** One click: pick a piece, then a destination — or place a tower when armed. */
function chessClick(cell: number): void {
  if (!chess || mp) return;
  if (chess.winner !== null) return;
  if (cell < 0) return;

  if (chessBuild) {
    applyChess(chessReduce(chess, { k: 'build', cell }, chessCtx()));
    return;
  }

  const piece = chess.pieces.find((p) => p.cell === cell);
  if (piece && piece.side === chess.turn) {
    chessSelected = piece.id;
    return;
  }

  if (chessSelected === null) {
    app.setMessage(t.chess.notYours, 'error');
    return;
  }

  const result = chessReduce(chess, { k: 'move', piece: chessSelected, to: cell }, chessCtx());
  if (result.ok) chessSelected = null;
  applyChess(result);
}

// -------------------------------------------------------------------- input

let pointerDown: { x: number; y: number; at: number } | null = null;

app.canvas.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY, at: performance.now() };
});

app.canvas.addEventListener('pointerup', (event) => {
  const start = pointerDown;
  pointerDown = null;
  if (!start) return;
  const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  const elapsed = performance.now() - start.at;
  // A drag is an orbit, not a claim.
  if (distance > 8 || elapsed > 700) return;
  app.canvas.focus({ preventScroll: true });
  const cell = view.pick(event.clientX, event.clientY);
  if (settings.mode === 'chess') chessClick(cell);
  else toggleCell(cell, event.shiftKey);
});

app.canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;
  view.setHovered(view.pick(event.clientX, event.clientY));
});

app.canvas.addEventListener('pointerleave', () => view.setHovered(-1));

app.canvas.addEventListener('keydown', (event) => {
  let row = Math.floor(selected / map.cols);
  let col = selected % map.cols;

  switch (event.key) {
    case 'ArrowUp':
      row = Math.max(0, row - 1);
      break;
    case 'ArrowDown':
      row = Math.min(map.rows - 1, row + 1);
      break;
    case 'ArrowLeft':
      col = Math.max(0, col - 1);
      break;
    case 'ArrowRight':
      col = Math.min(map.cols - 1, col + 1);
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      toggleCell(selected, event.shiftKey);
      return;
    default:
      return;
  }

  event.preventDefault();
  selected = row * map.cols + col;
  view.setSelected(selected);
  view.setHovered(-1);
});

const observer = new ResizeObserver(() => view.resize());
observer.observe(app.frame);

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
view.setReducedMotion(motionQuery.matches);
motionQuery.addEventListener?.('change', (event) => view.setReducedMotion(event.matches));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') settle();
  else saveNow();
});
window.addEventListener('beforeunload', saveNow);
window.setInterval(settle, 60_000);

// --------------------------------------------------------------------- boot

applyTheme();

const loaded = loadSave(storage, settings.size);
state = loaded.ok ? loaded.state : createInitialState(nextSeed(), Date.now());

// A save whose whole map is under water is finished, not playable: the player
// could only stare at the sea and reach for Start over. Start the new world here.
const landLeft = map.elev.filter(
  (elevation, index) => map.mask[index] === '#' && elevation >= state.seaLevel,
).length;
const drownedWorld = loaded.ok && landLeft === 0;
if (drownedWorld) {
  state = createInitialState(nextSeed(), Date.now());
  clearSave(storage, map.land);
}
selected = firstLand();

if (drownedWorld) {
  app.setMessage(t.messages.drownedWorld, 'error');
} else if (loaded.ok) {
  app.setMessage(t.messages.loaded(state.claimed[0]), 'info');
} else if (loaded.reason === 'corrupt') {
  app.setMessage(t.errors.saveCorrupt, 'error');
} else if (loaded.reason === 'newer') {
  app.setMessage(t.errors.saveNewer, 'error');
} else {
  app.setMessage(t.hud.hint, 'info');
}

app.canvas.focus({ preventScroll: true });
view.setSelected(selected);
view.setState(state, Date.now());
updateStats();
applyLighting(true);
settle();
// Only now is there a state to switch away from: starting chess earlier crashed
// on a missing `state` and left the screen with nothing but the sea plane.
if (settings.mode === 'chess') startChess();

// --------------------------------------------------------------- multiplayer

function sayEvents(events: readonly GameEvent[]): void {
  for (const event of events) {
    if (event.t === 'claimed') app.setMessage(t.messages.claimed(event.cost), 'good');
    if (event.t === 'unclaimed') app.setMessage(t.messages.unclaimed(event.refund), 'good');
    if (event.t === 'moved') app.setMessage(t.messages.moved, 'info');
    if (event.t === 'flood') app.setMessage(t.messages.flood(event.level, event.destroyed), 'info');
    if (event.t === 'storm' && event.hits > 0) {
      app.setMessage(
        t.messages.storm(event.hits, event.destroyed),
        event.destroyed > 0 ? 'error' : 'info',
      );
    }
  }
}

function applyServerState(next: GameState, events: readonly GameEvent[]): void {
  state = next;
  view.setState(state, Date.now());
  updateStats();
  sayEvents(events);
}

function roomErrorText(code: string): string {
  switch (code) {
    case 'room_full':
      return t.messages.roomFull;
    case 'room_gone':
      return t.messages.roomGone;
    case 'bad_secret':
      return t.messages.badSecret;
    case 'refresh':
      return t.messages.needRefresh;
    default:
      return t.messages.connectionFailed;
  }
}

if (roomCode) {
  // Rooms run the building game only: chess is hot-seat by design.
  settings = { ...settings, mode: 'build' };
  app.setRoomCode(roomCode);
  app.setWaiting(true, t.messages.waitingOpponent);

  mp = new MultiplayerClient(roomCode, {
    onStatusChange: (status, info) => {
      switch (status) {
        case 'connecting':
          app.setConnectionStatus('connecting', '');
          break;
        case 'waiting':
          app.setConnectionStatus('waiting', t.messages.waitingOpponent);
          app.setWaiting(true, t.messages.waitingOpponent);
          break;
        case 'playing':
          app.setConnectionStatus('playing', '');
          app.setWaiting(false);
          break;
        case 'reconnecting':
          app.setConnectionStatus('reconnecting', t.messages.connectionLost);
          break;
        case 'error':
          app.setConnectionStatus('error', info ?? t.messages.connectionFailed);
          break;
        default:
          app.setConnectionStatus('idle');
          break;
      }
    },
    onWelcome: (welcomeSeat, _rev, next) => {
      seat = welcomeSeat;
      app.setWaiting(false);
      applyServerState(next, []);
    },
    onState: (next, events) => applyServerState(next, events),
    onReject: (_id, code) => app.setMessage(describeError(code), 'error'),
    onError: (code) => {
      app.setMessage(roomErrorText(code), 'error');
      if (code !== 'rate_limited') app.setWaiting(false);
    },
    onStorms: (plans) => view.setStorms(plans),
  });
  mp.connect();

  window.setInterval(() => mp?.ping(), 25_000);
  window.addEventListener('beforeunload', () => mp?.disconnect());
}

let previous = performance.now();
interface ActiveStorm {
  readonly plan: StormPlan;
  damaged: boolean;
}

let storms: ActiveStorm[] = [];
let nextStormAt = 0;
let stormCounter = 0;

/**
 * Hurricanes are a schedule plus a plan, not a simulation: the plan is fixed at
 * spawn, the damage is resolved once when the funnel is fully formed, and the
 * view only animates. The same plan object is what the two-player room will
 * issue, so the storm looks identical on both screens.
 */
function updateStorms(now: number): void {
  // The room issues its own plans over the wire; the client only animates them.
  if (mp) return;
  if (!settings.hurricanes || demo) {
    if (storms.length > 0) {
      storms = [];
      view.setStorms([]);
    }
    nextStormAt = 0;
    return;
  }

  const hud = BALANCE.hurricane;
  if (nextStormAt === 0) nextStormAt = now + hud.firstDelayMs;

  if (now >= nextStormAt && storms.length < hud.maxActive) {
    const seed = nextSeed();
    const life = hud.lifeMinMs + Math.floor(hash01(seed) * (hud.lifeMaxMs - hud.lifeMinMs));
    const plan = planStorm({
      seed,
      id: ++stormCounter,
      startAt: now,
      durationMs: life,
      rows: map.rows,
      cols: map.cols,
    });
    storms.push({ plan, damaged: false });
    nextStormAt = now + nextStormGap(seed);
    view.setStorms(storms.map((storm) => storm.plan));
  }

  for (const storm of storms) {
    if (storm.damaged || now < storm.plan.damageAt) continue;
    storm.damaged = true;

    const result = reduce(state, { k: 'damage', cells: stormCells(storm.plan, map) }, ctx());
    if (!result.ok) continue;

    state = result.state;
    view.setState(state, Date.now());
    updateStats();
    scheduleSave();

    const summary = result.events.find((event) => event.t === 'storm');
    if (summary && summary.t === 'storm' && summary.hits > 0) {
      app.setMessage(
        t.messages.storm(summary.hits, summary.destroyed),
        summary.destroyed > 0 ? 'error' : 'info',
      );
    }
  }

  const alive = storms.filter((storm) => now < storm.plan.endsAt);
  if (alive.length !== storms.length) {
    storms = alive;
    view.setStorms(storms.map((storm) => storm.plan));
  }
}

function frame(now: number): void {
  const delta = Math.min(100, Math.max(0, now - previous));
  previous = now;

  // A room runs on real time: the server settles the days, so accelerating
  // here would only desync the animation from the state it is drawing.
  // Chess is turn-based: there is no world clock to accelerate, and the control
  // is hidden there, so the setting must not leak into the mode either.
  const speed = mp || settings.mode === 'chess' ? 1 : demo ? DEMO_SPEED : speedMultiplier(settings);
  extraTime = advance(extraTime, delta, speed);
  const world = clock();

  // At speed the day boundary can pass many times a minute, so settlement is
  // driven by the world clock rather than by the one-minute timer: the sea has
  // to rise while the player watches, not in a lump at the end.
  if (!demo && !mp) {
    const day = dayIndex(world);
    if (day !== lastWorldDay) {
      lastWorldDay = day;
      settle();
    }
  }

  applyLighting();
  updateStorms(world);
  view.render(world);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** Exposed for the DOM smoke test and for poking at it in the console. */
export const __eurasia: {
  app: App;
  view: View;
  getState: () => GameState;
  getChess: () => ChessState | null;
  getSeat: () => 0 | 1;
  isMultiplayer: () => boolean;
} = {
  app,
  view,
  getState: () => active(),
  getChess: () => chess,
  getSeat: () => seat,
  isMultiplayer: () => mp !== null,
};
