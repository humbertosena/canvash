import { createCanvasSection, type CanvasSectionApi, type StickyNode } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachInteractions, type InteractionHandle } from './index.js';

describe('nota adesiva pelo handle de interação (navegador)', () => {
  let container: HTMLElement;
  let section: CanvasSectionApi;
  let handle: InteractionHandle;

  const click = (x: number, y: number): void => {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      container.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          buttons: type === 'pointerdown' ? 1 : 0,
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      );
    }
  };

  const notes = (): StickyNode[] =>
    Object.values(section.getSnapshot().document.nodes).filter(
      (node): node is StickyNode => node.type === 'sticky',
    );

  beforeEach(() => {
    container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '600px';
    container.style.height = '400px';
    document.body.appendChild(container);
    section = createCanvasSection();
    handle = attachInteractions({ section, element: container });
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  it('expõe a cor das próximas notas, com o amarelo como padrão', () => {
    expect(handle.getStickyColor()).toBe('#fff59d');
    handle.setStickyColor('#c8e6c9');
    expect(handle.getStickyColor()).toBe('#c8e6c9');
    handle.setStickyColor('verde');
    expect(handle.getStickyColor()).toBe('#c8e6c9');
  });

  it('clicar com a ferramenta abre o editor na cor escolhida e Ctrl+Enter cria a nota', () => {
    handle.setStickyColor('#c8e6c9');
    section.setTool('sticky');
    click(120, 90);

    expect(handle.getState()).toBe('editing-text');
    const textarea = handle.getTextEditor!().getTextArea()!;
    expect(textarea.style.background).toContain('rgb(200, 230, 201)');
    expect(notes()).toHaveLength(0);

    textarea.value = 'Primeira nota';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    const [note] = notes();
    expect(note).toMatchObject({
      x: 120,
      y: 90,
      width: 200,
      height: 200,
      text: 'Primeira nota',
      style: { fill: '#c8e6c9' },
    });
    expect(section.getSnapshot().session.activeTool).toBe('select');
    expect(handle.getTextEditor!().isActive()).toBe(false);
  });

  it('duplo clique numa nota com a seleção a abre no editor e Esc mantém o texto', () => {
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'note', type: 'sticky', x: 50, y: 50, text: 'guardado' },
    });
    container.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 100, clientY: 100, button: 0, bubbles: true }),
    );

    expect(handle.getState()).toBe('editing-text');
    const textarea = handle.getTextEditor!().getTextArea()!;
    expect(textarea.value).toBe('guardado');
    textarea.value = 'descartado';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(handle.getState()).toBe('idle');
    expect(section.getSnapshot().document.nodes['note']).toMatchObject({ text: 'guardado' });
  });
});
