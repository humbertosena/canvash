import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSelectionMenuElement } from './canvas-selection-menu.js';

// O teclado, o foco e o fechamento do submenu Exportar board, no navegador (US-BE.8).

if (!customElements.get('canvas-selection-menu-export-test')) {
  customElements.define('canvas-selection-menu-export-test', CanvasSelectionMenuElement);
}

describe('<canvas-selection-menu export-board>: teclado e foco (navegador)', () => {
  let host: HTMLElement;
  let el: CanvasSelectionMenuElement;
  let section: CanvasSectionApi;
  let outside: HTMLButtonElement;

  const shadow = () => el.shadowRoot!;
  const buttons = () => [...shadow().querySelectorAll<HTMLElement>('.menu button')];
  const exportButton = () => shadow().querySelector<HTMLElement>('[data-action="export-board"]')!;
  const items = () => [...shadow().querySelectorAll<HTMLElement>('.export-menu [role="menuitem"]')];
  const focused = () => shadow().activeElement;
  const press = (target: Element, key: string) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }),
    );
  const settle = async () => {
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await el.updateComplete;
  };

  beforeEach(async () => {
    host = document.createElement('div');
    host.style.cssText = 'position:relative;width:1000px;height:700px';
    document.body.append(host);
    outside = document.createElement('button');
    outside.textContent = 'fora';
    document.body.append(outside);

    section = createCanvasSection();
    section.transact([
      {
        type: 'shape.create',
        shape: { id: 'bd', type: 'board', x: 200, y: 200, width: 300, height: 200 },
      },
    ] as never);
    el = document.createElement('canvas-selection-menu-export-test') as CanvasSelectionMenuElement;
    host.append(el);
    el.section = section;
    // O canvas é um elemento de verdade (o menu o observa); `host` ganha o que o menu lê dele.
    Object.assign(host, { interactionState: 'idle' });
    el.canvas = host as unknown as CanvasSelectionMenuElement['canvas'];
    el.exportBoard = true;
    section.setSelection(['bd']);
    await settle();
    await settle();
  });

  afterEach(() => {
    host.remove();
    outside.remove();
  });

  it('o botão chega pelas setas da barra; Home e End vão ao primeiro e ao último sem contar o submenu', async () => {
    expect(buttons().map((b) => b.dataset['action'])).toEqual([
      'bring-to-front',
      'send-to-back',
      'export-board',
      'delete',
    ]);
    buttons()[1]!.focus();
    press(buttons()[1]!, 'ArrowRight');
    expect(focused()).toBe(exportButton());

    exportButton().click();
    await settle();
    expect(items()).toHaveLength(2);
    expect(buttons()).toHaveLength(4);

    exportButton().focus();
    press(exportButton(), 'End');
    expect(focused()).toBe(buttons()[3]);
    press(buttons()[3]!, 'Home');
    expect(focused()).toBe(buttons()[0]);
  });

  it('Enter abre o submenu com foco em SVG; a seta para baixo vai a PNG; Home e End ficam no submenu', async () => {
    exportButton().focus();
    // Enter no botão vira clique sem ponteiro (detail 0), como no teclado.
    exportButton().dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, detail: 0 }),
    );
    await settle();

    expect(exportButton().getAttribute('aria-expanded')).toBe('true');
    expect(focused()).toBe(items()[0]);
    expect(items()[0]!.dataset['format']).toBe('svg');

    press(items()[0]!, 'ArrowDown');
    expect(focused()).toBe(items()[1]);
    expect(items()[1]!.dataset['format']).toBe('png');

    const indexBefore = (el as unknown as { _toolbarIndex: number })._toolbarIndex;
    press(items()[1]!, 'Home');
    expect(focused()).toBe(items()[0]);
    press(items()[0]!, 'End');
    expect(focused()).toBe(items()[1]);
    expect((el as unknown as { _toolbarIndex: number })._toolbarIndex).toBe(indexBefore);
  });

  it('a seta para baixo no botão também abre, com foco no primeiro item', async () => {
    exportButton().focus();

    press(exportButton(), 'ArrowDown');
    await settle();

    expect(focused()).toBe(items()[0]);
  });

  it('as teclas do submenu não sobem para fora', async () => {
    exportButton().click();
    await settle();
    const seen = vi.fn();
    host.addEventListener('keydown', seen);

    for (const key of ['Home', 'End', 'ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape']) {
      press(items()[0]!, key);
    }

    expect(seen).not.toHaveBeenCalled();
  });

  it('Esc fecha e devolve o foco ao botão', async () => {
    exportButton().focus();
    press(exportButton(), 'ArrowDown');
    await settle();

    press(items()[0]!, 'Escape');
    await settle();

    expect(items()).toHaveLength(0);
    expect(exportButton().getAttribute('aria-expanded')).toBe('false');
    expect(focused()).toBe(exportButton());
  });

  it('Tab e o clique fora fecham o submenu', async () => {
    exportButton().click();
    await settle();
    press(items()[0]!, 'Tab');
    await settle();
    expect(items()).toHaveLength(0);

    exportButton().click();
    await settle();
    expect(items()).toHaveLength(2);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    await settle();
    expect(items()).toHaveLength(0);
  });

  it('escolher um item emite o pedido e devolve o foco ao botão', async () => {
    const request = vi.fn();
    el.addEventListener('export-board-request', request);
    exportButton().click();
    await settle();

    items()[1]!.click();
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
    expect((request.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      boardId: 'bd',
      format: 'png',
    });
    expect(focused()).toBe(exportButton());
    expect(items()).toHaveLength(0);
  });

  it('o submenu fecha ao mudar a seleção', async () => {
    exportButton().click();
    await settle();

    section.setSelection([]);
    await settle();
    await settle();

    expect(items()).toHaveLength(0);
  });

  it('o submenu fica abaixo do botão', async () => {
    exportButton().click();
    await settle();

    const button = exportButton().getBoundingClientRect();
    const menu = shadow().querySelector('.export-menu')!.getBoundingClientRect();

    expect(menu.top).toBeGreaterThanOrEqual(button.bottom);
  });
});
