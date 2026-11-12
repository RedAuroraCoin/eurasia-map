import { MAP_SIZES, type MapSize } from '@eurasia/shared';
import { t } from '../i18n';
import type { DayNight, Quality, Settings, Theme } from '../state/settings';
import { formatNumber, h, row, segmented } from './dom';

export interface AppHandlers {
  onSize(size: MapSize): void;
  onTheme(theme: Theme): void;
  onQuality(quality: Quality): void;
  onRelief(on: boolean): void;
  onDayNight(mode: DayNight): void;
  onHurricanes(on: boolean): void;
  onSpeed(index: number): void;
  onDemo(): void;
  onReset(): void;
}

export type MessageTone = 'info' | 'error' | 'good';

/**
 * The whole interface, built once and then updated by id-free references.
 * Keeping it in one class is deliberate: there is no framework here, and a
 * "component" that renders three numbers does not earn its own file.
 */
export class App {
  readonly canvas: HTMLCanvasElement;
  readonly frame: HTMLElement;
  readonly stage: HTMLElement;

  private readonly root: HTMLElement = h('div', { class: 'app' });
  private readonly coinsEl = h('strong', { class: 'stat-value', text: '—' });
  private readonly incomeEl = h('strong', { class: 'stat-value', text: '—' });
  private readonly cellsEl = h('strong', { class: 'stat-value', text: '—' });
  private readonly barEl = h('div', { class: 'progress-fill' });
  private readonly progressEl = h('div', {
    class: 'progress',
    attrs: {
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
    },
  });
  private readonly statusEl = h('div', {
    class: 'status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  private readonly dialog: HTMLDialogElement;
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private resetResolver: ((value: boolean) => void) | null = null;

  private readonly segments: {
    size: ReturnType<typeof segmented<MapSize>>;
    theme: ReturnType<typeof segmented<Theme>>;
    quality: ReturnType<typeof segmented<Quality>>;
    dayNight: ReturnType<typeof segmented<DayNight>>;
    relief: ReturnType<typeof segmented<string>>;
    hurricanes: ReturnType<typeof segmented<string>>;
    speed: ReturnType<typeof segmented<number>>;
  };

  private readonly demoButton: HTMLButtonElement;

  constructor(settings: Settings, handlers: AppHandlers) {
    this.canvas = h('canvas', {
      attrs: {
        tabindex: '0',
        role: 'application',
        'aria-label': `${t.hud.hint}. ${t.hud.keyboardHint}`,
      },
    });

    this.frame = h('div', { class: 'map-frame' }, this.canvas);
    this.stage = h(
      'section',
      { class: 'stage' },
      this.frame,
      this.progressEl,
      this.statusEl,
      this.buildLegend(),
    );

    this.progressEl.append(this.barEl);

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
    const hurricanes = segmented<string>(
      [
        { value: 'on', label: t.settings.hurricanesOn },
        { value: 'off', label: t.settings.hurricanesOff },
      ],
      settings.hurricanes ? 'on' : 'off',
      (value) => handlers.onHurricanes(value === 'on'),
      t.settings.hurricanes,
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

    this.segments = { size, theme, quality, dayNight, relief, hurricanes, speed };

    this.demoButton = h('button', {
      class: 'button',
      text: t.settings.demoOn,
      attrs: { type: 'button' },
      on: { click: () => handlers.onDemo() },
    });
    const resetButton = h('button', {
      class: 'button button-danger',
      text: t.settings.reset,
      attrs: { type: 'button' },
      on: { click: () => handlers.onReset() },
    });

    this.panel = h(
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
      row(t.settings.hurricanes, hurricanes.root),
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
    });

    const stats = h(
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
    );

    this.root.append(
      h(
        'header',
        { class: 'topbar' },
        h(
          'div',
          { class: 'brand' },
          h('h1', { text: t.app.title }),
          h('p', { text: t.app.tagline }),
        ),
        stats,
        this.toggle,
      ),
      this.stage,
      this.panel,
    );

    this.dialog = h('dialog', { class: 'dialog' }) as HTMLDialogElement;
    const cancel = h('button', {
      class: 'button',
      text: t.confirm.resetNo,
      attrs: { type: 'button' },
      on: { click: () => this.settleReset(false) },
    });
    const confirm = h('button', {
      class: 'button button-danger',
      text: t.confirm.resetYes,
      attrs: { type: 'button' },
      on: { click: () => this.settleReset(true) },
    });
    this.dialog.append(
      h('p', { text: t.confirm.reset }),
      h('div', { class: 'dialog-actions' }, cancel, confirm),
    );
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.settleReset(false);
    });
    this.root.append(this.dialog);
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
