import type { CanvasSectionApi } from '@canvash/core';
import { ISLAND_OPEN_EVENT } from './properties-island.js';

/**
 * Ilhas de grupo da toolbar do Vanilla (layout shell): Figuras, Nota e Desenho. É o mesmo
 * comportamento da `<canvas-toolbar>`, escrito à mão sobre o HTML da página:
 * - o mouse e a caneta abrem a ilha depois de 80 ms e a fecham 250 ms depois de sair do botão e
 *   da ilha; o toque só abre pelo clique;
 * - o clique ativa a última opção usada e fixa a ilha (outro clique a fecha); Esc, Tab, clique fora
 *   e o foco saindo do grupo fecham a ilha fixada;
 * - → abre a ilha com o foco na opção marcada; as setas andam pela grade, Home e End vão às pontas;
 * - escolher uma opção a ativa, lembra dela no botão do grupo e fecha a ilha;
 * - só uma ilha fica aberta por vez.
 * No layout clássico (`?layout=classic`) os botões ficam soltos, sem ilhas, e nada disto roda.
 */

/** Tempo de permanência do mouse no botão antes da ilha abrir. */
const HOVER_OPEN_MS = 80;
/** Tolerância para cruzar o vão entre o botão e a ilha, e voltar, antes de fechar. */
const HOVER_CLOSE_MS = 250;

export interface GhostIslandsOptions {
  readonly section: CanvasSectionApi;
  /** Cores das notas por nome (`yellow`, `pink`...), para pintar as amostras. */
  readonly stickyColors: Readonly<Record<string, string>>;
  /** A cor das próximas notas foi escolhida na ilha. */
  readonly onStickyColor: (hex: string) => void;
}

export interface GhostIslandsHandle {
  /** A cor das próximas notas mudou por outro caminho (o seletor do playground, por exemplo). */
  noteStickyColor(hex: string): void;
  destroy(): void;
}

type GroupName = 'figures' | 'sticky' | 'draw';

interface Group {
  readonly name: GroupName;
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly island: HTMLElement;
  readonly items: HTMLButtonElement[];
  readonly columns: number;
  open: boolean;
  pinned: boolean;
  focused: number;
  hoverTimer: ReturnType<typeof setTimeout> | undefined;
}

const isHoverPointer = (event: PointerEvent): boolean =>
  event.pointerType === 'mouse' || event.pointerType === 'pen';

export function mountGhostIslands(options: GhostIslandsOptions): GhostIslandsHandle | null {
  if (document.body.classList.contains('classic')) return null;
  const { section, stickyColors, onStickyColor } = options;

  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document,
    type: K | string,
    handler: (event: never) => void,
    capture = false,
  ): void => {
    target.addEventListener(type, handler as EventListener, capture);
    cleanups.push(() => target.removeEventListener(type, handler as EventListener, capture));
  };

  const groups: Group[] = [];
  const byName = new Map<GroupName, Group>();

  for (const root of document.querySelectorAll<HTMLElement>('.island-group[data-island]')) {
    const name = root.dataset['island'] as GroupName;
    const button = root.querySelector<HTMLButtonElement>('.group-button');
    const island = root.querySelector<HTMLElement>('.ghost-island');
    if (!button || !island) continue;
    const selector = name === 'sticky' ? '.swatch-button, .wide-button' : 'button[data-tool]';
    const items = [...island.querySelectorAll<HTMLButtonElement>(selector)];
    const group: Group = {
      name,
      root,
      button,
      island,
      items,
      columns: Number(island.dataset['columns'] ?? 4),
      open: false,
      pinned: false,
      focused: 0,
      hoverTimer: undefined,
    };
    groups.push(group);
    byName.set(name, group);
    island.setAttribute('role', 'menu');
    for (const item of items) {
      item.setAttribute(
        'role',
        item.dataset['color'] || item.dataset['tool'] ? 'menuitemradio' : 'menuitem',
      );
      // Só as opções com estado (menuitemradio) têm aria-checked; Personalizada é um menuitem.
      if (item.getAttribute('role') === 'menuitemradio') item.setAttribute('aria-checked', 'false');
      item.tabIndex = -1;
    }
  }

  // ---------- estado lembrado ----------
  const remembered: Record<GroupName, string> = {
    figures: 'rectangle',
    draw: 'bezier',
    sticky: 'yellow',
  };
  let stickyHex: string = stickyColors['yellow'] ?? '#fde68a';

  const toolOf = (item: HTMLElement): string => item.dataset['tool'] ?? '';
  const labelOf = (item: HTMLElement): string =>
    item.querySelector('.btn-label')?.textContent?.trim() ?? item.getAttribute('title') ?? '';

  const itemFor = (group: Group, key: string): HTMLButtonElement | undefined =>
    group.items.find(
      (item) => (group.name === 'sticky' ? item.dataset['color'] : toolOf(item)) === key,
    );

  const sync = (group: Group): void => {
    const { name, button } = group;
    if (name === 'sticky') {
      for (const item of group.items) {
        const color = item.dataset['color'];
        if (color === undefined) continue;
        item.setAttribute('aria-checked', stickyColors[color] === stickyHex ? 'true' : 'false');
      }
      return;
    }
    const current = itemFor(group, remembered[name]);
    for (const item of group.items) {
      item.setAttribute('aria-checked', item === current ? 'true' : 'false');
    }
    if (current) {
      const title = name === 'figures' ? 'Figuras' : 'Desenho';
      button.dataset['tool'] = remembered[name];
      button.setAttribute('aria-label', `${title}: ${labelOf(current)}`);
    }
  };

  const syncPressed = (): void => {
    const active = section.getSnapshot().session.activeTool;
    for (const [id, tool] of [
      ['btn-tool-select', 'select'],
      ['btn-tool-hand', 'hand'],
      ['btn-tool-text', 'text'],
    ] as const) {
      document.getElementById(id)?.setAttribute('aria-pressed', String(active === tool));
    }
    for (const group of groups) {
      const mine =
        group.name === 'sticky'
          ? active === 'sticky'
          : group.items.some((item) => toolOf(item) === active);
      if (mine && group.name !== 'sticky') remembered[group.name] = active;
      group.button.setAttribute('aria-pressed', String(mine));
      sync(group);
    }
  };

  // ---------- abrir e fechar ----------
  const clearTimer = (group: Group): void => {
    if (group.hoverTimer === undefined) return;
    clearTimeout(group.hoverTimer);
    group.hoverTimer = undefined;
  };

  const render = (group: Group): void => {
    group.island.classList.toggle('open', group.open);
    group.button.setAttribute('aria-expanded', String(group.open));
    group.items.forEach((item, index) => {
      item.tabIndex = group.open && index === group.focused ? 0 : -1;
    });
  };

  const initialIndex = (group: Group): number => {
    if (group.name === 'sticky') {
      const index = group.items.findIndex((item) => item.getAttribute('aria-checked') === 'true');
      return index >= 0 ? index : 0;
    }
    return Math.max(0, group.items.indexOf(itemFor(group, remembered[group.name])!));
  };

  const closeGroup = (group: Group, restoreFocus = false): void => {
    clearTimer(group);
    if (!group.open) return;
    group.open = false;
    group.pinned = false;
    render(group);
    if (restoreFocus) group.button.focus();
  };

  const openGroup = (group: Group, pinned: boolean): void => {
    clearTimer(group);
    if (group.open) {
      if (pinned) group.pinned = true;
      return;
    }
    for (const other of groups) if (other !== group) closeGroup(other);
    document.dispatchEvent(new CustomEvent(ISLAND_OPEN_EVENT, { detail: { source: 'groups' } }));
    group.open = true;
    group.pinned = pinned;
    group.focused = initialIndex(group);
    sync(group);
    render(group);
    if (pinned) group.items[group.focused]?.focus();
  };

  for (const group of groups) {
    const { button, island, root } = group;

    // Hover: o botão e a ilha contam como uma área só.
    const enter = (event: PointerEvent): void => {
      if (!isHoverPointer(event)) return;
      clearTimer(group);
      if (group.open) return;
      group.hoverTimer = setTimeout(() => {
        group.hoverTimer = undefined;
        if (!group.open) openGroup(group, false);
      }, HOVER_OPEN_MS);
    };
    const leave = (event: PointerEvent): void => {
      if (!isHoverPointer(event)) return;
      clearTimer(group);
      if (!group.open || group.pinned) return;
      group.hoverTimer = setTimeout(() => {
        group.hoverTimer = undefined;
        if (!group.pinned) closeGroup(group);
      }, HOVER_CLOSE_MS);
    };
    listen(button, 'pointerenter', enter);
    listen(button, 'pointerleave', leave);
    listen(island, 'pointerenter', enter);
    listen(island, 'pointerleave', leave);

    // O Safari foca o ancestral ao pressionar o botão: o foco que muda por isso não fecha.
    let pressing = false;
    listen(root, 'pointerdown', () => {
      pressing = true;
    });
    listen(
      document,
      'pointerup',
      () => {
        pressing = false;
      },
      true,
    );
    listen(root, 'focusout', ((event: FocusEvent) => {
      const next = event.relatedTarget as Element | null;
      if (next === null || pressing || root.contains(next)) return;
      closeGroup(group);
    }) as never);

    // Clique no botão: ativa a opção lembrada e fixa a ilha (ou fecha a que já estava fixada).
    listen(button, 'click', () => {
      activateRemembered(group);
      if (group.open && group.pinned) closeGroup(group);
      else openGroup(group, true);
    });
    listen(button, 'keydown', ((event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft') return;
      event.preventDefault();
      openGroup(group, true);
    }) as never);

    // Teclado dentro da ilha.
    listen(island, 'keydown', ((event: KeyboardEvent) => {
      const last = group.items.length - 1;
      const index = group.focused;
      const target: number | undefined = {
        ArrowRight: index + 1,
        ArrowLeft: index - 1,
        ArrowDown: index + group.columns,
        ArrowUp: index - group.columns,
        Home: 0,
        End: last,
      }[event.key];
      if (target !== undefined) {
        event.preventDefault();
        group.focused = Math.min(Math.max(target, 0), last);
        render(group);
        group.items[group.focused]?.focus();
        return;
      }
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        closeGroup(group, true);
      }
    }) as never);

    group.items.forEach((item, index) => {
      listen(item, 'focus', () => {
        group.focused = index;
        render(group);
      });
      listen(item, 'click', () => choose(group, item));
    });
  }

  // Abrir Propriedades fecha as ilhas de grupo.
  listen(document, ISLAND_OPEN_EVENT, ((event: CustomEvent<{ source: string }>) => {
    if (event.detail.source === 'groups') return;
    for (const group of groups) closeGroup(group);
  }) as never);

  // Clique fora fecha as ilhas fixadas.
  listen(
    document,
    'pointerdown',
    ((event: PointerEvent) => {
      const path = event.composedPath();
      for (const group of groups) if (!path.includes(group.root)) closeGroup(group);
    }) as never,
    true,
  );

  // ---------- ativar ----------
  function activateRemembered(group: Group): void {
    if (group.name === 'sticky') {
      document.getElementById('btn-tool-sticky')?.click();
      return;
    }
    const item = itemFor(group, remembered[group.name]);
    if (item) press(item);
  }

  /** Aciona o botão da ferramenta; os ativos de fora da ilha (caneta, borracha) vêm por proxy. */
  function press(item: HTMLButtonElement): void {
    const proxy = item.dataset['proxy'];
    if (proxy) document.getElementById(proxy)?.click();
    else section.setTool(toolOf(item));
  }

  function choose(group: Group, item: HTMLButtonElement): void {
    if (group.name === 'sticky') {
      if (item.id === 'btn-sticky-custom') {
        const input = document.getElementById('input-sticky-custom') as HTMLInputElement | null;
        if (!input) return;
        if (typeof input.showPicker === 'function') input.showPicker();
        else input.click();
        return;
      }
      const hex = stickyColors[item.dataset['color'] ?? ''];
      if (hex === undefined) return;
      stickyHex = hex;
      onStickyColor(hex);
      section.setTool('sticky');
      sync(group);
      closeGroup(group, true);
      return;
    }
    const tool = toolOf(item);
    remembered[group.name] = tool;
    // O botão de figura tem o próprio ouvinte (main.ts); só a Tinta e a borracha precisam de proxy.
    if (item.dataset['proxy']) press(item);
    sync(group);
    closeGroup(group, true);
  }

  const custom = document.getElementById('input-sticky-custom') as HTMLInputElement | null;
  if (custom) {
    listen(custom, 'change', () => {
      stickyHex = custom.value;
      onStickyColor(custom.value);
      section.setTool('sticky');
      const sticky = byName.get('sticky');
      if (sticky) {
        sync(sticky);
        closeGroup(sticky, true);
      }
    });
  }

  // ---------- amostras de cor e estado inicial ----------
  for (const swatch of document.querySelectorAll<HTMLElement>('#sticky-island [data-swatch]')) {
    const hex = stickyColors[swatch.dataset['swatch'] ?? ''];
    if (hex) swatch.style.background = hex;
  }
  const unsubscribe = section.subscribe((change) => {
    if (change.areas.includes('tool')) syncPressed();
  });
  syncPressed();
  for (const group of groups) {
    sync(group);
    render(group);
  }

  return {
    noteStickyColor(hex: string): void {
      stickyHex = hex;
      const sticky = byName.get('sticky');
      if (sticky) sync(sticky);
    },
    destroy(): void {
      unsubscribe();
      for (const group of groups) clearTimer(group);
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
    },
  };
}
