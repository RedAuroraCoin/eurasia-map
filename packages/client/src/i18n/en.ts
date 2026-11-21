/**
 * English is the shipped locale. This file is the source of truth for the
 * dictionary *shape*: `Dict` is inferred from it, so any other language file is
 * type-checked against these exact keys and signatures and cannot silently drift.
 */
/** Sea levels run to four digits, so they get a thousands separator. */
const formatMetres = (value: number): string =>
  new Intl.NumberFormat('en-US').format(Math.round(value));

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
    sea: 'Sea',
    seaLevel: (metres: number) => `${formatMetres(metres)} m`,
    perTurn: (coins: number) => `+${coins} / turn`,
    progress: (claimed: number, total: number) => `${claimed} / ${total}`,
    settings: 'Settings',
    newGame: 'New game',
    open: 'Settings',
    close: 'Collapse',
  },
  chess: {
    build: (cost: number) => `Tower · ${cost}`,
    buildTitle: (cost: number) => `Spend the turn and ${cost} coins on a tower next to the king`,
    recruit: (cost: number) => `Pawn · ${cost}`,
    recruitTitle: (cost: number) =>
      `Spend the turn and ${cost} coins on a pawn in one of your towers`,
    building: 'Pick a cell next to the king',
    recruiting: 'Pick one of your towers',
    recruited: 'Pawn recruited',
    turn: (side: string) => `${side} to move`,
    white: 'White',
    black: 'Black',
    won: (side: string, how: 'king' | 'drowned') =>
      how === 'king' ? `${side} takes the king and wins` : `${side} wins — the other king drowned`,
    drowned: (n: number) => (n === 1 ? '1 piece drowned' : `${n} pieces drowned`),
    built: 'Tower built',
    noCoins: (cost: number) => `That costs ${cost} coins`,
    noTower: 'A pawn is recruited into your own tower',
    illegal: 'That piece cannot go there',
    notYours: 'That is not the piece to move',
    newGame: 'Restart the game',
    resumed: (round: number) => `Game resumed — round ${round}`,
    saveCorrupt: 'The saved game could not be read — a new one starts',
    saveNewer: 'The saved game is from a newer version — a new one starts',
  },
  settings: {
    mode: 'Game',
    modeBuild: 'Building',
    modeChess: 'Chess',
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
    flood: 'Flooding',
    floodOn: 'On',
    floodOff: 'Off',
    speed: 'Time speed',
    speedOptions: ['1×', '60×', '600×', '1 day/s'],
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
    sides: 'Sides',
    sidesOne: 'One',
    sidesBoth: 'Two',
  },
  confirm: {
    reset: 'Delete the progress and start over? This cannot be undone.',
    resetYes: 'Delete',
    resetNo: 'Cancel',
  },
  hud: {
    hint: 'Click a cell next to your king to build; click your own land to step',
    hintTouch: 'Tap a cell next to your king to build',
    keyboardHint: 'Arrow keys to select, Enter to build, Shift+Enter to demolish',
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
    flooded: 'That cell is under the sea now',
    failed: 'That did not work — try again',
    income: (amount: number, days: number) =>
      days === 1
        ? `Collected ${amount} coins for one day`
        : `Collected ${amount} coins for ${days} days`,
    reset: 'Progress deleted — a new city',
    drownedWorld: 'The sea had taken every cell — a new world starts',
    demo: 'Demo: the city grew on its own, no coins are earned',
    demoOff: 'Demo off, your city is intact',
    noWebgl: 'WebGL is unavailable — the flat view is on',
    notAdjacent: 'The king moves one cell at a time',
    needKing: 'Place your king on the map to found the capital',
    kingCell: 'The king is standing here — move it first',
    moved: 'The king stepped over',
    storm: (hits: number, destroyed: number) =>
      destroyed > 0
        ? `Hurricane: ${hits} towers damaged, ${destroyed} destroyed`
        : `Hurricane: ${hits} towers damaged`,
    roomSizeLocked: 'The room fixes the map and the rules',
    roomsUnavailable: 'Rooms need the game server, which this static build does not have',
    flood: (level: number, destroyed: number) =>
      destroyed > 0
        ? `Flood: the sea is at ${level} m, ${destroyed} cells drowned`
        : `Flood: the sea is at ${level} m`,
    waitingOpponent: 'Waiting for opponent…',
    opponentConnected: 'Opponent connected',
    opponentDisconnected: 'Opponent disconnected',
    connectionLost: 'Connection lost — reconnecting…',
    connectionFailed: 'Connection failed',
    roomFull: 'Room is full',
    roomGone: 'Room no longer exists',
    badSecret: 'Invalid session — please reload',
    needRefresh: 'Game version mismatch — please refresh',
    you: 'You',
    opponent: 'Opponent',
    yourTurn: 'Your turn',
    theirTurn: "Opponent's turn",
    loaded: (claimed: number) =>
      claimed === 1 ? 'Loaded 1 claimed cell' : `Loaded ${claimed} claimed cells`,
  },
  errors: {
    saveCorrupt: 'The save was corrupted — a new city was started',
    saveNewer: 'This save comes from a newer version of the game — start over',
  },
  room: {
    label: 'Room',
    invite: 'Play with a friend',
    inviteTitle: 'Create a room and copy the link',
    copy: 'Copy the invite link',
    copied: 'Invite link copied',
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
