import { describe, expect, it } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';

interface Testable {
  _container: HTMLElement | null;
  _rendererHandle: { getGridPointer: () => unknown } | undefined;
  _gridOptions(): { highlight?: boolean; size?: number; style?: string };
  _mount(): void;
  updated(changedProperties: Map<string, unknown>): void;
}

type Listener = (event: unknown) => void;

function fakeContainer(listeners: Map<string, Listener[]> = new Map()): HTMLElement {
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
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    focus: () => undefined,
    querySelector: () => container,
  };
  return container as unknown as HTMLElement;
}

describe('CanvasSurfaceElement: realce do grid', () => {
  it('liga o realce por padrão e expõe o atributo grid-highlight', () => {
    const el = new CanvasSurfaceElement();

    expect(el.gridHighlight).toBe('on');
    const properties = CanvasSurfaceElement.properties as Record<
      string,
      { attribute?: string; reflect?: boolean }
    >;
    expect(properties['gridHighlight']?.attribute).toBe('grid-highlight');
    expect(properties['gridHighlight']?.reflect).toBe(true);
  });

  it('passa highlight ao renderer: ligado por padrão, desligado com "off"', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as Testable;
    expect(testable._gridOptions().highlight).toBe(true);

    el.gridHighlight = 'off';
    expect(testable._gridOptions().highlight).toBe(false);
  });

  it('mantém tamanho e estilo junto com o realce', () => {
    const el = new CanvasSurfaceElement();
    el.grid = true;
    el.gridSize = 40;
    el.gridStyle = 'lines';
    el.gridHighlight = 'off';

    expect((el as unknown as Testable)._gridOptions()).toEqual({
      size: 40,
      style: 'lines',
      highlight: false,
    });
  });

  it('leva o pointermove do contêiner até o renderer, em CSS px do elemento', () => {
    const listeners = new Map<string, Listener[]>();
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as Testable;
    testable._container = fakeContainer(listeners);
    testable._mount();

    for (const listener of listeners.get('pointermove') ?? []) {
      listener({ pointerId: 1, pointerType: 'mouse', clientX: 120, clientY: 80, buttons: 0 });
    }

    expect(testable._rendererHandle?.getGridPointer()).toEqual({ x: 120, y: 80 });
  });

  it('remonta o renderer quando gridHighlight muda depois de montado', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as Testable;
    testable._container = fakeContainer();
    testable._mount();
    const before = testable._rendererHandle;
    expect(before).toBeDefined();

    el.gridHighlight = 'off';
    testable.updated(new Map<string, unknown>([['gridHighlight', 'on']]));

    expect(testable._rendererHandle).toBeDefined();
    expect(testable._rendererHandle).not.toBe(before);
  });
});
