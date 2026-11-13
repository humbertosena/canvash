import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCanvasSection, type CanvasSectionApi, type RectangleNode } from '@canvash/core';
import { attachInteractions, type InteractionHandle } from './index.js';

describe('Toque, multitoque e caneta no Chromium real (INPUT-01, INPUT-05)', () => {
  let container: HTMLElement;
  let section: CanvasSectionApi;
  let handle: InteractionHandle;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '600px';
    container.style.height = '400px';
    container.style.position = 'relative';
    document.body.appendChild(container);

    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    handle = attachInteractions({ section, element: container });
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  it('cria retângulo perfeitamente com ponteiro do tipo touch (INPUT-01)', () => {
    section.setTool('rectangle');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 150,
        clientY: 130,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(section.getPreview()).not.toBeNull();

    container.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        clientX: 150,
        clientY: 130,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();

    const selectedId = section.getSnapshot().session.selectedIds[0]!;
    const node = section.getSnapshot().document.nodes[selectedId] as RectangleNode;
    expect(node.type).toBe('rectangle');
    expect(node.width).toBe(100);
    expect(node.height).toBe(80);
  });

  it('move shape com precisão usando caneta stylus (pen) (INPUT-01)', () => {
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'box-pen',
        type: 'rectangle',
        x: 60,
        y: 60,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });

    section.setTool('select');
    section.setSelection(['box-pen']);

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'pen',
        button: 0,
        buttons: 1,
        clientX: 80,
        clientY: 80,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        pointerType: 'pen',
        clientX: 130,
        clientY: 120,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('moving');

    container.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
        pointerType: 'pen',
        button: 0,
        clientX: 130,
        clientY: 120,
        bubbles: true,
      }),
    );

    const node = section.getSnapshot().document.nodes['box-pen'] as RectangleNode;
    expect(node.x).toBe(110);
    expect(node.y).toBe(100);
  });

  it('segundo toque cancela criação e aciona pinch zoom / pan (INPUT-05)', () => {
    section.setTool('rectangle');

    // 1º toque inicia criação
    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 10,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 10,
        pointerType: 'touch',
        clientX: 150,
        clientY: 150,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');
    expect(section.getPreview()).not.toBeNull();

    // 2º toque toca a tela: DEVE cancelar a criação imediatamente!
    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 11,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 300,
        clientY: 50,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(0);

    // Movimento com os dois dedos afasta e dá zoom
    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 10,
        pointerType: 'touch',
        clientX: 0,
        clientY: 50,
        buttons: 1,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 11,
        pointerType: 'touch',
        clientX: 500,
        clientY: 50,
        buttons: 1,
        bubbles: true,
      }),
    );

    const vp = section.getSnapshot().session.viewport;
    expect(vp.zoom).toBeGreaterThan(1.2);
  });
});
