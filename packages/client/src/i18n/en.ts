/**
 * English is the shipped locale. This file is the source of truth for the
 * dictionary *shape*: `Dict` is inferred from it, so any other language file is
 * type-checked against these exact keys and signatures and cannot silently drift.
 */
export const en = {
  app: {
    title: 'Eurasia Map',
    tagline: 'a grid map that grows into a strategy game',
  },
  panel: {
    coins: 'Coins',
    income: 'Income',
    perDay: (n: number) => `+${n} / day`,
    cells: 'Cells',
    progress: (claimed: number, total: number) => `${claimed} / ${total}`,
    settings: 'Settings',
    open: 'Settings',
    close: 'Collapse',
  },
  settings: {
    map: 'Map',
    size: 'Size',
    lighting: 'Lighting',
    lightingAuto: 'Auto',
    lightingDay: 'Day',
    lightingNight: 'Night',
    relief: 'Relief',
    reliefOn: 'Raised',
    reliefOff: 'Flat',
    hurricanes: 'Hurricanes',
    hurricanesOn: 'On',
    hurricanesOff: 'Off',
    speed: 'Time speed',
    speedOptions: ['1×', '60×', '600×'],
    quality: 'Quality',
    qualityAuto: 'Auto',
    qualityHigh: 'High',
    qualityLow: 'Low',
    theme: 'Theme',
    themeAuto: 'Auto',
    themeLight: 'Light',
    themeDark: 'Dark',
    demoOn: 'Demo city',
    demoOff: 'Exit demo',
    reset: 'Start over',
  },
  confirm: {
    reset: 'Delete the progress and start over? This cannot be undone.',
    resetYes: 'Delete',
    resetNo: 'Cancel',
  },
  hud: {
    hint: 'Click a cell to claim it, click again to refund',
    hintTouch: 'Tap a cell to claim it',
    keyboardHint: 'Arrow keys to select, Enter to claim',
    cell: (row: number, col: number) => `Row ${row + 1}, column ${col + 1}`,
    land: 'Land',
    sea: 'Sea',
    metres: (m: number) => `${m.toLocaleString('en-US')} m`,
  },
  messages: {
    claimed: (n: number) => `Cell claimed — −${n} coins`,
    unclaimed: (n: number) => `Cell released — +${n} coins`,
    noCoins: (need: number, have: number) => `Not enough coins: ${need} needed, ${have} in hand`,
    taken: 'That cell is already taken',
    sea: 'You cannot build on water',
    failed: 'That did not work — try again',
    income: (amount: number, days: number) =>
      days === 1
        ? `Collected ${amount} coins for one day`
        : `Collected ${amount} coins for ${days} days`,
    reset: 'Progress deleted — a new city',
    demo: 'Demo: the city grew on its own, no coins are earned',
    demoOff: 'Demo off, your city is intact',
    noWebgl: 'WebGL is unavailable — the flat view is on',
    loaded: (claimed: number) =>
      claimed === 1 ? 'Loaded 1 claimed cell' : `Loaded ${claimed} claimed cells`,
  },
  errors: {
    saveCorrupt: 'The save was corrupted — a new city was started',
    saveNewer: 'This save comes from a newer version of the game — start over',
  },
  legend: {
    elevation: 'Elevation',
    range: '0 — 5 200 m',
  },
  source: {
    label: 'Data',
    text: 'Natural Earth 1:50m · ETOPO 2022, NOAA/NCEI',
  },
};

export type Dict = typeof en;
