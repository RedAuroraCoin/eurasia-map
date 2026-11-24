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
import { lightingAt } from './render/palette';
import { createView, type View } from './render/view';
import { backupSave, browserStorage, clearSave, loadSave, saveState } from './state/save';
import { backupChessGame, clearChessGame, loadChessGame, saveChessGame } from './state/chess-save';
import { advance, clockFor } from './state/clock';
import { loadSettings, saveSettings, speedMultiplier, type Settings } from './state/settings';
import { MultiplayerClient, createInvite, parseRoomFromUrl } from './multiplayer/client';
import {
  buildSpots,
  chessReduce,
  createChessGame,
  legalTargets,
  recruitSpots,
  rocketCells,
  type ChessErrorCode,
  type ChessState,
} from '@eurasia/shared';
import type { UnitInstance } from './render/pieces';
import type { MoveHint } from './render/hints';
import type { ZoneCell } from './render/scene3d';
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

/**
 * Hurricanes of the building game. Declared up here with the rest of the state:
 * boot can switch into chess, and that path clears them, so they must exist by
 * then.
 */
let storms: ActiveStorm[] = [];
let nextStormAt = 0;
let stormCounter = 0;
/** Last world day the simulation settled, so a fast clock settles per day, not per minute. */
let lastWorldDay = Number.NEGATIVE_INFINITY;

// ---------------------------------------------------------------- chess mode
let chess: ChessState | null = null;
let chessSelected: number | null = null;
/** Both are a turn instead of a move, so only one can be armed at a time. */
let chessAction: 'none' | 'tower' | 'rocket' | 'pawn' | 'fire' = 'none';
/** What the last refresh told the view to draw, kept for the tests. */
let hints: MoveHint[] = [];
/** The blast area under the pointer while a rocket is armed. */
let zone: ZoneCell[] = [];
/** The cell whose zone was shown and would be fired at by the next tap. */
let aimCell: number | null = null;
/** The last explosion, kept for the tests: the view animates it and forgets it. */
let blast: ZoneCell[] = [];
/** The rocket bases currently burning with the "about to fire" glow. */
let glowCells: number[] = [];
/** The cell the camera was last sent to; the tests read it, the view animates it. */
let focusTarget: number | null = null;
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
  onGlow: (glow) => {
    settings = { ...settings, glow };
    saveSettings(storage, settings);
    view.setGlow(glow);
    app.setSettings(settings, demo);
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
    chessAction = chessAction === 'tower' ? 'none' : 'tower';
    chessSelected = null;
    app.setAction(chessAction);
    app.setMessage(
      chessAction === 'tower' ? t.chess.building : t.chess.build(BALANCE.chess.towerCost),
      'info',
    );
    refreshRocketGlow();
    refreshHints();
  },
  onRecruit: () => {
    if (!chess) return;
    chessAction = chessAction === 'pawn' ? 'none' : 'pawn';
    chessSelected = null;
    app.setAction(chessAction);
    app.setMessage(
      chessAction === 'pawn' ? t.chess.recruiting : t.chess.recruit(BALANCE.chess.pawnCost),
      'info',
    );
    refreshRocketGlow();
    refreshHints();
  },
  onRocket: () => {
    if (!chess) return;
    chessAction = chessAction === 'rocket' ? 'none' : 'rocket';
    chessSelected = null;
    app.setAction(chessAction);
    app.setMessage(
      chessAction === 'rocket' ? t.chess.building : t.chess.rocket(BALANCE.chess.rocketCost),
      'info',
    );
    refreshRocketGlow();
    refreshHints();
  },
  onFire: () => {
    if (!chess) return;
    chessAction = chessAction === 'fire' ? 'none' : 'fire';
    chessSelected = null;
    aimCell = null;
    app.setAction(chessAction);
    app.setMessage(
      chessAction === 'fire'
        ? t.chess.firing(BALANCE.chess.rocketShotCost)
        : t.chess.fire(BALANCE.chess.rocketShotCost),
      'info',
    );
    refreshRocketGlow();
    refreshHints();
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
      // Start over means a new game here, not the saved one.
      newChessGame();
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
view.setGlow(settings.glow);
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
  // Only the game on screen settles: chess keeps its own clock and its own state.
  if (demo || mp || settings.mode === 'chess') return;
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

/**
 * The board is always in daylight. Night was a setting, but a dark map hides the
 * relief and the pieces, so the sun is fixed just past noon instead: long enough
 * shadows to read the height, no dusk to squint through.
 */
const DAYLIGHT = 0.45;

function applyLighting(): void {
  view.setLighting(lightingAt(DAYLIGHT));
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
  Object.entries(game.rockets).forEach(([cell, side], index) => {
    out.push({ id: 20_000 + index, role: 'rocket', side, cell: Number(cell) });
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
  // What each side will be paid when this round closes: the base rate plus one
  // share per tower it still holds.
  const game = chess;
  const towerCount = (side: 0 | 1): number =>
    Object.values(game.towers).filter((owner) => owner === side).length;
  const perSide = (side: 0 | 1): number =>
    BALANCE.chess.coinsPerRound + BALANCE.chess.towerIncome * towerCount(side);
  const rocketCount = (side: 0 | 1): number =>
    Object.values(game.rockets).filter((owner) => owner === side).length;

  app.updateChess({
    turn: chess.turn,
    round: chess.round,
    coins: chess.coins,
    income: [perSide(0), perSide(1)],
    rockets: [rocketCount(0), rocketCount(1)],
    seaLevel: chess.seaLevel,
    winner: chess.winner,
  });
}

function describeChessError(code: ChessErrorCode, cost = BALANCE.chess.towerCost): string {
  switch (code) {
    case 'no_coins':
      return t.chess.noCoins(cost);
    case 'no_tower':
      return t.chess.noTower;
    case 'no_rocket':
      return t.chess.noRocket;
    case 'out_of_range':
      return t.chess.outOfRange;
    case 'no_target':
      return t.chess.noTarget;
    case 'occupied':
      return t.chess.illegal;
    case 'not_yours':
      return t.chess.notYours;
    case 'over':
      return 'Game over';
    default:
      return t.chess.illegal;
  }
}

function applyChess(result: ReturnType<typeof chessReduce>, cost = BALANCE.chess.towerCost): void {
  if (!result.ok) {
    // A refused action disarms itself. Leaving it armed turned every later tap on
    // the board into another rejected attempt, so the board looked frozen: a shot
    // out of range, or one the wallet could not pay for, swallowed the next move.
    if (chessAction === 'fire') {
      chessAction = 'none';
      app.setAction('none');
      refreshRocketGlow();
      refreshHints();
    }
    app.setMessage(describeChessError(result.code, cost), 'error');
    return;
  }
  chess = result.state;
  for (const event of result.events) {
    if (event.t === 'captured') app.setMessage(t.messages.taken, 'info');
    if (event.t === 'built') app.setMessage(t.chess.built, 'good');
    if (event.t === 'recruited') app.setMessage(t.chess.recruited, 'good');
    if (event.t === 'rocketBuilt') app.setMessage(t.chess.rocketBuilt, 'good');
    if (event.t === 'fired') {
      // The explosion plays over the zone that was hit, whatever it killed.
      blast = zoneCells(event.cell);
      view.playBlast(blast);
      // The zone rolls for every piece in it, so a shot can take several at once —
      // and some of them can be yours, which is worth saying out loud.
      const own = event.hits.filter((hit) => hit.side === event.side).length;
      const text =
        event.hits.length === 0
          ? t.chess.rocketMiss
          : own > 0
            ? t.chess.rocketHitsOwn(event.hits.length, own)
            : t.chess.rocketHits(event.hits.length);
      app.setMessage(text, own > 0 ? 'error' : event.hits.length > 0 ? 'good' : 'info');
    }
    if (event.t === 'drowned') app.setMessage(t.chess.drowned(event.pieces), 'error');
    if (event.t === 'won') {
      app.setMessage(
        t.chess.won(event.side === 0 ? t.chess.white : t.chess.black, event.how),
        'good',
      );
    }
  }
  chessAction = 'none';
  app.setAction('none');
  syncChess();
  // The turn has changed hands: put the new side in frame, and move the fire glow
  // to whoever holds it now.
  focusOnSide(chess.turn);
  refreshRocketGlow();
  refreshHints();
  // Every applied action is a save point: a reload resumes on this position.
  if (chess.winner === null) saveChessGame(storage, chess);
  else clearChessGame(storage);
}

const CHESS_SIZE: MapSize = 800;

/** Starts over, discarding the saved game. */
function newChessGame(): void {
  chess = createChessGame(CHESS_SIZE, nextSeed(), chessCtx());
  chessSelected = null;
  chessAction = 'none';
  saveChessGame(storage, chess);
  app.setChessMode(true);
  app.setAction('none');
  view.setUnits(unitsOf(chess));
  syncChess();
  refreshHints();
}

/** Enters the mode: the saved game if there is one, otherwise a new one. */
function startChess(): void {
  if (mp) return;
  // A storm left over from the building game has no place on this board.
  storms = [];
  nextStormAt = 0;
  view.setStorms([]);
  // The turn-based mode is played on one board size, so the size is not a choice
  // there: switch to it without touching the building game's saved preference.
  if (map.land !== CHESS_SIZE) switchSize(CHESS_SIZE, false);

  const saved = loadChessGame(storage, chessCtx());
  if (saved.ok) {
    chess = saved.state;
    chessSelected = null;
    chessAction = 'none';
    app.setChessMode(true);
    app.setAction('none');
    view.setUnits(unitsOf(chess));
    syncChess();
    app.setMessage(t.chess.resumed(chess.round), 'info');
    return;
  }

  if (saved.reason === 'corrupt' || saved.reason === 'newer') backupChessGame(storage);
  newChessGame();
  if (saved.reason === 'corrupt') app.setMessage(t.chess.saveCorrupt, 'error');
  else if (saved.reason === 'newer') app.setMessage(t.chess.saveNewer, 'error');
}

function leaveChess(): void {
  chess = null;
  chessSelected = null;
  chessAction = 'none';
  aimCell = null;
  app.setChessMode(false);
  app.setAction('none');
  view.setUnits([]);
  hints = [];
  view.setHints([]);
  zone = [];
  view.setZone(null);
  glowCells = [];
  view.setRocketGlow(null);
  // Back to whatever map the building game was playing before chess.
  if (map.land !== settings.size) switchSize(settings.size, false);
  view.setState(state, clock());
  updateStats();
}

/** Recomputes the move hints for whatever is selected right now. */
function refreshHints(): void {
  if (chessAction !== 'fire') aimCell = null;
  if (!chess || mp || settings.mode !== 'chess') {
    if (hints.length > 0) {
      hints = [];
      view.setHints([]);
    }
    if (zone.length > 0) {
      zone = [];
      view.setZone(null);
    }
    return;
  }

  if (chessAction !== 'fire' && zone.length > 0) {
    zone = [];
    view.setZone(null);
  }

  if (chessAction === 'tower') {
    hints = buildSpots(chess, chessCtx()).map((cell) => ({ cell, kind: 'build' as const }));
    view.setHints(hints);
    return;
  }

  if (chessAction === 'rocket') {
    hints = buildSpots(chess, chessCtx()).map((cell) => ({ cell, kind: 'build' as const }));
    view.setHints(hints);
    return;
  }

  if (chessAction === 'pawn') {
    hints = recruitSpots(chess, chessCtx()).map((cell) => ({ cell, kind: 'recruit' as const }));
    view.setHints(hints);
    return;
  }

  if (chessAction === 'fire') {
    previewZone(selected);
    // Aiming is clicked on a piece, so the targets offered are the enemy pieces a
    // base can reach. Any other cell still works: it is the centre of a 3x3 zone.
    const bases = rocketCells(chess, chess.turn);
    const reach = BALANCE.chess.rocketRange;
    const near = (a: number, b: number): number => {
      const pa = { row: Math.floor(a / map.cols), col: a % map.cols };
      const pb = { row: Math.floor(b / map.cols), col: b % map.cols };
      return Math.max(Math.abs(pa.row - pb.row), Math.abs(pa.col - pb.col));
    };
    // Everything in reach is offered — pieces, towers, bases, its own side's
    // included: a rocket does not check uniforms or construction.
    const spots = [
      ...chess.pieces.map((piece) => piece.cell),
      ...Object.keys(chess.towers).map(Number),
      ...Object.keys(chess.rockets).map(Number),
    ];
    hints = [...new Set(spots)]
      .filter((cell) => bases.some((base) => near(base, cell) <= reach))
      .map((cell) => ({ cell, kind: 'fire' as const }));
    view.setHints(hints);
    return;
  }

  const piece =
    chessSelected === null ? undefined : chess.pieces.find((p) => p.id === chessSelected);
  if (!piece) {
    hints = [];
    view.setHints([]);
    return;
  }

  // A destination with something on it is a capture, and shows as a ring.
  const enemies = new Set(chess.pieces.filter((p) => p.side !== piece.side).map((p) => p.cell));
  const enemyTowers = new Set(
    Object.entries(chess.towers)
      .filter(([, side]) => side !== piece.side)
      .map(([cell]) => Number(cell)),
  );
  hints = legalTargets(chess, piece, chessCtx()).map((cell) => ({
    cell,
    kind: enemies.has(cell) || enemyTowers.has(cell) ? ('capture' as const) : ('move' as const),
  }));
  view.setHints(hints);
}

/**
 * The 3x3 a shot at this cell would hit, with the chance each cell gives. Null
 * clears the preview: it only means anything while a rocket is armed.
 */
function previewZone(cell: number | null): void {
  if (!chess || mp || settings.mode !== 'chess' || chessAction !== 'fire' || cell === null) {
    if (zone.length > 0) {
      zone = [];
      view.setZone(null);
    }
    return;
  }

  zone = zoneCells(cell);
  view.setZone(zone);
}

/** The 3x3 a shot at this cell would hit, clipped to the board. */
function zoneCells(cell: number): ZoneCell[] {
  const col = cell % map.cols;
  const row = Math.floor(cell / map.cols);
  const cells: ZoneCell[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= map.rows || c >= map.cols) continue;
      cells.push({
        cell: r * map.cols + c,
        chance:
          dr === 0 && dc === 0 ? BALANCE.chess.rocketCentreChance : BALANCE.chess.rocketRingChance,
      });
    }
  }
  return cells;
}

/**
 * The side that is aiming has its rocket bases lit: a flame at each tip, so a player
 * can see which base will fire before spending 200 coins.
 */
function refreshRocketGlow(): void {
  const lit =
    chess && !mp && settings.mode === 'chess' && chessAction === 'fire'
      ? rocketCells(chess, chess.turn)
      : [];
  glowCells = lit;
  view.setRocketGlow(lit.length > 0 ? lit : null);
}

/**
 * Puts the side whose turn it now is in front of the player. The anchor is its
 * king: after a move the view is usually framed wherever that move happened, and
 * the other player should not have to hunt for their own pieces.
 */
function focusOnSide(side: 0 | 1): void {
  if (!chess || mp) return;
  const king = chess.pieces.find((piece) => piece.side === side && piece.kind === 'king');
  const anchor = king ?? chess.pieces.find((piece) => piece.side === side);
  if (!anchor) return;

  focusTarget = anchor.cell;
  view.focusCell(anchor.cell);
}

/** One click: pick a piece, then a destination — or place a tower when armed. */
function chessClick(cell: number): void {
  if (!chess || mp) return;
  if (chess.winner !== null) return;
  if (cell < 0) return;
  // The keyboard walks `selected` around the board; keep it where the pointer
  // went so both input methods act on the same cell.
  selected = cell;

  if (chessAction === 'tower') {
    applyChess(chessReduce(chess, { k: 'build', cell }, chessCtx()), BALANCE.chess.towerCost);
    return;
  }

  if (chessAction === 'rocket') {
    applyChess(
      chessReduce(chess, { k: 'build', cell, kind: 'rocket' }, chessCtx()),
      BALANCE.chess.rocketCost,
    );
    return;
  }

  if (chessAction === 'pawn') {
    applyChess(chessReduce(chess, { k: 'recruit', cell }, chessCtx()), BALANCE.chess.pawnCost);
    return;
  }

  if (chessAction === 'fire') {
    // Two taps, not one: the first shows the zone and where the rockets would land,
    // the second fires. A shot costs 200 coins and can kill your own pieces, so it
    // should not be one stray tap away.
    if (aimCell !== cell) {
      aimCell = cell;
      selected = cell;
      view.setSelected(cell);
      previewZone(cell);
      app.setMessage(t.chess.confirmFire(BALANCE.chess.rocketShotCost), 'info');
      return;
    }

    aimCell = null;
    applyChess(chessReduce(chess, { k: 'fire', cell }, chessCtx()), BALANCE.chess.rocketShotCost);
    return;
  }

  const piece = chess.pieces.find((p) => p.cell === cell);
  if (piece && piece.side === chess.turn) {
    // Clicking the selected piece again lets it go.
    chessSelected = chessSelected === piece.id ? null : piece.id;
    refreshHints();
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
  const cell = view.pick(event.clientX, event.clientY);
  view.setHovered(cell);
  // The blast area follows the pointer, which is how a player sees the 50/20 split
  // before spending 200 coins on a shot.
  if (settings.mode === 'chess' && chessAction === 'fire') previewZone(cell < 0 ? null : cell);
});

app.canvas.addEventListener('pointerleave', () => {
  view.setHovered(-1);
  previewZone(null);
});

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
      // In chess the keyboard plays chess: Enter acts on the selected cell
      // instead of claiming a cell in the building game behind the board.
      if (settings.mode === 'chess') chessClick(selected);
      else toggleCell(selected, event.shiftKey);
      return;
    default:
      return;
  }

  event.preventDefault();
  selected = row * map.cols + col;
  view.setSelected(selected);
  view.setHovered(-1);
  // The keyboard walks the aim around; the blast area follows it.
  if (settings.mode === 'chess' && chessAction === 'fire') previewZone(selected);
});

const observer = new ResizeObserver(() => view.resize());
observer.observe(app.frame);

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
view.setReducedMotion(motionQuery.matches);
motionQuery.addEventListener?.('change', (event) => view.setReducedMotion(event.matches));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') settle();
  else {
    saveNow();
    if (chess) saveChessGame(storage, chess);
  }
});
window.addEventListener('beforeunload', () => {
  saveNow();
  if (chess) saveChessGame(storage, chess);
});
window.setInterval(settle, 60_000);

// --------------------------------------------------------------------- boot

applyTheme();

const loaded = loadSave(storage, settings.size);
// A file we cannot read is copied aside before a new city is written over it:
// rolling the build back is easy, rolling the save back is not.
if (!loaded.ok && (loaded.reason === 'corrupt' || loaded.reason === 'newer')) {
  backupSave(storage, settings.size);
}
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
applyLighting();
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

/**
 * Hurricanes are a schedule plus a plan, not a simulation: the plan is fixed at
 * spawn, the damage is resolved once when the funnel is fully formed, and the
 * view only animates. The same plan object is what the two-player room will
 * issue, so the storm looks identical on both screens.
 */
function updateStorms(now: number): void {
  // The room issues its own plans over the wire; the client only animates them.
  if (mp) return;
  // Hurricanes belong to the building game. In chess they would damage a state
  // nobody is looking at and then push it into the scene, which is how a storm
  // could freeze the board completely.
  if (settings.mode === 'chess') {
    if (storms.length > 0) {
      storms = [];
      view.setStorms([]);
    }
    nextStormAt = 0;
    return;
  }
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
  getHints: () => readonly MoveHint[];
  getZone: () => readonly ZoneCell[];
  getBlast: () => readonly ZoneCell[];
  getFocus: () => number | null;
  getGlowCells: () => readonly number[];
  getStormCount: () => number;
  getSeat: () => 0 | 1;
  isMultiplayer: () => boolean;
} = {
  app,
  view,
  getState: () => active(),
  getChess: () => chess,
  getHints: () => hints,
  getZone: () => zone,
  getBlast: () => blast,
  getFocus: () => focusTarget,
  getGlowCells: () => glowCells,
  getStormCount: () => storms.length,
  getSeat: () => seat,
  isMultiplayer: () => mp !== null,
};
