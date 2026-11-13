import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { attachInteractions, type InteractionHandle } from './index.js';

describe('WheelAdapter no navegador real (Vitest Browser Mode / Chromium)', () => {
  let container: HTMLElement;
  let outsideEl: HTMLElement;
  let section: CanvasSectionApi;
  let handle: InteractionHandle;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '500px';
    container.style.height = '400px';
    container.style.position = 'relative';
    document.body.appendChild(container);

    outsideEl = document.createElement('div');
    outsideEl.style.width = '200px';
    outsideEl.style.height = '200px';
    document.body.appendChild(outsideEl);

    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    handle = attachInteractions({ section, element: container });
  });

  it('evento de wheel no container realiza pan e previne scroll padrão', () => {
    const event = new WheelEvent('wheel', {
      deltaX: 40,
      deltaY: 30,
      deltaMode: 0,
      clientX: 250,
      clientY: 200,
      bubbles: true,
      cancelable: true,
    });

    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(section.getSnapshot().session.viewport).toEqual({
      x: -40,
      y: -30,
      zoom: 1,
    });
  });

  it('Ctrl+wheel no container realiza zoom ancorado no cursor', () => {
    const event = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: -60, // Zoom in
      deltaMode: 0,
      ctrlKey: true,
      clientX: 250,
      clientY: 200,
      bubbles: true,
      cancelable: true,
    });

    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    const vp = section.getSnapshot().session.viewport;
    expect(vp.zoom).toBeGreaterThan(1);
    // Como a âncora é no centro (250, 200) e antes estava em (0, 0, 1),
    // o deslocamento (x, y) deve ter compensado para manter o centro ancorado
    expect(vp.x).not.toBe(0);
    expect(vp.y).not.toBe(0);
  });

  it('eventos fora do editor não são interceptados e o canvas fica intacto', () => {
    const event = new WheelEvent('wheel', {
      deltaX: 50,
      deltaY: 50,
      deltaMode: 0,
      clientX: 10,
      clientY: 10,
      bubbles: true,
      cancelable: true,
    });

    outsideEl.dispatchEvent(event);

    // Não deve prevenir nem alterar o canvas
    expect(event.defaultPrevented).toBe(false);
    expect(section.getSnapshot().session.viewport).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
  });

  it('destroy() remove o listener e eventos subsequentes não alteram o viewport', () => {
    handle.destroy();

    const event = new WheelEvent('wheel', {
      deltaX: 50,
      deltaY: 50,
      deltaMode: 0,
      clientX: 250,
      clientY: 200,
      bubbles: true,
      cancelable: true,
    });

    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(section.getSnapshot().session.viewport).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
  });
});
