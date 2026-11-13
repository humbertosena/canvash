import type { CanvasSectionApi } from '@canvash/core';
import {
  ZOOM_STEP_FACTOR,
  executeFitContent,
  executeFitSelection,
  executeZoomBy,
  executeZoomReset,
} from '@canvash/interaction';

/**
 * Controles da base do canvas do playground Vanilla: desfazer e refazer, menu de zoom e ajuda.
 * É o mesmo comportamento de `<canvas-controls>`, escrito à mão sobre o HTML da página e
 * sobre as funções de zoom da interação.
 */

export interface CanvasControlsHandle {
  destroy(): void;
}

export interface CanvasControlsOptions {
  readonly section: CanvasSectionApi;
  /** Elemento do canvas: o tamanho dele é a área em que o zoom se ancora no centro. */
  readonly container: HTMLElement;
  /** Raiz do HTML dos controles (`#canvas-controls`). */
  readonly root: HTMLElement;
}

type ZoomItemId = 'in' | 'out' | 'reset' | 'fit' | 'selection';

export const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform);

const ZOOM_SHORTCUTS: Record<ZoomItemId, { mac: string; other: string }> = {
  in: { mac: '⌘=', other: 'Ctrl+=' },
  out: { mac: '⌘-', other: 'Ctrl+-' },
  reset: { mac: '⇧0', other: 'Shift+0' },
  fit: { mac: '⇧1', other: 'Shift+1' },
  selection: { mac: '⇧2', other: 'Shift+2' },
};

const command = (mac: boolean, key: string, shift = false): string =>
  mac ? `⌘${shift ? '⇧' : ''}${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;

/** Atalhos reais do editor, agrupados como o diálogo de ajuda os mostra. */
function helpSections(mac: boolean): ReadonlyArray<[string, ReadonlyArray<[string, string]>]> {
  const zoomKeys = (id: ZoomItemId): string => ZOOM_SHORTCUTS[id][mac ? 'mac' : 'other'];
  return [
    [
      'Edição',
      [
        ['Excluir a seleção', 'Delete / Backspace'],
        ['Editar o texto da forma', 'Enter'],
        ['Mover a seleção (com Shift, 10 px)', '← ↑ → ↓'],
        ['Desfazer', command(mac, 'Z')],
        ['Refazer', mac ? '⌘⇧Z' : `${command(mac, 'Z', true)} / Ctrl+Y`],
        ['Cancelar o gesto em andamento', 'Esc'],
      ],
    ],
    [
      'Organização',
      [
        ['Agrupar', command(mac, 'G')],
        ['Desagrupar', command(mac, 'G', true)],
        ['Trazer para a frente', command(mac, ']', true)],
        ['Avançar um nível', command(mac, ']')],
        ['Recuar um nível', command(mac, '[')],
        ['Enviar para trás', command(mac, '[', true)],
      ],
    ],
    [
      'Visão',
      [
        ['Mover a visão (segurar e arrastar)', 'Espaço'],
        ['Aproximar', zoomKeys('in')],
        ['Afastar', zoomKeys('out')],
        ['Zoom em 100%', zoomKeys('reset')],
        ['Ajustar ao conteúdo', zoomKeys('fit')],
        ['Ajustar à seleção', zoomKeys('selection')],
      ],
    ],
  ];
}

export function mountCanvasControls(options: CanvasControlsOptions): CanvasControlsHandle {
  const { section, container, root } = options;
  const mac = isMac();

  const query = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Controles do canvas: ${selector} não encontrado`);
    return element;
  };

  const undoButton = query<HTMLButtonElement>('[data-action="undo"]');
  const redoButton = query<HTMLButtonElement>('[data-action="redo"]');
  const zoomButton = query<HTMLButtonElement>('[data-action="open-zoom"]');
  const zoomMenu = query<HTMLElement>('[role="menu"]');
  const helpButton = query<HTMLButtonElement>('[data-action="open-help"]');
  const helpDialog = query<HTMLDialogElement>('dialog');
  const helpBody = query<HTMLElement>('[data-help-body]');
  const items = Array.from(zoomMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

  const size = () => ({ width: container.clientWidth, height: container.clientHeight });
  const itemId = (item: HTMLElement): ZoomItemId => item.dataset['zoom'] as ZoomItemId;

  const isDisabled = (id: ZoomItemId): boolean => {
    const snap = section.getSnapshot();
    if (id === 'fit') return Object.keys(snap.document.nodes).length === 0;
    if (id === 'selection') return snap.session.selectedIds.length === 0;
    return false;
  };

  const render = (): void => {
    const snap = section.getSnapshot();
    const readOnly = snap.session.readOnly;
    undoButton.disabled = !snap.history.canUndo || readOnly;
    redoButton.disabled = !snap.history.canRedo || readOnly;
    const percent = Math.round(snap.session.viewport.zoom * 100);
    zoomButton.textContent = `${percent}%`;
    zoomButton.setAttribute('aria-label', `Zoom: ${percent}%`);
    for (const item of items) {
      item.setAttribute('aria-disabled', isDisabled(itemId(item)) ? 'true' : 'false');
    }
  };

  // Menu de zoom -----------------------------------------------------------------------------

  const closeOnOutsidePointer = (event: Event): void => {
    if (!event.composedPath().includes(root)) closeMenu(false);
  };

  function openMenu(): void {
    if (!zoomMenu.hidden) return;
    zoomMenu.hidden = false;
    zoomButton.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    items[0]?.focus();
  }

  function closeMenu(restoreFocus: boolean): void {
    if (zoomMenu.hidden) return;
    zoomMenu.hidden = true;
    zoomButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    if (restoreFocus) zoomButton.focus();
  }

  const activate = (id: ZoomItemId): void => {
    if (isDisabled(id)) return;
    if (id === 'in') executeZoomBy(section, size(), ZOOM_STEP_FACTOR);
    if (id === 'out') executeZoomBy(section, size(), 1 / ZOOM_STEP_FACTOR);
    if (id === 'reset') executeZoomReset(section, size());
    if (id === 'fit') executeFitContent(section, size());
    if (id === 'selection') executeFitSelection(section, size());
    closeMenu(true);
  };

  zoomButton.addEventListener('click', () => (zoomMenu.hidden ? openMenu() : closeMenu(false)));
  zoomButton.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    openMenu();
  });
  zoomMenu.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const last = items.length - 1;
    const target: number | undefined = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      items[Math.min(Math.max(target, 0), last)]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      closeMenu(true);
    }
  });
  for (const item of items) {
    item.addEventListener('click', () => activate(itemId(item)));
    const shortcut = item.querySelector('.cc-shortcut');
    if (shortcut) shortcut.textContent = ZOOM_SHORTCUTS[itemId(item)][mac ? 'mac' : 'other'];
  }

  // Histórico ---------------------------------------------------------------------------------

  undoButton.addEventListener('click', () => void section.undo());
  redoButton.addEventListener('click', () => void section.redo());

  // Ajuda -------------------------------------------------------------------------------------

  for (const [title, rows] of helpSections(mac)) {
    const helpSection = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = title;
    const list = document.createElement('dl');
    for (const [label, keys] of rows) {
      const row = document.createElement('div');
      row.className = 'cc-help-row';
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      description.append(kbd);
      row.append(term, description);
      list.append(row);
    }
    helpSection.append(heading, list);
    helpBody.append(helpSection);
  }

  helpButton.addEventListener('click', () => {
    if (helpDialog.open) return;
    closeMenu(false);
    helpDialog.showModal();
  });
  query<HTMLButtonElement>('[data-action="close-help"]').addEventListener('click', () => {
    if (helpDialog.open) helpDialog.close();
  });
  helpDialog.addEventListener('close', () => helpButton.focus());

  const unsubscribe = section.subscribe(render);
  render();

  return {
    destroy(): void {
      unsubscribe();
      closeMenu(false);
    },
  };
}
