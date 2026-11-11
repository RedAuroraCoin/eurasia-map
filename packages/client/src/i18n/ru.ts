/**
 * Every user-facing string lives here, so adding a language is adding a file.
 * Nothing else in the client may contain Russian text.
 */
export const ru = {
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
    speed: 'Скорость времени',
    speedOptions: ['1×', '60×', '600×'] as const,
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
  },
  confirm: {
    reset: 'Удалить прогресс и начать заново? Это нельзя отменить.',
    resetYes: 'Удалить',
    resetNo: 'Отмена',
  },
  hud: {
    hint: 'Клик — занять клетку, повторный клик — вернуть монеты',
    hintTouch: 'Коснитесь клетки, чтобы занять её',
    keyboardHint: 'Стрелки — выбор, Enter — занять',
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
    loaded: (claimed: number) => `Прогресс загружен: ${claimed} клеток`,
  },
  errors: {
    saveCorrupt: 'Сохранение повреждено — начат новый город',
    saveNewer: 'Сохранение от более новой версии игры — начни заново',
  },
  legend: {
    elevation: 'Высота',
  },
  source: {
    label: 'Данные',
    text: 'Natural Earth 1:50m · ETOPO 2022, NOAA/NCEI',
  },
} as const;

export type Dict = typeof ru;
