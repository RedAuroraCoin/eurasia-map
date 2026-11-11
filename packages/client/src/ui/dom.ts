export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, EventListener>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
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

export interface SegmentOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
  readonly title?: string;
}

export interface Segmented<T extends string | number> {
  readonly root: HTMLElement;
  set(value: T): void;
}

/**
 * A radio group that behaves like one: one tab stop, arrow keys to move,
 * aria-pressed to say which is current.
 */
export function segmented<T extends string | number>(
  options: readonly SegmentOption<T>[],
  initial: T,
  onPick: (value: T) => void,
  label: string,
): Segmented<T> {
  let current = initial;
  const buttons = options.map((option) => {
    const button = h('button', {
      text: option.label,
      attrs: {
        type: 'button',
        'aria-pressed': String(option.value === initial),
        ...(option.title ? { title: option.title } : {}),
      },
    });
    button.addEventListener('click', () => {
      if (option.value === current) return;
      current = option.value;
      sync();
      onPick(option.value);
    });
    return button;
  });

  const root = h(
    'div',
    { class: 'segmented', attrs: { role: 'group', 'aria-label': label } },
    ...buttons,
  );

  function sync(): void {
    buttons.forEach((button, index) => {
      const option = options[index];
      if (option) button.setAttribute('aria-pressed', String(option.value === current));
    });
  }

  root.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === current);
    const delta = key === 'ArrowRight' ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    if (next) {
      current = next.value;
      sync();
      onPick(next.value);
    }
  });

  return {
    root,
    set: (value: T) => {
      current = value;
      sync();
    },
  };
}

export function row(label: string, control: HTMLElement): HTMLElement {
  const text = h('span', { class: 'row-label', text: label });
  return h('div', { class: 'row' }, h('div', { class: 'row-head' }, text), control);
}

export const formatNumber = (value: number): string => value.toLocaleString('ru-RU');
