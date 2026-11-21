import { MAP_SIZES, type MapSize } from '@eurasia/shared';
import { t } from '../i18n';
import type { DayNight, Quality, Settings, Theme } from '../state/settings';
import { formatNumber, h, row, segmented } from './dom';

export interface AppHandlers {
  onSize(size: MapSize): void;
  onTheme(theme: Theme): void;
  onQuality(quality: Quality): void;
  onRelief(on: boolean): void;
  onSides(both: boolean): void;
  onDayNight(mode: DayNight): void;
  onHurricanes(on: boolean): void;
  onFlood(on: boolean): void;
  onSpeed(index: number): void;
  onDemo(): void;
  onReset(): void;
  onConnectionStatus?: (
    status: 'idle' | 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'error',
    info?: string,
  ) => void;
  onOpponentChange?: (connected: boolean, name?: string) => void;
  onRoomCode?: (code: string, url: string) => void;
}

export type MessageTone = 'info' | 'error' | 'good';

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly frame: HTMLElement;
  readonly stage: HTMLElement;

  private readonly root: HTMLElement;
  private readonly coinsEl: HTMLElement;
  private readonly incomeEl: HTMLElement;
  private readonly cellsEl: HTMLElement;
  private readonly oppCoinsEl: HTMLElement;
  private readonly oppIncomeEl: HTMLElement;
  private readonly oppCellsEl: HTMLElement;
  private readonly connectionEl: HTMLElement;
  private readonly opponentEl: HTMLElement;
  private readonly roomEl: HTMLButtonElement;
  private readonly waitingOverlay: HTMLElement;
  private readonly barEl: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly toggle: HTMLButtonElement;
  private readonly demoButton: HTMLButtonElement;
  private readonly statsEl: HTMLElement;
  private readonly segments: {
    size: ReturnType<typeof segmented<MapSize>>;
    theme: ReturnType<typeof segmented<Theme>>;
    quality: ReturnType<typeof segmented<Quality>>;
    dayNight: ReturnType<typeof segmented<DayNight>>;
    relief: ReturnType<typeof segmented<string>>;
    hurricanes: ReturnType<typeof segmented<string>>;
    flood: ReturnType<typeof segmented<string>>;
    speed: ReturnType<typeof segmented<number>>;
    sides: ReturnType<typeof segmented<string>>;
  };
  private resetResolver: ((value: boolean) => void) | null = null;
  private roomCode = '';

  constructor(settings: Settings, handlers: AppHandlers) {
    // --- canvas + stage -------------------------------------------------
    this.canvas = h('canvas', {
      attrs: {
        tabindex: '0',
        role: 'application',
        'aria-label': `${t.hud.hint}. ${t.hud.keyboardHint}`,
      },
    }) as HTMLCanvasElement;

    this.frame = h('div', { class: 'map-frame' }, this.canvas);

    this.barEl = h('div', { class: 'progress-fill' });
    this.progressEl = h(
      'div',
      {
        class: 'progress',
        attrs: {
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': '0',
        },
      },
      this.barEl,
    );
    this.statusEl = h('div', {
      class: 'status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    this.stage = h(
      'section',
      { class: 'stage' },
      this.frame,
      this.progressEl,
      this.statusEl,
      this.buildLegend(),
    );

    // --- stat values ----------------------------------------------------
    this.coinsEl = h('strong', { class: 'stat-value', text: '—' });
    this.incomeEl = h('strong', { class: 'stat-value muted', text: '—' });
    this.cellsEl = h('strong', { class: 'stat-value', text: '—' });
    this.oppCoinsEl = h('strong', { class: 'stat-value', text: '—' });
    this.oppIncomeEl = h('strong', { class: 'stat-value muted', text: '—' });
    this.oppCellsEl = h('strong', { class: 'stat-value', text: '—' });
    this.connectionEl = h('span', { class: 'connection-status hidden', text: '' });
    this.opponentEl = h('span', { class: 'opponent-label hidden', text: '' });
    this.roomEl = h('button', {
      class: 'room-code hidden',
      text: '',
      attrs: { type: 'button', title: t.room.copy },
      on: { click: () => void this.copyInvite() },
    }) as HTMLButtonElement;

    this.statsEl = h(
      'div',
      { class: 'stats' },
      h(
        'div',
        { class: 'stat' },
        h('span', { class: 'stat-label', text: t.panel.coins }),
        this.coinsEl,
        this.incomeEl,
      ),
      h(
        'div',
        { class: 'stat' },
        h('span', { class: 'stat-label', text: t.panel.cells }),
        this.cellsEl,
      ),
      h(
        'div',
        { class: 'stat opponent-stat' },
        h('span', { class: 'stat-label', text: '' }),
        this.oppCoinsEl,
        this.oppIncomeEl,
      ),
      h(
        'div',
        { class: 'stat opponent-stat' },
        h('span', { class: 'stat-label', text: '' }),
        this.oppCellsEl,
      ),
    );

    // --- settings panel -------------------------------------------------
    const size = segmented<MapSize>(
      MAP_SIZES.map((value) => ({ value, label: String(value) })),
      settings.size,
      handlers.onSize,
      t.settings.size,
    );
    const dayNight = segmented<DayNight>(
      [
        { value: 'auto', label: t.settings.lightingAuto },
        { value: 'day', label: t.settings.lightingDay },
        { value: 'night', label: t.settings.lightingNight },
      ],
      settings.dayNight,
      handlers.onDayNight,
      t.settings.lighting,
    );
    const relief = segmented<string>(
      [
        { value: 'on', label: t.settings.reliefOn },
        { value: 'off', label: t.settings.reliefOff },
      ],
      settings.relief ? 'on' : 'off',
      (value) => handlers.onRelief(value === 'on'),
      t.settings.relief,
    );
    const sides = segmented<string>(
      [
        { value: 'one', label: t.settings.sidesOne },
        { value: 'both', label: t.settings.sidesBoth },
      ],
      settings.sides,
      (value) => handlers.onSides(value === 'both'),
      t.settings.sides,
    );
    const hurricanes = segmented<string>(
      [
        { value: 'on', label: t.settings.hurricanesOn },
        { value: 'off', label: t.settings.hurricanesOff },
      ],
      settings.hurricanes ? 'on' : 'off',
      (value) => handlers.onHurricanes(value === 'on'),
      t.settings.hurricanes,
    );
    const flood = segmented<string>(
      [
        { value: 'on', label: t.settings.floodOn },
        { value: 'off', label: t.settings.floodOff },
      ],
      settings.flood ? 'on' : 'off',
      (value) => handlers.onFlood(value === 'on'),
      t.settings.flood,
    );
    const speed = segmented<number>(
      t.settings.speedOptions.map((label, index) => ({ value: index, label })),
      settings.speed,
      handlers.onSpeed,
      t.settings.speed,
    );
    const quality = segmented<Quality>(
      [
        { value: 'auto', label: t.settings.qualityAuto },
        { value: 'high', label: t.settings.qualityHigh },
        { value: 'low', label: t.settings.qualityLow },
      ],
      settings.quality,
      handlers.onQuality,
      t.settings.quality,
    );
    const theme = segmented<Theme>(
      [
        { value: 'auto', label: t.settings.themeAuto },
        { value: 'light', label: t.settings.themeLight },
        { value: 'dark', label: t.settings.themeDark },
      ],
      settings.theme,
      handlers.onTheme,
      t.settings.theme,
    );

    this.segments = { size, theme, quality, dayNight, relief, hurricanes, flood, speed, sides };

    this.demoButton = h('button', {
      class: 'button',
      text: t.settings.demoOn,
      attrs: { type: 'button' },
      on: { click: () => handlers.onDemo() },
    }) as HTMLButtonElement;
    const resetButton = h('button', {
      class: 'button button-danger',
      text: t.settings.reset,
      attrs: { type: 'button' },
      on: { click: () => handlers.onReset() },
    });

    const panel = h(
      'aside',
      { class: 'panel', attrs: { 'aria-label': t.panel.settings } },
      h(
        'div',
        { class: 'panel-head' },
        h('span', { class: 'panel-title', text: t.panel.settings }),
        h('button', {
          class: 'panel-close',
          text: '×',
          attrs: { type: 'button', 'aria-label': t.panel.close },
          on: { click: () => this.setPanelOpen(false) },
        }),
      ),
      row(t.settings.size, size.root),
      row(t.settings.lighting, dayNight.root),
      row(t.settings.relief, relief.root),
      row(t.settings.sides, sides.root),
      row(t.settings.hurricanes, hurricanes.root),
      row(t.settings.flood, flood.root),
      row(t.settings.speed, speed.root),
      row(t.settings.quality, quality.root),
      row(t.settings.theme, theme.root),
      h('div', { class: 'panel-actions' }, this.demoButton, resetButton),
    );

    this.toggle = h('button', {
      class: 'panel-toggle',
      text: t.panel.settings,
      attrs: { type: 'button', 'aria-expanded': 'false' },
      on: { click: () => this.setPanelOpen(!this.root.classList.contains('panel-open')) },
    }) as HTMLButtonElement;

    // --- topbar ---------------------------------------------------------
    const topbar = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('h1', { text: t.app.title }), h('p', { text: t.app.tagline })),
      this.statsEl,
      this.opponentEl,
      this.connectionEl,
      this.roomEl,
      this.toggle,
    );

    // --- waiting overlay + confirm dialog -------------------------------
    this.waitingOverlay = h(
      'div',
      { class: 'waiting-overlay hidden' },
      h(
        'div',
        { class: 'waiting-content' },
        h('div', { class: 'spinner' }),
        h('p', { class: 'waiting-text', text: '' }),
      ),
    );

    const settleNo = h('button', {
      class: 'button',
      text: t.confirm.resetNo,
      attrs: { type: 'button' },
      on: { click: () => this.settleReset(false) },
    });
    const settleYes = h('button', {
      class: 'button button-danger',
      text: t.confirm.resetYes,
      attrs: { type: 'button' },
      on: { click: () => this.settleReset(true) },
    });
    this.dialog = h(
      'dialog',
      { class: 'dialog' },
      h('p', { text: t.confirm.reset }),
      h('div', { class: 'dialog-actions' }, settleNo, settleYes),
    ) as HTMLDialogElement;
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.settleReset(false);
    });

    // The panel is positioned against the stage, not the window: otherwise its
    // top slides under the topbar and its max-height ignores that row.
    this.stage.append(panel);

    // --- assembly -------------------------------------------------------
    this.root = h('div', { class: 'app' }, topbar, this.stage, this.waitingOverlay, this.dialog);
  }

  private buildLegend(): HTMLElement {
    return h(
      'div',
      { class: 'legend' },
      h('span', { class: 'legend-label', text: t.legend.elevation }),
      h('span', { class: 'legend-ramp' }),
      h('span', { class: 'legend-scale', text: t.legend.range }),
    );
  }

  mount(parent: HTMLElement): void {
    parent.replaceChildren(this.root);
  }

  updateStats(coins: number, income: number, claimed: number, total: number): void {
    this.coinsEl.textContent = formatNumber(coins);
    this.incomeEl.textContent = t.panel.perDay(income);
    this.incomeEl.classList.toggle('muted', income === 0);
    this.cellsEl.textContent = t.panel.progress(claimed, total);

    const percent = total > 0 ? Math.round((claimed / total) * 100) : 0;
    this.barEl.style.width = `${percent}%`;
    this.progressEl.setAttribute('aria-valuenow', String(percent));
  }

  updateMultiStats(
    myCoins: number,
    myIncome: number,
    myCells: number,
    oppCoins: number,
    oppIncome: number,
    oppCells: number,
    myLabel: string,
    oppLabel: string,
  ): void {
    this.statsEl.classList.add('multi');
    this.coinsEl.textContent = formatNumber(myCoins);
    this.incomeEl.textContent = t.panel.perDay(myIncome);
    this.incomeEl.classList.toggle('muted', myIncome === 0);
    this.cellsEl.textContent = t.panel.progress(myCells, 0);
    this.oppCoinsEl.textContent = formatNumber(oppCoins);
    this.oppIncomeEl.textContent = t.panel.perDay(oppIncome);
    this.oppIncomeEl.classList.toggle('muted', oppIncome === 0);
    this.oppCellsEl.textContent = t.panel.progress(oppCells, 0);

    const labels = this.statsEl.querySelectorAll('.stat-label');
    if (labels[0]) labels[0].textContent = `${myLabel} ${t.panel.coins}`;
    if (labels[1]) labels[1].textContent = `${myLabel} ${t.panel.cells}`;
    if (labels[2]) labels[2].textContent = `${oppLabel} ${t.panel.coins}`;
    if (labels[3]) labels[3].textContent = `${oppLabel} ${t.panel.cells}`;

    const share = myCells + oppCells > 0 ? Math.round((myCells / (myCells + oppCells)) * 100) : 0;
    this.barEl.style.width = `${share}%`;
    this.progressEl.setAttribute('aria-valuenow', String(share));
  }

  setWaiting(show: boolean, text?: string): void {
    this.waitingOverlay.classList.toggle('hidden', !show);
    if (show && text !== undefined) {
      const textEl = this.waitingOverlay.querySelector('.waiting-text');
      if (textEl) textEl.textContent = text;
    }
  }

  setConnectionStatus(
    status: 'idle' | 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'error',
    info?: string,
  ): void {
    this.connectionEl.textContent = info ?? '';
    this.connectionEl.dataset.status = status;
    this.connectionEl.classList.toggle('hidden', status === 'idle');
  }

  /** Show the room code in the topbar; the button copies the invite link. */
  setRoomCode(code: string): void {
    this.roomCode = code;
    this.roomEl.textContent = `${t.room.label} ${code}`;
    this.roomEl.classList.remove('hidden');
  }

  private async copyInvite(): Promise<void> {
    const url = `${location.origin}${location.pathname}?room=${this.roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      this.setMessage(t.room.copied, 'good');
    } catch {
      this.setMessage(url, 'info');
    }
  }

  setOpponent(name: string, connected: boolean): void {
    this.opponentEl.textContent = connected ? name : '';
    this.opponentEl.classList.toggle('hidden', !connected);
  }

  setMessage(text: string, tone: MessageTone = 'info'): void {
    this.statusEl.textContent = text;
    this.statusEl.dataset.tone = tone;
  }

  setSettings(settings: Settings, demo: boolean): void {
    this.segments.size.set(settings.size);
    this.segments.theme.set(settings.theme);
    this.segments.quality.set(settings.quality);
    this.segments.dayNight.set(settings.dayNight);
    this.segments.relief.set(settings.relief ? 'on' : 'off');
    this.segments.hurricanes.set(settings.hurricanes ? 'on' : 'off');
    this.segments.flood.set(settings.flood ? 'on' : 'off');
    this.segments.speed.set(settings.speed);
    this.demoButton.textContent = demo ? t.settings.demoOff : t.settings.demoOn;
    this.demoButton.classList.toggle('is-active', demo);
  }

  setPanelOpen(open: boolean): void {
    this.root.classList.toggle('panel-open', open);
    this.toggle.setAttribute('aria-expanded', String(open));
  }

  askReset(): Promise<boolean> {
    if (typeof this.dialog.showModal !== 'function') return Promise.resolve(false);
    this.dialog.showModal();
    return new Promise<boolean>((resolve) => {
      this.resetResolver = resolve;
    });
  }

  private settleReset(value: boolean): void {
    if (this.dialog.open) this.dialog.close();
    const resolve = this.resetResolver;
    this.resetResolver = null;
    resolve?.(value);
  }
}
