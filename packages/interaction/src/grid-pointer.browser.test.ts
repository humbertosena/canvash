import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachInteractions, type InteractionHandle } from './index.js';

type Published = { x: number; y: number } | null;

describe('posição do ponteiro publicada para o realce do grid', () => {
  let container: HTMLElement;
  let section: CanvasSectionApi;
  let handle: InteractionHandle | undefined;
  let published: Published[];

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = 'width:400px;height:300px;position:absolute;left:30px;top:20px';
    document.body.appendChild(container);
    section = createCanvasSection();
    published = [];
  });

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    container.remove();
  });

  const attach = (options: Partial<Parameters<typeof attachInteractions>[0]> = {}) => {
    handle = attachInteractions({
      section,
      element: container,
      onGridPointerChange: (point) => published.push(point),
      ...options,
    });
  };

  const fire = (type: string, init: PointerEventInit & { pointerType?: string } = {}): void => {
    container.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', bubbles: true, ...init }),
    );
  };

  const last = (): Published | undefined => published[published.length - 1];

  it('publica a posição do mouse relativa ao elemento', () => {
    attach();
    const rect = container.getBoundingClientRect();

    fire('pointermove', { clientX: rect.left + 120, clientY: rect.top + 80 });

    expect(last()).toEqual({ x: 120, y: 80 });
  });

  it('publica também a posição da caneta', () => {
    attach();
    const rect = container.getBoundingClientRect();

    fire('pointermove', { pointerType: 'pen', clientX: rect.left + 10, clientY: rect.top + 15 });

    expect(last()).toEqual({ x: 10, y: 15 });
  });

  it('continua publicando com o botão pressionado, no arraste e no pan', () => {
    attach();
    section.setTool('hand');
    const rect = container.getBoundingClientRect();

    fire('pointerdown', { button: 0, buttons: 1, clientX: rect.left + 50, clientY: rect.top + 50 });
    fire('pointermove', { buttons: 1, clientX: rect.left + 90, clientY: rect.top + 70 });

    expect(last()).toEqual({ x: 90, y: 70 });
  });

  it('não publica movimento de toque e limpa o realce no toque', () => {
    attach();
    const rect = container.getBoundingClientRect();
    fire('pointermove', { clientX: rect.left + 20, clientY: rect.top + 20 });
    published.length = 0;

    fire('pointermove', {
      pointerType: 'touch',
      pointerId: 2,
      clientX: rect.left + 5,
      clientY: rect.top + 5,
    });
    expect(published).toEqual([]);

    fire('pointerdown', {
      pointerType: 'touch',
      pointerId: 2,
      clientX: rect.left + 5,
      clientY: rect.top + 5,
    });
    expect(published).toEqual([null]);
  });

  it('publica null no pointerleave, no pointercancel e no destroy', () => {
    attach();
    const rect = container.getBoundingClientRect();

    fire('pointermove', { clientX: rect.left + 20, clientY: rect.top + 20 });
    fire('pointerleave');
    expect(last()).toBeNull();

    fire('pointermove', { clientX: rect.left + 20, clientY: rect.top + 20 });
    fire('pointercancel');
    expect(last()).toBeNull();

    fire('pointermove', { clientX: rect.left + 20, clientY: rect.top + 20 });
    handle?.destroy();
    expect(last()).toBeNull();
  });

  it('publica no modo somente leitura', () => {
    attach();
    section.setReadOnly(true);
    const rect = container.getBoundingClientRect();

    fire('pointermove', { clientX: rect.left + 40, clientY: rect.top + 30 });

    expect(last()).toEqual({ x: 40, y: 30 });
  });

  it('usa renderer.setGridPointer por padrão e deixa onGridPointerChange vencer', () => {
    const fromRenderer = vi.fn();
    const explicit = vi.fn();
    const rect = container.getBoundingClientRect();

    handle = attachInteractions({
      section,
      element: container,
      renderer: { setGuides: () => undefined, setGridPointer: fromRenderer },
    });
    fire('pointermove', { clientX: rect.left + 7, clientY: rect.top + 9 });
    expect(fromRenderer).toHaveBeenCalledWith({ x: 7, y: 9 });
    handle.destroy();

    handle = attachInteractions({
      section,
      element: container,
      renderer: { setGuides: () => undefined, setGridPointer: fromRenderer },
      onGridPointerChange: explicit,
    });
    fromRenderer.mockClear();
    fire('pointermove', { clientX: rect.left + 8, clientY: rect.top + 6 });
    expect(explicit).toHaveBeenCalledWith({ x: 8, y: 6 });
    expect(fromRenderer).not.toHaveBeenCalled();
  });

  it('sem nenhum destino não quebra', () => {
    handle = attachInteractions({ section, element: container });
    const rect = container.getBoundingClientRect();

    expect(() =>
      fire('pointermove', { clientX: rect.left + 1, clientY: rect.top + 1 }),
    ).not.toThrow();
  });
});
