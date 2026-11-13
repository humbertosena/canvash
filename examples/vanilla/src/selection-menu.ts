import type { CanvasSectionApi } from '@canvash/core';
import {
  executeDelete,
  executeGroup,
  executeReorder,
  executeUngroup,
  getGroupActions,
  isSelectionVisible,
  placeSelectionMenu,
  type GroupActionsAvailability,
  type InteractionStateName,
  type ScreenRect,
} from '@canvash/interaction';
import { isMac } from './canvas-controls.js';

/**
 * Mini-menu da seleção do playground Vanilla: trazer para frente, enviar para trás, Agrupar,
 * Desagrupar e excluir.
 * As propriedades moram na ilha da toolbar (`properties-island.ts`). É o mesmo comportamento de
 * `<canvas-selection-menu>`, escrito à mão sobre o HTML da página, com as funções de
 * posicionamento e de edição da interação. No layout clássico (`?layout=classic`) o mini-menu não
 * existe e o painel "Seleção & Tipo" volta à barra fixa.
 */

export interface SelectionMenuHandle {
  /** O estado da interação mudou (`idle`, `moving`...): o menu só aparece em `idle`. */
  notifyInteractionState(state: InteractionStateName): void;
  destroy(): void;
}

export interface SelectionMenuOptions {
  readonly section: CanvasSectionApi;
  /** Elemento do canvas: dá a caixa de apresentação e o foco. */
  readonly container: HTMLElement;
  /** O `#selection-menu`: a barra de ações. */
  readonly root: HTMLElement;
  /**
   * Liga Exportar board: com um board selecionado, o menu mostra o botão e o submenu SVG/PNG, e
   * escolher um formato chama isto. Sem a opção, o botão não é montado.
   */
  readonly onExportBoard?: ((boardId: string, format: 'png' | 'svg') => void) | undefined;
}

/** Altura do submenu de exportação: dois itens de 32 px, o vão e o respiro. */
const EXPORT_MENU_HEIGHT = 2 * 32 + 2 + 10;

/** Tamanho do menu antes da primeira medida: botões de 32 px, vãos de 2 px, respiro e borda. */
const defaultMenuSize = (buttons: number): { width: number; height: number } => ({
  width: 10 + buttons * 32 + (buttons - 1) * 2,
  height: 42,
});

/** Os três botões que existem sempre; Agrupar e Desagrupar entram conforme a seleção. */
const BASE_BUTTONS = 3;

const NO_GROUP_ACTIONS: GroupActionsAvailability = { group: 'hidden', ungroup: 'hidden' };

/** Atalho de cada ação de grupo: texto da dica e `aria-keyshortcuts`, na ordem da plataforma. */
const GROUP_SHORTCUTS = {
  group: {
    label: 'Agrupar',
    mac: { text: '⌘G', keys: 'Meta+G Control+G' },
    other: { text: 'Ctrl+G', keys: 'Control+G Meta+G' },
  },
  ungroup: {
    label: 'Desagrupar',
    mac: { text: '⌘⇧G', keys: 'Meta+Shift+G Control+Shift+G' },
    other: { text: 'Ctrl+Shift+G', keys: 'Control+Shift+G Meta+Shift+G' },
  },
} as const;

/** As ações do menu, na ordem em que aparecem, para o estado de grupo dado. */
function visibleActions(
  { group, ungroup }: GroupActionsAvailability,
  exportBoard: boolean,
): string[] {
  return [
    'bring-to-front',
    'send-to-back',
    ...(group === 'hidden' ? [] : ['group']),
    ...(ungroup === 'hidden' ? [] : ['ungroup']),
    ...(exportBoard ? ['export-board'] : []),
    'delete',
  ];
}

/** Alça de rotação a 24 px da caixa da seleção, mais o raio dela: o menu não a cobre. */
const PLACEMENT = { margin: 16, gap: 12, topInset: 72, rotationHandleOffset: 28 };

/**
 * No layout clássico o painel "Seleção & Tipo" e as seções "Texto na forma" e "Board" voltam à
 * barra fixa, nessa ordem.
 */
function restoreClassicSelectionPanel(): void {
  const row = document.getElementById('selection-panel');
  const label = document.getElementById('label-section');
  const board = document.getElementById('board-section');
  const bar = document.querySelector('.extra-panel');
  if (!bar) return;
  if (row && row.parentElement !== bar) bar.prepend(row);
  if (label && label.parentElement !== bar) {
    if (row) row.after(label);
    else bar.prepend(label);
  }
  if (board && board.parentElement !== bar) {
    const before = label ?? row;
    if (before) before.after(board);
    else bar.prepend(board);
  }
}

export function mountSelectionMenu(options: SelectionMenuOptions): SelectionMenuHandle | null {
  if (document.body.classList.contains('classic')) {
    restoreClassicSelectionPanel();
    return null;
  }

  const { section, container, root, onExportBoard } = options;
  const deleteButton = root.querySelector<HTMLButtonElement>('[data-action="delete"]');
  if (!deleteButton) return null;

  // Os botões de Agrupar e Desagrupar vêm do template, clonados uma vez; entram e saem antes
  // de Excluir conforme a seleção.
  const template = document.getElementById('selection-menu-group-actions');
  const clone =
    template instanceof HTMLTemplateElement
      ? (template.content.cloneNode(true) as DocumentFragment)
      : undefined;
  const groupButtons = {
    group: clone?.querySelector<HTMLButtonElement>('[data-action="group"]') ?? null,
    ungroup: clone?.querySelector<HTMLButtonElement>('[data-action="ungroup"]') ?? null,
  };
  // Exportar board: o botão entra na barra e o submenu vira irmão dela; sem `onExportBoard`, nada
  // disso é montado.
  const exportTemplate = document.getElementById('selection-menu-export-board');
  const exportClone =
    onExportBoard && exportTemplate instanceof HTMLTemplateElement
      ? (exportTemplate.content.cloneNode(true) as DocumentFragment)
      : undefined;
  const exportButton =
    exportClone?.querySelector<HTMLButtonElement>('[data-action="export-board"]') ?? null;
  const exportMenu =
    exportClone?.querySelector<HTMLElement>('#selection-export-board-menu') ?? null;
  if (exportMenu) root.after(exportMenu);
  const exportItems = (): HTMLButtonElement[] => [
    ...(exportMenu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];
  const platform = isMac() ? 'mac' : 'other';
  for (const action of ['group', 'ungroup'] as const) {
    const shortcut = GROUP_SHORTCUTS[action];
    groupButtons[action]?.setAttribute('title', `${shortcut.label} (${shortcut[platform].text})`);
    groupButtons[action]?.setAttribute('aria-keyshortcuts', shortcut[platform].keys);
  }

  /** Os botões do menu agora, na ordem em que aparecem. */
  const currentButtons = (): HTMLButtonElement[] => [
    ...root.querySelectorAll<HTMLButtonElement>('button'),
  ];

  let interactionState: InteractionStateName = 'idle';
  let groupActions: GroupActionsAvailability = NO_GROUP_ACTIONS;
  /** O board selecionado, se Exportar board está ligado e a seleção é só ele. */
  let exportBoardId: string | undefined;
  let toolbarIndex = 0;
  let focusAfter: { readonly action: 'group' | 'ungroup'; readonly index: number } | undefined;
  let frame: number | undefined;
  let framePending = false;

  // Posição -----------------------------------------------------------------------------------

  const originOf = (): { left: number; top: number } => {
    const parent = root.offsetParent;
    const rect = (parent ?? container).getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  };

  /** Onde o menu fica, ou `null` quando não deve aparecer. */
  const computePlacement = (): { x: number; y: number } | null => {
    const { selectedIds, activeTool, readOnly, viewport } = section.getSnapshot().session;
    if (selectedIds.length === 0 || activeTool !== 'select' || readOnly) return null;
    if (interactionState !== 'idle') return null;

    const bounds = section.getBounds(selectedIds, { stroke: true, includePreview: false });
    if (!bounds) return null;

    const canvas = container.getBoundingClientRect();
    const origin = originOf();
    const dx = canvas.left - origin.left;
    const dy = canvas.top - origin.top;
    const selection: ScreenRect = {
      x: bounds.x * viewport.zoom + viewport.x + dx,
      y: bounds.y * viewport.zoom + viewport.y + dy,
      width: bounds.width * viewport.zoom,
      height: bounds.height * viewport.zoom,
    };
    const area: ScreenRect = { x: dx, y: dy, width: canvas.width, height: canvas.height };
    if (!isSelectionVisible(selection, area)) return null;

    // A toolbar fica à direita, sobre o canvas: o menu se posiciona na área livre antes dela.
    const bar = document.getElementById('shell-toolbar')?.getBoundingClientRect();
    const inset = bar ? Math.max(0, canvas.right - bar.left) : 0;
    const free: ScreenRect = { ...area, width: area.width - inset };

    const measured = root.hidden ? undefined : root.getBoundingClientRect();
    const size =
      measured && measured.width > 0
        ? { width: measured.width, height: measured.height }
        : defaultMenuSize(currentButtons().length || BASE_BUTTONS);
    return placeSelectionMenu(selection, size, free, PLACEMENT);
  };

  /** Agrupar e Desagrupar para a seleção, ou os dois escondidos sem seleção. */
  const computeGroupActions = (): GroupActionsAvailability => {
    const { selectedIds } = section.getSnapshot().session;
    return selectedIds.length === 0 ? NO_GROUP_ACTIONS : getGroupActions(section, selectedIds);
  };

  /** O ID do board selecionado, se Exportar board está ligado e a seleção é só ele. */
  const computeExportBoardId = (): string | undefined => {
    if (!exportButton) return undefined;
    const { document: doc, session } = section.getSnapshot();
    if (session.selectedIds.length !== 1) return undefined;
    const id = session.selectedIds[0]!;
    return doc.nodes[id]?.type === 'board' ? id : undefined;
  };

  /**
   * Põe ou tira os botões de grupo e o de exportar, e marca o desabilitado, sem trocar nó quando
   * nada mudou.
   */
  const syncGroupButtons = (
    next: GroupActionsAvailability,
    nextExport: string | undefined,
  ): void => {
    if (
      next.group === groupActions.group &&
      next.ungroup === groupActions.ungroup &&
      nextExport === exportBoardId
    ) {
      return;
    }
    const before = visibleActions(groupActions, exportBoardId !== undefined);
    for (const action of ['group', 'ungroup'] as const) {
      const button = groupButtons[action];
      if (!button) continue;
      if (next[action] === 'hidden') button.remove();
      else if (next[action] === 'disabled') button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
    // Agrupar, depois Desagrupar, direto antes de Excluir; só mexe no nó que está fora do lugar,
    // porque mover um botão focado tira o foco dele.
    let anchor: Element = deleteButton;
    if (exportButton) {
      if (nextExport === undefined) exportButton.remove();
      else if (exportButton.nextElementSibling !== anchor) root.insertBefore(exportButton, anchor);
      if (nextExport !== undefined) anchor = exportButton;
    }
    for (const action of ['ungroup', 'group'] as const) {
      const button = groupButtons[action];
      if (!button || next[action] === 'hidden') continue;
      if (button.nextElementSibling !== anchor) root.insertBefore(button, anchor);
      anchor = button;
    }
    // O botão do tabindex móvel continua o mesmo; se a ação sumiu, vai ao botão da mesma posição.
    const after = visibleActions(next, nextExport !== undefined);
    const kept = after.indexOf(before[toolbarIndex] ?? 'delete');
    toolbarIndex = kept >= 0 ? kept : Math.min(toolbarIndex, after.length - 1);
    // O submenu pertence a um board: se ele mudou, fecha.
    if (nextExport !== exportBoardId) closeExportMenu();
    groupActions = next;
    exportBoardId = nextExport;
    applyTabIndexes();
  };

  // Exportar board ----------------------------------------------------------------------------

  const exportMenuOpen = (): boolean => exportMenu !== null && !exportMenu.hidden;

  const closeExportMenu = (): void => {
    if (!exportMenu) return;
    exportMenu.hidden = true;
    exportButton?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutsidePointer, true);
  };

  /** Clique, toque ou ponteiro fora do menu e do submenu fecham o submenu. */
  function onOutsidePointer(event: Event): void {
    const path = event.composedPath();
    if (exportMenu && path.includes(exportMenu)) return;
    if (path.includes(root)) return;
    closeExportMenu();
  }

  /** Abre o submenu abaixo do botão, ou acima se não couber; `focus` leva o foco a um item. */
  const openExportMenu = (focus?: 'first'): void => {
    if (!exportMenu || !exportButton) return;
    exportMenu.hidden = false;
    exportButton.setAttribute('aria-expanded', 'true');
    const button = exportButton.getBoundingClientRect();
    const origin = originOf();
    const canvas = container.getBoundingClientRect();
    const fits = button.bottom + 4 + EXPORT_MENU_HEIGHT <= canvas.bottom;
    exportMenu.style.left = `${button.left - origin.left}px`;
    exportMenu.style.top = `${(fits ? button.bottom + 4 : button.top - 4 - EXPORT_MENU_HEIGHT) - origin.top}px`;
    document.addEventListener('pointerdown', onOutsidePointer, true);
    if (focus === 'first') exportItems()[0]?.focus();
  };

  /** Escolher um formato fecha o submenu, devolve o foco ao botão e pede a exportação. */
  const chooseExport = (format: 'png' | 'svg'): void => {
    const boardId = exportBoardId;
    if (boardId === undefined) return;
    closeExportMenu();
    exportButton?.focus();
    onExportBoard?.(boardId, format);
  };

  exportButton?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (exportMenuOpen()) exportItems()[0]?.focus();
      else openExportMenu('first');
    } else if (event.key === 'Escape' && exportMenuOpen()) {
      event.preventDefault();
      event.stopPropagation();
      closeExportMenu();
    }
  });
  exportMenu?.addEventListener('keydown', (event) => {
    const { key } = event;
    if (key === 'Tab') {
      closeExportMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(key)) return;
    event.stopPropagation();
    if (key === 'Enter' || key === ' ') return;
    event.preventDefault();
    if (key === 'Escape') {
      closeExportMenu();
      exportButton?.focus();
      return;
    }
    const items = exportItems();
    const from = items.indexOf(event.target as HTMLButtonElement);
    const last = items.length - 1;
    let next: number;
    if (key === 'Home') next = 0;
    else if (key === 'End') next = last;
    else if (key === 'ArrowDown') next = from >= last ? 0 : from + 1;
    else next = from <= 0 ? last : from - 1;
    items[next]?.focus();
  });
  exportMenu?.addEventListener('click', (event) => {
    const item = (event.target as Element).closest<HTMLButtonElement>('[role="menuitem"]');
    const format = item?.dataset['format'];
    if (format === 'png' || format === 'svg') chooseExport(format);
  });

  const applyTabIndexes = (): void => {
    currentButtons().forEach((button, i) => (button.tabIndex = i === toolbarIndex ? 0 : -1));
  };

  /** O foco está no menu ou em lugar nenhum (o botão focado saiu da tela)? */
  const focusIsFree = (): boolean => {
    const active = document.activeElement;
    return active === null || active === document.body || root.contains(active);
  };

  /** Devolve o foco depois de Agrupar ou Desagrupar, quando ele estava no botão da ação. */
  const applyFocusAfter = (): void => {
    const pending = focusAfter;
    if (!pending) return;
    focusAfter = undefined;
    // Se a pessoa já levou o foco para outro lugar, ele não é roubado.
    if (!focusIsFree()) return;
    const buttons = currentButtons();
    if (buttons.length === 0 || root.hidden) {
      // O menu saiu da tela com o botão: o foco volta ao canvas, como no Excluir.
      container.focus();
      return;
    }
    const wanted = pending.action === 'group' ? 'ungroup' : 'group';
    const target =
      buttons.find((button) => button.dataset['action'] === wanted) ??
      buttons[Math.min(pending.index, buttons.length - 1)]!;
    toolbarIndex = buttons.indexOf(target);
    applyTabIndexes();
    target.focus();
  };

  const update = (): void => {
    syncGroupButtons(computeGroupActions(), computeExportBoardId());
    const placement = computePlacement();
    const wasHidden = root.hidden;
    if (!placement) {
      root.hidden = true;
      closeExportMenu();
    } else {
      root.hidden = false;
      root.style.left = `${placement.x}px`;
      root.style.top = `${placement.y}px`;
      // Recém-exibido: o tamanho real só existe agora; reposiciona uma vez com ele.
      if (wasHidden) schedule();
    }
    // O DOM já reflete a ação: o foco pendente se resolve agora, depois do desenho.
    applyFocusAfter();
  };

  /** Agrupa várias mudanças seguidas numa única atualização por quadro. */
  const schedule = (): void => {
    if (framePending) return;
    framePending = true;
    frame = requestAnimationFrame(() => {
      framePending = false;
      update();
    });
  };

  // Ações -------------------------------------------------------------------------------------

  const act = (action: string | undefined): void => {
    const { selectedIds } = section.getSnapshot().session;
    if (action === 'delete') {
      // O foco estava no botão que acabou de sair da tela: devolve-o ao canvas.
      if (executeDelete(section, selectedIds)) container.focus();
    } else if (action === 'group' || action === 'ungroup') {
      // O foco só é devolvido se estava no botão: onde clicar não o foca, nada muda.
      const index = currentButtons().findIndex((button) => button === document.activeElement);
      const done =
        action === 'group'
          ? executeGroup(section, selectedIds)
          : executeUngroup(section, selectedIds);
      if (done && index >= 0) focusAfter = { action, index };
    } else if (action === 'bring-to-front') {
      executeReorder(section, selectedIds, 'bringToFront');
    } else if (action === 'send-to-back') {
      executeReorder(section, selectedIds, 'sendToBack');
    } else if (action === 'export-board') {
      if (exportMenuOpen()) closeExportMenu();
      else openExportMenu(lastClickWasKeyboard ? 'first' : undefined);
    }
  };

  /** Enter e Espaço chegam como clique sem ponteiro (`detail` 0): o foco vai ao primeiro item. */
  let lastClickWasKeyboard = false;

  applyTabIndexes();
  root.addEventListener('focusin', (event) => {
    const index = currentButtons().indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    toolbarIndex = index;
    applyTabIndexes();
  });
  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button');
    lastClickWasKeyboard = event.detail === 0;
    if (button && root.contains(button)) act(button.dataset['action']);
  });

  // Teclado -----------------------------------------------------------------------------------

  /** Setas, Home e End andam entre os botões (tabindex móvel); Tab sai da barra. */
  root.addEventListener('keydown', (event) => {
    const { key } = event;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
    const buttons = currentButtons();
    const from = buttons.indexOf(event.target as HTMLButtonElement);
    const current = from >= 0 ? from : toolbarIndex;
    const last = buttons.length - 1;
    let next: number;
    if (key === 'Home') next = 0;
    else if (key === 'End') next = last;
    else if (key === 'ArrowRight') next = current >= last ? 0 : current + 1;
    else next = current <= 0 ? last : current - 1;
    event.preventDefault();
    buttons[next]?.focus();
  });

  /** ContextMenu e ⇧F10, com o canvas focado, levam o foco ao mini-menu. */
  const onContainerKeydown = (event: KeyboardEvent): void => {
    const contextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!contextKey || event.ctrlKey || event.altKey || event.metaKey || root.hidden) return;
    event.preventDefault();
    currentButtons()[toolbarIndex]?.focus();
  };
  container.addEventListener('keydown', onContainerKeydown);

  // Ligações ----------------------------------------------------------------------------------

  const unsubscribe = section.subscribe(() => schedule());
  const resizeObserver = new ResizeObserver(() => schedule());
  resizeObserver.observe(container);
  resizeObserver.observe(root);
  schedule();

  return {
    notifyInteractionState(state): void {
      interactionState = state;
      schedule();
    },
    destroy(): void {
      unsubscribe();
      closeExportMenu();
      exportMenu?.remove();
      resizeObserver.disconnect();
      container.removeEventListener('keydown', onContainerKeydown);
      if (framePending && frame !== undefined) cancelAnimationFrame(frame);
      framePending = false;
    },
  };
}
