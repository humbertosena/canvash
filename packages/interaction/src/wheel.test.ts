import { createCanvasSection, DEFAULT_ZOOM_LIMITS, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeWheelDelta, WheelAdapter } from './wheel.js';

describe('normalizeWheelDelta', () => {
  it('mantém escala 1:1 para deltaMode 0 (pixels)', () => {
    const delta = normalizeWheelDelta({ deltaX: 15, deltaY: -25, deltaMode: 0 });
    expect(delta).toEqual({ dx: 15, dy: -25 });
  });

  it('multiplica por 16 (padrão) para deltaMode 1 (linhas)', () => {
    const delta = normalizeWheelDelta({ deltaX: 2, deltaY: 3, deltaMode: 1 });
    expect(delta).toEqual({ dx: 32, dy: 48 });
  });

  it('multiplica por 800 (padrão) para deltaMode 2 (páginas)', () => {
    const delta = normalizeWheelDelta({ deltaX: 1, deltaY: -1, deltaMode: 2 });
    expect(delta).toEqual({ dx: 800, dy: -800 });
  });

  it('respeita lineHeight e pageHeight customizados', () => {
    const deltaLine = normalizeWheelDelta({ deltaX: 2, deltaY: 4, deltaMode: 1 }, 20, 1000);
    expect(deltaLine).toEqual({ dx: 40, dy: 80 });

    const deltaPage = normalizeWheelDelta({ deltaX: 2, deltaY: 3, deltaMode: 2 }, 20, 1000);
    expect(deltaPage).toEqual({ dx: 2000, dy: 3000 });
  });
});

describe('WheelAdapter - Lógica e ciclo de vida', () => {
  let element: HTMLElement;
  let section: CanvasSectionApi;
  let adapter: WheelAdapter;
  let listeners: Record<string, ((event: Event) => void)[]>;

  beforeEach(() => {
    listeners = {};
    element = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener as (event: Event) => void);
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((l) => l !== listener);
      },
      getBoundingClientRect() {
        return {
          left: 100,
          top: 50,
          right: 500,
          bottom: 350,
          width: 400,
          height: 300,
          x: 100,
          y: 50,
          toJSON() {
            return this;
          },
        };
      },
    } as unknown as HTMLElement;

    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    adapter = new WheelAdapter({ element, section });
  });

  it('pan por wheel desloca o enquadramento preservando o zoom', () => {
    let prevented = false;
    const event = {
      deltaX: 30,
      deltaY: 50,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      clientX: 200,
      clientY: 150,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as WheelEvent;

    const wheelFn = listeners['wheel']?.[0];
    expect(wheelFn).toBeDefined();
    wheelFn?.(event);

    expect(prevented).toBe(true);
    expect(section.getSnapshot().session.viewport).toEqual({
      x: -30,
      y: -50,
      zoom: 1,
    });
  });

  it('zoom ancorado com ctrlKey aumenta o zoom e ancora na posição do cursor', () => {
    let prevented = false;
    const event = {
      deltaX: 0,
      deltaY: -100, // Scroll up = zoom in
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      clientX: 200, // clientX: 200 - rect.left: 100 => anchor.x = 100
      clientY: 150, // clientY: 150 - rect.top: 50 => anchor.y = 100
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as WheelEvent;

    const wheelFn = listeners['wheel']?.[0];
    expect(wheelFn).toBeDefined();
    wheelFn?.(event);

    expect(prevented).toBe(true);
    const vp = section.getSnapshot().session.viewport;
    expect(vp.zoom).toBeGreaterThan(1);
  });

  it('zoom ancorado com metaKey diminui o zoom com scroll down', () => {
    let prevented = false;
    const event = {
      deltaX: 0,
      deltaY: 100, // Scroll down = zoom out
      deltaMode: 0,
      ctrlKey: false,
      metaKey: true,
      clientX: 300,
      clientY: 200,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as WheelEvent;

    const wheelFn = listeners['wheel']?.[0];
    expect(wheelFn).toBeDefined();
    wheelFn?.(event);

    expect(prevented).toBe(true);
    const vp = section.getSnapshot().session.viewport;
    expect(vp.zoom).toBeLessThan(1);
    expect(vp.zoom).toBeGreaterThanOrEqual(DEFAULT_ZOOM_LIMITS.min);
  });

  it('destroy remove o ouvinte de wheel e é idempotente', () => {
    expect(listeners['wheel']?.length).toBe(1);

    adapter.destroy();
    expect(listeners['wheel']?.length).toBe(0);

    expect(() => adapter.destroy()).not.toThrow();
  });
});
