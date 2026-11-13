import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';

interface Testable {
  _container: HTMLElement | null;
  _section: unknown;
  _mount(): void;
  _onEraserSizeChange(event: Event): void;
  _onPenSettingsChange(event: Event): void;
  _onStickyColorChange(event: Event): void;
}

function fakeContainer(): HTMLElement {
  const context = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : () => undefined),
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
  const canvas = {
    getContext: () => context,
    remove: () => undefined,
    width: 800,
    height: 600,
    style: {} as Record<string, string>,
  };
  const container = {
    clientWidth: 800,
    clientHeight: 600,
    style: {} as Record<string, string>,
    appendChild: () => undefined,
    ownerDocument: {
      createElement: (tag: string) => (tag === 'canvas' ? canvas : {}),
      createComment: () => ({}),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    focus: () => undefined,
    querySelector: () => container,
  };
  return container as unknown as HTMLElement;
}

const announce = (detail: unknown): Event => new CustomEvent('announce', { detail });

describe('CanvasSurfaceElement: anúncios da toolbar', () => {
  it('só aplica o tamanho da borracha anunciado para o próprio canvas', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as Testable;
    const own = createCanvasSection();
    el.section = own;

    testable._onEraserSizeChange(announce(undefined));
    testable._onEraserSizeChange(announce({ section: createCanvasSection(), size: 'thick' }));
    expect(el.getEraserSize()).toBeUndefined();

    testable._onEraserSizeChange(announce({ section: own, size: 'thick' }));
    expect(el.getEraserSize()).toBe('thick');
  });

  it('só aplica a caneta anunciada para o próprio canvas', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as Testable;
    const own = createCanvasSection();
    el.section = own;

    testable._onPenSettingsChange(announce(undefined));
    testable._onPenSettingsChange(
      announce({ section: createCanvasSection(), settings: { color: '#ff0000' } }),
    );
    expect(el.getPenSettings()).toBeUndefined();

    testable._onPenSettingsChange(announce({ section: own, settings: { color: '#ff0000' } }));
    expect(el.getPenSettings()).toEqual({ color: '#ff0000' });
  });

  it('só aplica a cor da nota anunciada para o próprio canvas', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as Testable;
    const own = createCanvasSection();
    el.section = own;

    testable._onStickyColorChange(announce(undefined));
    testable._onStickyColorChange(announce({ section: createCanvasSection(), color: '#ff00ff' }));
    expect(el.getStickyColor()).toBeUndefined();

    testable._onStickyColorChange(announce({ section: own, color: '#ff00ff' }));
    expect(el.getStickyColor()).toBe('#ff00ff');
  });

  it('entrega ao motor de interação o que foi definido antes da montagem', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as Testable;
    el.setStickyColor('#ffee00');
    el.setPenSettings({ color: '#112233', kind: 'pen', width: 'medium' });
    el.setEraserSize('thin');

    testable._container = fakeContainer();
    testable._mount();

    expect(el.getStickyColor()).toBe('#ffee00');
    expect(el.getPenSettings()?.color).toBe('#112233');
    expect(el.getEraserSize()).toBe('thin');
  });
});
