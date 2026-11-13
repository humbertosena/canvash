import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CanvasToolbarElement } from './canvas-toolbar.js';

beforeAll(() => {
  if (!customElements.get('canvas-toolbar')) {
    customElements.define('canvas-toolbar', CanvasToolbarElement);
  }
});

afterEach(() => {
  document.body.innerHTML = '';
});

function select(section: CanvasSectionApi, id: string): void {
  section.dispatch({
    type: 'shape.create',
    shape: { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  });
  section.setSelection([id]);
}

/** Toolbar vertical colada à direita (ou onde se pedir) e a meia altura, com um painel tão alto quanto se pedir. */
async function mount(options: {
  contentHeight: number;
  top?: string;
  left?: string;
}): Promise<CanvasToolbarElement> {
  const toolbar = document.createElement('canvas-toolbar') as CanvasToolbarElement;
  toolbar.orientation = 'vertical';
  const side = options.left === undefined ? 'right: 16px' : `left: ${options.left}`;
  toolbar.style.cssText = `position: fixed; ${side}; top: ${options.top ?? '50%'}; z-index: 5`;
  const content = document.createElement('div');
  content.slot = 'properties';
  content.style.cssText = `height: ${options.contentHeight}px; background: #ccc`;
  toolbar.append(content);
  document.body.append(toolbar);
  const section = createCanvasSection();
  toolbar.section = section;
  select(section, 'a');
  await toolbar.updateComplete;
  return toolbar;
}

const panelOf = (toolbar: CanvasToolbarElement): HTMLElement | null =>
  toolbar.shadowRoot?.querySelector<HTMLElement>('.properties-panel') ?? null;

const buttonOf = (toolbar: CanvasToolbarElement): HTMLElement =>
  toolbar.shadowRoot!.querySelector<HTMLElement>('[data-action="properties"]')!;

async function open(toolbar: CanvasToolbarElement): Promise<void> {
  toolbar.propertiesOpen = true;
  await toolbar.updateComplete;
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

describe('<canvas-toolbar> no navegador real: painel de Propriedades', () => {
  it('abre à esquerda da ilha, a 12 px, alinhado ao topo do botão', async () => {
    const toolbar = await mount({ contentHeight: 120, top: '200px' });
    await open(toolbar);

    const panel = panelOf(toolbar)!.getBoundingClientRect();
    const bar = toolbar.shadowRoot!.querySelector('[part~="toolbar"]')!.getBoundingClientRect();
    const button = buttonOf(toolbar).getBoundingClientRect();
    expect(panel.right).toBeLessThanOrEqual(bar.left);
    expect(bar.left - panel.right).toBeLessThanOrEqual(20);
    expect(Math.abs(panel.top - button.top)).toBeLessThanOrEqual(1);
    expect(panel.width).toBeLessThanOrEqual(280);
  });

  it('com conteúdo alto, fica dentro da tela e rola por dentro', async () => {
    const toolbar = await mount({ contentHeight: 2000 });
    await open(toolbar);

    const panelEl = panelOf(toolbar)!;
    const panel = panelEl.getBoundingClientRect();
    expect(panel.top).toBeGreaterThanOrEqual(0);
    expect(panel.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(panelEl.scrollHeight).toBeGreaterThan(panelEl.clientHeight);
    expect(getComputedStyle(panelEl).overflowY).toBe('auto');
  });

  it('perto do pé da tela, o painel sobe para caber', async () => {
    const toolbar = await mount({ contentHeight: 300, top: `${window.innerHeight - 120}px` });
    await open(toolbar);

    const panel = panelOf(toolbar)!.getBoundingClientRect();
    expect(panel.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(panel.top).toBeGreaterThanOrEqual(0);
  });

  it('colada à borda esquerda, a toolbar abre o painel para a direita, dentro da tela', async () => {
    const toolbar = await mount({ contentHeight: 120, left: '16px' });
    await open(toolbar);

    const panelEl = panelOf(toolbar)!;
    const panel = panelEl.getBoundingClientRect();
    const bar = toolbar.shadowRoot!.querySelector('[part~="toolbar"]')!.getBoundingClientRect();
    expect(panelEl.classList.contains('flipped')).toBe(true);
    expect(panel.left).toBeGreaterThanOrEqual(bar.right);
    expect(panel.right).toBeLessThanOrEqual(window.innerWidth);
  });

  it('o slot properties mostra o conteúdo do host', async () => {
    const toolbar = await mount({ contentHeight: 80 });
    await open(toolbar);

    const slot = panelOf(toolbar)!.querySelector('slot[name="properties"]') as HTMLSlotElement;
    expect(slot.assignedElements()).toHaveLength(1);
    expect(slot.assignedElements()[0]!.getBoundingClientRect().height).toBe(80);
  });
});
