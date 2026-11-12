import {
  BALANCE,
  SAVE_VERSION,
  createInitialState,
  dayIndex,
  getMap,
  reduce,
  type GameState,
  type MapSize,
} from '@eurasia/shared';
import { t } from './i18n';
import { lightingAt, timeOfDayFromDate } from './render/palette';
import { createView, type View } from './render/view';
import { browserStorage, clearSave, loadSave, saveState } from './state/save';
import { loadSettings, saveSettings, speedMultiplier, type Settings } from './state/settings';
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

/** The clock the world runs on: accelerated by the speed setting, never used for money. */
let visualNow = Date.now();
let lastLighting = -1;
let selected = 0;
let saveTimer = 0;

// Handlers are declared before the app because the constructor wires them up;
// everything they close over (`app`, `view`) exists by the time one is called.
const handlers: AppHandlers = {
  onSize: (size) => switchSize(size),
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
  onSpeed: (speed) => {
    settings = { ...settings, speed };
    saveSettings(storage, settings);
    app.setSettings(settings, demo);
  },
  onDemo: () => toggleDemo(),
  onReset: () => void reset(),
};

const app = new App(settings, handlers);
const root = document.querySelector<HTMLDivElement>('#app') ?? document.body;
app.mount(root);

const { view, mode } = createView(app.canvas, map, settings.relief, resolveQuality(settings));
if (mode === '2d') app.setMessage(t.messages.noWebgl, 'info');
view.resize();

// --------------------------------------------------------------------- state

const active = (): GameState => (demo ? (demoState ?? state) : state);

const ctx = () => ({
  nowMs: Date.now(),
  isLand: (index: number) => map.mask[index] === '#',
  cellCount: map.rows * map.cols,
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
  app.updateStats(
    current.coins[0],
    current.claimed[0] * BALANCE.income.perCellPerDay,
    current.claimed[0],
    map.land,
  );
}

function describeError(code: string): string {
  switch (code) {
    case 'no_coins':
      return t.messages.noCoins(BALANCE.claim.cost, active().coins[0]);
    case 'sea':
      return t.messages.sea;
    case 'taken':
    case 'already_owned':
      return t.messages.taken;
    default:
      return t.messages.failed;
  }
}

function toggleCell(index: number): void {
  if (demo) {
    app.setMessage(t.messages.demo, 'info');
    return;
  }
  if (index < 0 || index >= map.rows * map.cols) return;

  const owned = state.cells[String(index)] !== undefined;
  const command = owned
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

  for (const event of result.events) {
    if (event.t === 'claimed') app.setMessage(t.messages.claimed(event.cost), 'good');
    if (event.t === 'unclaimed') app.setMessage(t.messages.unclaimed(event.refund), 'good');
  }
}

/** Credits income for the days that passed while the player was away. */
function settle(): void {
  if (demo) return;
  const result = reduce(state, { k: 'tick' }, ctx());
  if (result.state === state) return;

  state = result.state;
  view.setState(state, Date.now());
  updateStats();
  scheduleSave();

  const income = result.events.find((event) => event.t === 'income');
  if (income && income.t === 'income') {
    app.setMessage(t.messages.income(income.amount, income.days), 'good');
  }
}

function scheduleSave(): void {
  if (demo) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 250);
}

function saveNow(): void {
  if (demo) return;
  clearTimeout(saveTimer);
  saveState(storage, state, Date.now(), settings.size);
}

function switchSize(size: MapSize): void {
  if (size === settings.size) return;
  saveNow();

  settings = { ...settings, size };
  saveSettings(storage, settings);
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
  const cells: Record<string, { o: 0 | 1; t: number }> = {};
  let claimed = 0;
  for (let index = 0; index < map.mask.length; index++) {
    if (map.mask[index] !== '#') continue;
    cells[String(index)] = { o: 0, t: now - 40 * BALANCE.time.msPerDay };
    claimed++;
  }
  return {
    v: SAVE_VERSION,
    seed: 1,
    cells,
    coins: [0, 0],
    claimed: [claimed, 0],
    lastDay: dayIndex(now),
  };
}

function toggleDemo(): void {
  demo = !demo;
  if (demo) {
    demoState = buildDemoState();
    visualNow = Date.now();
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

  clearSave(storage, settings.size);
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
        : timeOfDayFromDate(new Date(visualNow));

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
  toggleCell(view.pick(event.clientX, event.clientY));
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
      toggleCell(selected);
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
selected = firstLand();

if (loaded.ok) {
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

let previous = performance.now();
function frame(now: number): void {
  const delta = Math.min(100, Math.max(0, now - previous));
  previous = now;

  const speed = demo ? DEMO_SPEED : speedMultiplier(settings);
  visualNow += delta * (speed - 1);

  applyLighting();
  view.render(visualNow);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** Exposed for the DOM smoke test and for poking at it in the console. */
export const __eurasia: { app: App; view: View; getState: () => GameState } = {
  app,
  view,
  getState: () => active(),
};
