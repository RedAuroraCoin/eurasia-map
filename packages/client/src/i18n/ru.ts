import type { Dict } from './en';

/**
 * Russian translation, kept because it is the game's original voice — and
 * because it proves the design: one file per language, type-checked against the
 * English dictionary, no code changes needed to switch.
 */
export const ru: Dict = {
  app: {
    title: 'Карта Евразии',
    tagline: 'клеточная карта, которая вырастает в стратегию',
  },
  panel: {
    coins: 'Монеты',
    income: 'Доход',
    perDay: (n: number) => `+${n} в день`,
    cells: 'Клетки',
    progress: (claimed: number, total: number) => `${claimed} / ${total}`,
    settings: 'Настройки',
    open: 'Настройки',
    close: 'Свернуть',
  },
  settings: {
    map: 'Карта',
    size: 'Размер',
    lighting: 'Освещение',
    lightingAuto: 'Авто',
    lightingDay: 'День',
    lightingNight: 'Ночь',
    relief: 'Рельеф',
    reliefOn: 'Объёмный',
    reliefOff: 'Плоский',
    hurricanes: 'Ураганы',
    hurricanesOn: 'Вкл',
    hurricanesOff: 'Выкл',
    flood: 'Затопление',
    floodOn: 'Вкл',
    floodOff: 'Выкл',
    speed: 'Скорость времени',
    speedOptions: ['1×', '60×', '600×'],
    quality: 'Качество',
    qualityAuto: 'Авто',
    qualityHigh: 'Высокое',
    qualityLow: 'Низкое',
    theme: 'Тема',
    themeAuto: 'Авто',
    themeLight: 'Светлая',
    themeDark: 'Тёмная',
    demoOn: 'Демо-город',
    demoOff: 'Выйти из демо',
    reset: 'Начать заново',
    sides: 'Стороны',
    sidesOne: 'Одна',
    sidesBoth: 'Две',
  },
  confirm: {
    reset: 'Удалить прогресс и начать заново? Это нельзя отменить.',
    resetYes: 'Удалить',
    resetNo: 'Отмена',
  },
  hud: {
    hint: 'Клик по клетке рядом с королём — построить; клик по своей — перейти',
    hintTouch: 'Коснитесь клетки рядом с королём, чтобы построить',
    keyboardHint: 'Стрелки — выбор, Enter — построить, Shift+Enter — снести',
    cell: (row: number, col: number) => `Строка ${row + 1}, столбец ${col + 1}`,
    land: 'Суша',
    sea: 'Море',
    metres: (m: number) => `${m.toLocaleString('ru-RU')} м`,
  },
  messages: {
    claimed: (n: number) => `Клетка занята — −${n} монет`,
    unclaimed: (n: number) => `Клетка освобождена — +${n} монет`,
    noCoins: (need: number, have: number) => `Не хватает монет: нужно ${need}, у тебя ${have}`,
    taken: 'Эта клетка уже занята',
    sea: 'В море строить нельзя',
    failed: 'Не получилось — попробуй ещё раз',
    income: (amount: number, days: number) =>
      days === 1 ? `Начислено ${amount} монет за день` : `Начислено ${amount} монет за ${days} дн.`,
    reset: 'Прогресс удалён — новый город',
    demo: 'Демо: город вырос сам, монеты не начисляются',
    demoOff: 'Демо выключено, прогресс на месте',
    noWebgl: 'WebGL недоступен — включён плоский режим',
    notAdjacent: 'Король ходит на одну клетку',
    needKing: 'Поставьте короля на карту, чтобы основать столицу',
    kingCell: 'Здесь стоит король — сначала уведите его',
    moved: 'Король сделал шаг',
    storm: (hits: number, destroyed: number) =>
      destroyed > 0
        ? `Ураган: повреждено ${hits}, разрушено ${destroyed}`
        : `Ураган: повреждено ${hits}`,
    roomSizeLocked: 'В комнате карта и правила зафиксированы',
    flood: (risen: number, destroyed: number) =>
      destroyed > 0
        ? `Затопление: ${destroyed} клеток ушло под воду, вода поднимается в ${risen}`
        : `Затопление: вода поднимается в ${risen} клетках`,
    waitingOpponent: 'Ожидание соперника…',
    opponentConnected: 'Соперник подключился',
    opponentDisconnected: 'Соперник отключился',
    connectionLost: 'Соединение потеряно — переподключение…',
    connectionFailed: 'Не удалось подключиться',
    roomFull: 'Комната заполнена',
    roomGone: 'Комната больше не существует',
    badSecret: 'Неверная сессия — перезагрузите страницу',
    needRefresh: 'Версия игры устарела — обновите страницу',
    you: 'Вы',
    opponent: 'Соперник',
    yourTurn: 'Ваш ход',
    theirTurn: 'Ход соперника',
    loaded: (claimed: number) => `Прогресс загружен: ${claimed} клеток`,
  },
  errors: {
    saveCorrupt: 'Сохранение повреждено — начат новый город',
    saveNewer: 'Сохранение от более новой версии игры — начни заново',
  },
  room: {
    label: 'Комната',
    copy: 'Скопировать ссылку-приглашение',
    copied: 'Ссылка-приглашение скопирована',
  },
  legend: {
    elevation: 'Высота',
    range: '0 — 5 200 м',
  },
  source: {
    label: 'Данные',
    text: 'Natural Earth 1:50m · ETOPO 2022, NOAA/NCEI',
  },
};
