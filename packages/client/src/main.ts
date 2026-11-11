import {
  MAP_SIZES,
  cellColor,
  cellCol,
  cellRow,
  cssRgb,
  elevationAt,
  getMap,
  isLand,
  type MapEntry,
  type MapSize,
} from '@eurasia/shared';
import { ru } from './i18n/ru';

type Theme = 'auto' | 'light' | 'dark';

const state = {
  size: 500 as MapSize,
  selected: 0,
  hover: -1,
  theme: 'auto' as Theme,
};

interface ElementProps {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, EventListener>>;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [key, value] of Object.entries(props.attrs ?? {})) node.setAttribute(key, value);
  for (const [event, handler] of Object.entries(props.on ?? {})) {
    if (handler) node.addEventListener(event, handler);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app is missing');

const canvas = h('canvas', {
  attrs: {
    tabindex: '0',
    role: 'application',
    'aria-label': `${ru.map.hint}. ${ru.map.focusHint}`,
  },
});

const statusText = h('span', { text: '' });
const hintText = h('span', { text: ru.map.hint });
const live = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });

const facts = h('dl', { class: 'facts' });

const sizeButtons = MAP_SIZES.map((size) =>
  h('button', {
    text: ru.map.sizeOption(size),
    attrs: { type: 'button', 'aria-pressed': String(size === state.size) },
    on: { click: () => setSize(size) },
  }),
);

const themeButtons = (['auto', 'light', 'dark'] as const).map((theme) =>
  h('button', {
    text: ru.theme[theme],
    attrs: { type: 'button', 'aria-pressed': String(theme === state.theme) },
    on: { click: () => setTheme(theme) },
  }),
);

app.append(
  h(
    'header',
    { class: 'header' },
    h('div', {}, h('h1', { text: ru.app.title }), h('p', { text: ru.app.tagline })),
    h('span', { class: 'chip', text: ru.stage.label }),
  ),
  h(
    'div',
    { class: 'layout' },
    h(
      'section',
      { class: 'card map-card' },
      h('div', { class: 'map-frame' }, canvas),
      h('div', { class: 'status' }, statusText, hintText),
      live,
    ),
    h(
      'aside',
      { class: 'card panel' },
      h(
        'div',
        { class: 'group' },
        h('span', { class: 'label', text: ru.map.size }),
        h('div', { class: 'segmented' }, ...sizeButtons),
      ),
      h(
        'div',
        { class: 'group' },
        h('span', { class: 'label', text: ru.theme.label }),
        h('div', { class: 'segmented' }, ...themeButtons),
      ),
      h(
        'div',
        { class: 'group' },
        h('span', { class: 'label', text: ru.map.elevation }),
        h(
          'div',
          { class: 'legend' },
          h('div', { class: 'ramp' }),
          h(
            'div',
            { class: 'ramp-scale' },
            h('span', { text: '0' }),
            h('span', { text: '1 200' }),
            h('span', { text: '3 200' }),
            h('span', { text: '5 200 м' }),
          ),
        ),
      ),
      facts,
    ),
  ),
  h('footer', { class: 'footer' }, h('span', { text: `${ru.source.label}: ${ru.source.text}` })),
);

const ctx = canvas.getContext('2d');
const layout = { cell: 1, ox: 0, oy: 0, w: 0, h: 0 };

function setSize(size: MapSize): void {
  if (size === state.size) return;
  state.size = size;
  state.selected = 0;
  state.hover = -1;
  for (const [index, button] of sizeButtons.entries()) {
    button.setAttribute('aria-pressed', String(MAP_SIZES[index] === size));
  }
  scheduleDraw();
  updateFacts();
}

function setTheme(theme: Theme): void {
  state.theme = theme;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  for (const [index, button] of themeButtons.entries()) {
    button.setAttribute('aria-pressed', String(['auto', 'light', 'dark'][index] === theme));
  }
}

let frame = 0;
function scheduleDraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function draw(): void {
  if (!ctx) return;
  const mapData = getMap(state.size);
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#080e17';
  ctx.fillRect(0, 0, width, height);

  const cell = Math.max(3, Math.floor(Math.min(width / mapData.cols, height / mapData.rows)));
  const ox = Math.floor((width - cell * mapData.cols) / 2);
  const oy = Math.floor((height - cell * mapData.rows) / 2);
  layout.cell = cell;
  layout.ox = ox;
  layout.oy = oy;
  layout.w = width;
  layout.h = height;

  for (let row = 0; row < mapData.rows; row++) {
    for (let col = 0; col < mapData.cols; col++) {
      const index = row * mapData.cols + col;
      ctx.fillStyle = cssRgb(cellColor(mapData, index));
      ctx.fillRect(ox + col * cell, oy + row * cell, cell, cell);
    }
  }

  if (cell >= 7) {
    ctx.strokeStyle = 'rgba(4, 8, 14, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let col = 1; col < mapData.cols; col++) {
      const x = Math.round(ox + col * cell) + 0.5;
      ctx.moveTo(x, oy);
      ctx.lineTo(x, oy + mapData.rows * cell);
    }
    for (let row = 1; row < mapData.rows; row++) {
      const y = Math.round(oy + row * cell) + 0.5;
      ctx.moveTo(ox, y);
      ctx.lineTo(ox + mapData.cols * cell, y);
    }
    ctx.stroke();
  }

  if (state.hover >= 0 && state.hover !== state.selected) {
    strokeCell(mapData, state.hover, 'rgba(255, 255, 255, 0.55)', 1);
  }
  strokeCell(mapData, state.selected, 'rgba(0, 0, 0, 0.65)', 3);
  strokeCell(mapData, state.selected, 'rgba(255, 255, 255, 0.95)', 1.5);

  updateStatus();
}

function strokeCell(mapData: MapEntry, index: number, color: string, width: number): void {
  if (!ctx) return;
  const row = cellRow(mapData, index);
  const col = cellCol(mapData, index);
  const pad = width / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(
    layout.ox + col * layout.cell + pad,
    layout.oy + row * layout.cell + pad,
    layout.cell - width,
    layout.cell - width,
  );
}

function updateStatus(): void {
  const mapData = getMap(state.size);
  const index = state.hover >= 0 ? state.hover : state.selected;
  const row = cellRow(mapData, index);
  const col = cellCol(mapData, index);
  const elevation = elevationAt(mapData, index);
  const land = isLand(mapData, index);
  const where = `${ru.map.cell(row, col)} · ${land ? ru.map.land : ru.map.sea}`;
  const height = land ? ru.map.metres(elevation) : ru.map.depth(elevation);
  statusText.textContent = `${where} · ${height}`;
  live.textContent = statusText.textContent;
}

function updateFacts(): void {
  const mapData = getMap(state.size);
  facts.replaceChildren(
    h('dt', { text: ru.map.cells }),
    h('dd', { text: String(mapData.land) }),
    h('dt', { text: 'Сетка' }),
    h('dd', { text: `${mapData.cols} × ${mapData.rows}` }),
    h('dt', { text: 'Максимум' }),
    h('dd', { text: ru.map.metres(Math.max(...mapData.elev)) }),
  );
}

function indexFromEvent(event: PointerEvent): number {
  const mapData = getMap(state.size);
  const rect = canvas.getBoundingClientRect();
  const col = Math.floor((event.clientX - rect.left - layout.ox) / layout.cell);
  const row = Math.floor((event.clientY - rect.top - layout.oy) / layout.cell);
  if (row < 0 || row >= mapData.rows || col < 0 || col >= mapData.cols) return -1;
  return row * mapData.cols + col;
}

canvas.addEventListener('pointermove', (event) => {
  const index = indexFromEvent(event);
  if (index === state.hover) return;
  state.hover = index;
  scheduleDraw();
});

canvas.addEventListener('pointerleave', () => {
  state.hover = -1;
  scheduleDraw();
});

canvas.addEventListener('pointerdown', (event) => {
  const index = indexFromEvent(event);
  if (index < 0) return;
  state.selected = index;
  canvas.focus();
  scheduleDraw();
});

canvas.addEventListener('keydown', (event) => {
  const mapData = getMap(state.size);
  const row = cellRow(mapData, state.selected);
  const col = cellCol(mapData, state.selected);
  let nextRow = row;
  let nextCol = col;

  switch (event.key) {
    case 'ArrowUp':
      nextRow = Math.max(0, row - 1);
      break;
    case 'ArrowDown':
      nextRow = Math.min(mapData.rows - 1, row + 1);
      break;
    case 'ArrowLeft':
      nextCol = Math.max(0, col - 1);
      break;
    case 'ArrowRight':
      nextCol = Math.min(mapData.cols - 1, col + 1);
      break;
    case 'Home':
      nextCol = 0;
      break;
    case 'End':
      nextCol = mapData.cols - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  state.selected = nextRow * mapData.cols + nextCol;
  scheduleDraw();
});

const observer = new ResizeObserver(() => scheduleDraw());
observer.observe(canvas);

setTheme('auto');
updateFacts();
scheduleDraw();
