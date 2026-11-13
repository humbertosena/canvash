import type { CanvasSectionApi } from '@canvash/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { GridOptions, RendererHandle } from './index.js';
import { mount } from './index.js';

const fakeContext = new Proxy({} as Record<string, unknown>, {
  get: (target, key: string) => (key in target ? target[key] : () => undefined),
  set: (target, key: string, value) => {
    target[key] = value;
    return true;
  },
}) as unknown as CanvasRenderingContext2D;

const section = {
  getSnapshot: () => ({
    document: {
      schemaVersion: 1,
      id: 'doc',
      nodes: {},
      layers: [{ id: 'l1', name: 'L1', visible: true, locked: false, childIds: [] }],
    },
    session: {
      selectedIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      tool: 'select',
      readOnly: false,
    },
  }),
  subscribe: () => () => {},
} as unknown as CanvasSectionApi;

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe('posição do ponteiro para o realce do grid', () => {
  let handle: RendererHandle | undefined;

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
  });

  async function setup(grid?: GridOptions): Promise<RendererHandle> {
    const canvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };
    const container = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 300,
      ownerDocument: { createElement: () => canvas, defaultView: { devicePixelRatio: 1 } },
    } as unknown as HTMLElement;
    const result = mount({ section, container, grid });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
    await settle();
    return result.value;
  }

  it('guarda uma cópia da posição e a devolve em getGridPointer', async () => {
    const renderer = await setup();
    const point = { x: 10, y: 20 };
    renderer.setGridPointer(point);
    point.x = 99;

    expect(renderer.getGridPointer()).toEqual({ x: 10, y: 20 });
  });

  it('pede uma pintura por posição nova e agrupa vários movimentos num frame', async () => {
    const renderer = await setup();
    const before = renderer.getMetrics().paintCount;

    renderer.setGridPointer({ x: 10, y: 20 });
    renderer.setGridPointer({ x: 11, y: 21 });
    renderer.setGridPointer({ x: 12, y: 22 });
    await settle();

    expect(renderer.getMetrics().paintCount).toBe(before + 1);
  });

  it('ignora a mesma posição e não pinta em repouso', async () => {
    const renderer = await setup();
    renderer.setGridPointer({ x: 10, y: 20 });
    await settle();
    const painted = renderer.getMetrics().paintCount;

    renderer.setGridPointer({ x: 10, y: 20 });
    await settle();

    expect(renderer.getMetrics().paintCount).toBe(painted);
  });

  it('apagar a posição pinta uma vez; apagar de novo não pinta', async () => {
    const renderer = await setup();
    renderer.setGridPointer({ x: 10, y: 20 });
    await settle();
    const painted = renderer.getMetrics().paintCount;

    renderer.setGridPointer(null);
    await settle();
    expect(renderer.getMetrics().paintCount).toBe(painted + 1);
    expect(renderer.getGridPointer()).toBeNull();

    renderer.setGridPointer(null);
    await settle();
    expect(renderer.getMetrics().paintCount).toBe(painted + 1);
  });

  it.each([
    ['grid desligado', { enabled: false }],
    ['estilo lines', { style: 'lines' as const }],
    ['highlight false', { highlight: false }],
  ])('guarda a posição mas não pinta com %s', async (_name, grid) => {
    const renderer = await setup(grid);
    const painted = renderer.getMetrics().paintCount;

    renderer.setGridPointer({ x: 10, y: 20 });
    await settle();

    expect(renderer.getGridPointer()).toEqual({ x: 10, y: 20 });
    expect(renderer.getMetrics().paintCount).toBe(painted);
  });

  it('destroy zera a posição e ignora chamadas depois', async () => {
    const renderer = await setup();
    renderer.setGridPointer({ x: 10, y: 20 });
    renderer.destroy();

    expect(renderer.getGridPointer()).toBeNull();
    renderer.setGridPointer({ x: 30, y: 40 });
    expect(renderer.getGridPointer()).toBeNull();
  });
});
