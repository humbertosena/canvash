import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { attachInteractions, type InteractionHandle } from './index.js';

describe('Cancelamento no navegador real (Chromium) - INPUT-02, INPUT-05', () => {
  let container: HTMLElement;
  let section: CanvasSectionApi;
  let handle: InteractionHandle;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '600px';
    container.style.height = '400px';
    container.style.position = 'relative';
    container.style.cursor = 'auto';
    container.style.touchAction = 'pan-x';
    document.body.appendChild(container);

    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    handle = attachInteractions({ section, element: container });
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  it('cancela criação de shape via Escape na janela sem alterar documento', () => {
    section.setTool('rectangle');
    const initialRev = section.getSnapshot().revision;

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 50,
        clientY: 50,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 150,
        clientY: 150,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');
    expect(section.getPreview()).not.toBeNull();

    // Pressiona Escape na janela
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(section.getSnapshot().revision).toBe(initialRev);
    expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(0);
  });

  it('cancela gesto quando a janela perde o foco (window.blur)', () => {
    section.setTool('rectangle');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'mouse',
        clientX: 60,
        clientY: 60,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        pointerType: 'mouse',
        clientX: 160,
        clientY: 160,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');
    expect(section.getPreview()).not.toBeNull();

    // Simula blur da janela
    window.dispatchEvent(new Event('blur'));

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
  });

  it('cancela gesto quando o sistema dispara pointercancel', () => {
    section.setTool('rectangle');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 3,
        pointerType: 'touch',
        clientX: 70,
        clientY: 70,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');

    container.dispatchEvent(
      new PointerEvent('pointercancel', {
        pointerId: 3,
        pointerType: 'touch',
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
  });

  it('cancela gesto quando perde captura do ponteiro (lostpointercapture)', () => {
    section.setTool('rectangle');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 4,
        pointerType: 'mouse',
        clientX: 80,
        clientY: 80,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');

    container.dispatchEvent(
      new PointerEvent('lostpointercapture', {
        pointerId: 4,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
  });

  it('cancela gesto se o ponteiro sair do elemento sem captura (pointerleave)', () => {
    section.setTool('rectangle');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 5,
        pointerType: 'mouse',
        clientX: 90,
        clientY: 90,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');

    // Força hasPointerCapture a retornar false
    container.hasPointerCapture = vi.fn().mockReturnValue(false);

    container.dispatchEvent(
      new PointerEvent('pointerleave', {
        pointerId: 5,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
  });

  it('não cancela pointerleave se o elemento possuir pointer capture ativa', () => {
    section.setTool('rectangle');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 6,
        pointerType: 'mouse',
        clientX: 100,
        clientY: 100,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 6,
        pointerType: 'mouse',
        clientX: 180,
        clientY: 180,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');
    expect(section.getPreview()).not.toBeNull();

    // Com captura ativa
    container.hasPointerCapture = vi.fn().mockReturnValue(true);

    container.dispatchEvent(
      new PointerEvent('pointerleave', {
        pointerId: 6,
        bubbles: true,
      }),
    );

    // Permanece creating
    expect(handle.getState()).toBe('creating');
    expect(section.getPreview()).not.toBeNull();
  });

  it('cancela gesto se receber pointermove com buttons === 0', () => {
    section.setTool('rectangle');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 7,
        pointerType: 'mouse',
        clientX: 110,
        clientY: 110,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');

    // Movimento com botões zerados
    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 7,
        pointerType: 'mouse',
        clientX: 200,
        clientY: 200,
        buttons: 0,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
  });

  it('destroy() descarta preview e restaura estilo e listeners', () => {
    section.setTool('rectangle');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 8,
        pointerType: 'mouse',
        clientX: 120,
        clientY: 120,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('creating');

    handle.destroy();

    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(container.style.touchAction).toBe('pan-x');
    expect(container.style.cursor).toBe('auto');
  });
});
