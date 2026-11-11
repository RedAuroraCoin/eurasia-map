/**
 * Every user-facing string lives here, so adding a language is adding a file.
 * Keys are grouped by surface; nothing else in the codebase should contain
 * Russian text (the canvas is the one exception and it only draws numbers).
 */
export const ru = {
  app: {
    title: 'Карта Евразии',
    tagline: 'клеточная карта, которая вырастает в стратегию',
  },
  stage: {
    label: 'Этап 1 · данные и скелет',
    note: 'Стройка начнётся на этапе 2',
  },
  map: {
    size: 'Размер карты',
    sizeOption: (n: number) => `${n} клеток`,
    land: 'Суша',
    sea: 'Море',
    cells: 'клеток',
    grid: 'Сетка',
    elevation: 'Высота',
    hint: 'Наведите курсор или выберите клетку стрелками',
    focusHint: 'Стрелки — выбор клетки',
    metres: (m: number) => `${m.toLocaleString('ru-RU')} м`,
    depth: (m: number) => `${Math.abs(m).toLocaleString('ru-RU')} м под водой`,
    cell: (row: number, col: number) => `Строка ${row + 1}, столбец ${col + 1}`,
  },
  theme: {
    label: 'Тема',
    auto: 'Как в системе',
    light: 'Светлая',
    dark: 'Тёмная',
  },
  source: {
    label: 'Данные',
    text: 'Natural Earth 1:50m (общественное достояние) · ETOPO 2022, NOAA/NCEI',
  },
  errors: {
    noWebgl: 'Браузер не поддерживает WebGL — включён упрощённый режим.',
  },
} as const;

export type Dict = typeof ru;
