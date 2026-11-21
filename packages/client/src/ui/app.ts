import { BALANCE, MAP_SIZES, type MapSize } from '@eurasia/shared';
import { t } from '../i18n';
import type { DayNight, Quality, Settings, Theme } from '../state/settings';
import type { GameMode } from '../state/settings';
import { segmented, formatNumber, h, row } from './dom';

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
  /** Switch between the building game and the turn-based chess game. */
  onMode: (mode: GameMode) => void;
  /** Chess only: arm the king's build action for the next click. */
  onBuild: () => void;
  /** Recruit a pawn into one of your towers, instead of moving a piece. */
  onRecruit: () => void;
  /** Single-player only: create a room and go there. */
  onInvite: () => void;
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
  private readonly seaEl: HTMLElement;
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
    mode: ReturnType<typeof segmented<GameMode>>;
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
  private readonly invite: (() => void) | undefined;
  private readonly onBuild: () => void;
  private readonly onRecruit: () => void;
  private buildButton!: HTMLButtonElement;
  private recruitButton!: HTMLButtonElement;
  /** Always on screen in chess: building is the other half of a turn. */
  private buildBar!: HTMLElement;
  /** Hidden in chess mode: a turn-based game has no world clock to speed up. */
  private speedRow!: HTMLElement;
  /** Hidden in chess mode: that mode is played on the 800-cell board only. */
  private sizeRow!: HTMLElement;

  constructor(settings: Settings, handlers: AppHandlers) {
    this.invite = handlers.onInvite;
    this.onBuild = handlers.onBuild;
    this.onRecruit = handlers.onRecruit;
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
    this.seaEl = h('strong', { class: 'stat-value', text: '—' });
    this.oppCoinsEl = h('strong', { class: 'stat-value', text: '—' });
    this.oppIncomeEl = h('strong', { class: 'stat-value muted', text: '—' });
    this.oppCellsEl = h('strong', { class: 'stat-value', text: '—' });
    this.connectionEl = h('span', { class: 'connection-status hidden', text: '' });
    this.opponentEl = h('span', { class: 'opponent-label hidden', text: '' });
    // One button, two jobs: create a room when there is none, copy the invite
    // once there is. Hiding it in single-player left no way to start a room.
    this.roomEl = h('button', {
      class: 'room-code',
      text: t.room.invite,
      attrs: { type: 'button', title: t.room.inviteTitle },
      on: { click: () => this.onRoomClick() },
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
        // Which side it is, is stated once, on the side that has the turn; this
        // block repeated it as a second "to move" line. Hidden in chess.
        { class: 'stat turn-stat' },
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
        { class: 'stat opponent-stat turn-stat' },
        h('span', { class: 'stat-label', text: '' }),
        this.oppCellsEl,
      ),
      // Last on purpose: updateMultiStats addresses the four labels above by
      // index, so a stat inserted before them would rename the wrong ones.
      h(
        'div',
        { class: 'stat sea-stat' },
        h('span', { class: 'stat-label', text: t.panel.sea }),
        this.seaEl,
      ),
    );

    // --- settings panel -------------------------------------------------
    const mode = segmented<GameMode>(
      [
        { value: 'build', label: t.settings.modeBuild },
        { value: 'chess', label: t.settings.modeChess },
      ],
      settings.mode,
      handlers.onMode,
      t.settings.mode,
    );
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

    this.segments = {
      mode,
      size,
      theme,
      quality,
      dayNight,
      relief,
      hurricanes,
      flood,
      speed,
      sides,
    };

    this.speedRow = row(t.settings.speed, speed.root);
    this.sizeRow = row(t.settings.size, size.root);

    // Prices come from the balance file, not from the label string: a change to
    // what a tower costs must not need a second edit in the translations.
    this.buildButton = h('button', {
      class: 'button build-action',
      text: t.chess.build(BALANCE.chess.towerCost),
      attrs: { type: 'button', title: t.chess.buildTitle(BALANCE.chess.towerCost) },
      on: { click: () => this.onBuild() },
    }) as HTMLButtonElement;

    this.recruitButton = h('button', {
      class: 'button build-action',
      text: t.chess.recruit(BALANCE.chess.pawnCost),
      attrs: { type: 'button', title: t.chess.recruitTitle(BALANCE.chess.pawnCost) },
      on: { click: () => this.onRecruit() },
    }) as HTMLButtonElement;

    this.demoButton = h('button', {
      class: 'button',
      text: t.settings.demoOn,
      attrs: { type: 'button' },
      on: { click: () => handlers.onDemo() },
    }) as HTMLButtonElement;
    const resetButton = h('button', {
      class: 'button button-danger panel-reset',
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
      h(
        'div',
        { class: 'panel-primary' },
        h('button', {
          class: 'button button-wide',
          text: t.panel.newGame,
          attrs: { type: 'button' },
          on: { click: () => handlers.onReset() },
        }),
      ),
      row(t.settings.mode, mode.root),
      this.sizeRow,
      row(t.settings.lighting, dayNight.root),
      row(t.settings.relief, relief.root),
      row(t.settings.sides, sides.root),
      row(t.settings.hurricanes, hurricanes.root),
      row(t.settings.flood, flood.root),
      this.speedRow,
      row(t.settings.quality, quality.root),
      row(t.settings.theme, theme.root),
      h(
        'div',
        { class: 'panel-actions' },
        this.demoButton,
        h('button', {
          class: 'button panel-invite',
          text: t.room.invite,
          attrs: { type: 'button' },
          on: { click: () => this.onRoomClick() },
        }),
        resetButton,
      ),
    );

    this.toggle = h('button', {
      class: 'menu-toggle',
      text: '☰',
      attrs: {
        type: 'button',
        'aria-expanded': 'false',
        'aria-label': t.panel.settings,
        title: t.panel.settings,
      },
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

    // Building is the other half of a turn, so the two actions sit on the board
    // itself: a player should not have to open the settings sheet mid-game.
    this.buildBar = h(
      'div',
      { class: 'build-bar hidden' },
      h('span', { class: 'build-bar-label', text: t.panel.build }),
      this.buildButton,
      this.recruitButton,
    );
    this.stage.append(this.buildBar);

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

  /** Chess mode shows its own action and hides the building-game demo. */
  setChessMode(on: boolean): void {
    this.root.classList.toggle('chess', on);
    this.speedRow.classList.toggle('hidden', on);
    this.sizeRow.classList.toggle('hidden', on);
    this.buildBar.classList.toggle('hidden', !on);
    this.demoButton.classList.toggle('hidden', on);
    this.statsEl.classList.toggle('multi', on);
  }

  /**
   * Which "instead of a move" action is armed, if any: building a tower and
   * recruiting a pawn are both turns, so only one can be picked at a time.
   */
  setAction(action: 'none' | 'tower' | 'pawn'): void {
    this.buildButton.classList.toggle('armed', action === 'tower');
    this.recruitButton.classList.toggle('armed', action === 'pawn');
  }

  /** Turn, round, both wallets and the sea: everything the mode needs at a glance. */
  updateChess(info: {
    turn: 0 | 1;
    round: number;
    coins: readonly [number, number];
    /** Coins each side is paid when the round closes: base rate plus towers. */
    income: readonly [number, number];
    seaLevel: number;
    winner: 0 | 1 | null;
  }): void {
    this.coinsEl.textContent = formatNumber(info.coins[0]);
    this.oppCoinsEl.textContent = formatNumber(info.coins[1]);
    // Both wallets show their own income, not just White's: with towers paying
    // per round, the second number is the other player's whole plan.
    this.incomeEl.textContent = t.panel.perTurn(info.income[0]);
    this.incomeEl.classList.toggle('muted', info.income[0] === 0);
    this.oppIncomeEl.textContent = t.panel.perTurn(info.income[1]);
    this.oppIncomeEl.classList.toggle('muted', info.income[1] === 0);

    // A button you cannot afford is dimmed rather than hidden: the price is part
    // of the decision, and the click still explains itself.
    const purse = info.coins[info.turn];
    this.buildButton.classList.toggle('unaffordable', purse < BALANCE.chess.towerCost);
    this.recruitButton.classList.toggle('unaffordable', purse < BALANCE.chess.pawnCost);
    // The turn blocks are hidden here: two of them read "White to move" and
    // "Black to move" at the same time, which answers nothing. The turn is marked
    // once, on the side that has it.
    this.cellsEl.textContent = '';
    this.oppCellsEl.textContent = '';
    this.seaEl.textContent = t.panel.seaLevel(info.seaLevel);

    const labels = this.statsEl.querySelectorAll('.stat-label');
    if (labels[0]) labels[0].textContent = t.chess.white;
    if (labels[1]) labels[1].textContent = '';
    if (labels[2]) labels[2].textContent = t.chess.black;
    if (labels[3]) labels[3].textContent = '';

    const turning = [
      [labels[0], info.turn === 0],
      [labels[2], info.turn === 1],
    ] as const;
    for (const [label, mine] of turning) {
      label?.closest('.stat')?.classList.toggle('to-move', mine);
    }
  }

  /** The sea is the clock of the late game: it has to be readable at a glance. */
  updateSea(level: number): void {
    this.seaEl.textContent = t.panel.seaLevel(level);
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
    this.roomEl.title = t.room.copy;
    this.roomEl.classList.remove('hidden');
  }

  private onRoomClick(): void {
    if (!this.roomCode) {
      this.invite?.();
      return;
    }
    void this.copyInvite();
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
