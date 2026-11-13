import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachInteractions, type InteractionHandle } from './index.js';

function getRect(section: CanvasSectionApi, id: string) {
  const node = section.getSnapshot().document.nodes[id];
  return node && node.type === 'rectangle' ? node : undefined;
}

describe('KeyboardAdapter no navegador real (Vitest Browser Mode / Chromium)', () => {
  let container1: HTMLElement;
  let container2: HTMLElement;
  let outsideInput: HTMLInputElement;
  let section1: CanvasSectionApi;
  let section2: CanvasSectionApi;
  let handle1: InteractionHandle;
  let handle2: InteractionHandle;

  beforeEach(() => {
    document.body.innerHTML = '';

    container1 = document.createElement('div');
    container1.id = 'canvas-1';
    container1.style.width = '300px';
    container1.style.height = '300px';
    document.body.appendChild(container1);

    container2 = document.createElement('div');
    container2.id = 'canvas-2';
    container2.style.width = '300px';
    container2.style.height = '300px';
    document.body.appendChild(container2);

    outsideInput = document.createElement('input');
    outsideInput.id = 'external-input';
    outsideInput.type = 'text';
    document.body.appendChild(outsideInput);

    section1 = createCanvasSection();
    section2 = createCanvasSection();

    // Cria nó em canvas 1
    section1.dispatch({
      type: 'shape.create',
      shape: {
        id: 'shape-1',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    section1.setSelection(['shape-1']);

    // Cria nó em canvas 2
    section2.dispatch({
      type: 'shape.create',
      shape: {
        id: 'shape-2',
        type: 'rectangle',
        x: 60,
        y: 60,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    section2.setSelection(['shape-2']);

    handle1 = attachInteractions({ section: section1, element: container1 });
    handle2 = attachInteractions({ section: section2, element: container2 });
  });

  afterEach(() => {
    handle1?.destroy();
    handle2?.destroy();
    container1?.remove();
    container2?.remove();
    outsideInput?.remove();
    document.body.innerHTML = '';
  });

  it('exclui seleção com Delete apenas quando container1 tem foco (INPUT-10)', () => {
    container1.focus();
    expect(document.activeElement).toBe(container1);

    const deleteEvent = new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(deleteEvent);

    // Canvas 1 deve ter shape-1 excluído
    expect(section1.getSnapshot().document.nodes['shape-1']).toBeUndefined();
    // Canvas 2 NÃO deve ser afetado (INPUT-10)
    expect(section2.getSnapshot().document.nodes['shape-2']).toBeDefined();

    handle1.destroy();
    handle2.destroy();
  });

  it('desloca shape com setas apenas no canvas focado (INPUT-10)', () => {
    container1.focus();

    // ArrowRight desloca +1 px
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(getRect(section1, 'shape-1')?.x).toBe(51);
    expect(getRect(section2, 'shape-2')?.x).toBe(60);

    // Shift+ArrowDown desloca +10 px
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(getRect(section1, 'shape-1')?.y).toBe(60);
    expect(getRect(section2, 'shape-2')?.y).toBe(60);

    handle1.destroy();
    handle2.destroy();
  });

  it('não dispara atalhos quando o foco está em input externo (INPUT-10)', () => {
    outsideInput.focus();
    expect(document.activeElement).toBe(outsideInput);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );

    // Ambos os canvas devem permanecer intactos
    expect(section1.getSnapshot().document.nodes['shape-1']).toBeDefined();
    expect(getRect(section1, 'shape-1')?.x).toBe(50);
    expect(section2.getSnapshot().document.nodes['shape-2']).toBeDefined();
    expect(getRect(section2, 'shape-2')?.x).toBe(60);

    handle1.destroy();
    handle2.destroy();
  });

  it('aplica o zoom do teclado só no canvas focado, em torno do centro do próprio elemento', () => {
    const press = (init: KeyboardEventInit): boolean => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    container1.focus();
    expect(press({ key: '=', code: 'Equal', ctrlKey: true })).toBe(true);

    const viewport = section1.getSnapshot().session.viewport;
    expect(viewport.zoom).toBeCloseTo(1.2, 10);
    // o ponto de mundo no centro do contêiner de 300 × 300 continua no centro
    expect((150 - viewport.x) / viewport.zoom).toBeCloseTo(150, 6);
    expect((150 - viewport.y) / viewport.zoom).toBeCloseTo(150, 6);
    expect(section2.getSnapshot().session.viewport.zoom).toBe(1);

    // com o foco num campo externo, nada acontece e o navegador mantém o comportamento dele
    outsideInput.focus();
    expect(press({ key: '=', code: 'Equal', ctrlKey: true })).toBe(false);
    expect(section1.getSnapshot().session.viewport.zoom).toBeCloseTo(1.2, 10);
  });

  describe('com o editor dentro de um Shadow DOM (como o <canvas-canvas>)', () => {
    let host: HTMLElement;
    let surface: HTMLElement;
    let editor: HTMLTextAreaElement;
    let shadowSection: CanvasSectionApi;
    let shadowHandle: InteractionHandle;

    beforeEach(() => {
      host = document.createElement('div');
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      surface = document.createElement('div');
      surface.style.width = '300px';
      surface.style.height = '300px';
      surface.tabIndex = 0;
      editor = document.createElement('textarea');
      surface.appendChild(editor);
      root.appendChild(surface);

      shadowSection = createCanvasSection();
      shadowSection.dispatch({
        type: 'shape.create',
        shape: {
          id: 'in-shadow',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
        },
      });
      shadowSection.setSelection(['in-shadow']);
      shadowHandle = attachInteractions({ section: shadowSection, element: surface });
    });

    afterEach(() => {
      shadowHandle?.destroy();
      host?.remove();
    });

    const press = (target: HTMLElement, init: KeyboardEventInit): boolean => {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it('reconhece o foco na superfície do Shadow DOM, embora document.activeElement seja o host', () => {
      surface.focus();
      expect(document.activeElement).toBe(host);

      expect(press(surface, { key: 'Delete' })).toBe(true);
      expect(shadowSection.getSnapshot().document.nodes['in-shadow']).toBeUndefined();
    });

    it('aplica o zoom do teclado com o foco na superfície do Shadow DOM', () => {
      surface.focus();

      expect(press(surface, { key: '=', code: 'Equal', ctrlKey: true })).toBe(true);
      expect(shadowSection.getSnapshot().session.viewport.zoom).toBeCloseTo(1.2, 10);
    });

    it('não dispara atalhos enquanto se digita num campo de texto dentro do Shadow DOM', () => {
      editor.focus();

      expect(press(editor, { key: 'Delete' })).toBe(false);
      expect(press(editor, { key: 'Backspace' })).toBe(false);
      expect(press(editor, { key: '=', code: 'Equal', ctrlKey: true })).toBe(false);

      expect(shadowSection.getSnapshot().document.nodes['in-shadow']).toBeDefined();
      expect(shadowSection.getSnapshot().session.viewport.zoom).toBe(1);
    });
  });
});
