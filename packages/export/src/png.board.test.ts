import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPng } from './index.js';

// Erros e limite do PNG do board, sem alocar canvas (spec board-export, US-BE.4 e US-BE.5).

function setup(size = { width: 300, height: 200 }): CanvasSectionApi {
  const section = createCanvasSection();
  const result = section.transact([
    { type: 'shape.create', shape: { id: 'b1', type: 'board', x: 100, y: 50, ...size } },
    {
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 0, y: 0, width: 5, height: 5, rotation: 0 },
    },
  ] as never);
  expect(result.ok).toBe(true);
  return section;
}

describe('exportPng: escopo de board sem criar canvas', () => {
  const factory = vi.fn();
  let original: unknown;

  beforeEach(() => {
    original = (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    factory.mockReset();
    (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = factory;
  });

  afterEach(() => {
    (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas = original;
  });

  const run = async (section: CanvasSectionApi, scope: unknown, options = {}) => {
    const result = await exportPng(section, { scope, ...options } as never);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava erro');
    return result.error;
  };

  it('US-BE.4: devolve INVALID_SCOPE com o motivo certo, sem chamar a fábrica de canvas', async () => {
    const section = setup();
    expect((await run(section, { board: 'nope' })).details).toEqual({
      reason: 'not-found',
      id: 'nope',
    });
    expect((await run(section, { board: 'r' })).details).toEqual({
      reason: 'not-a-board',
      id: 'r',
    });
    for (const scope of [
      { board: 42 },
      { board: '' },
      { board: 'b1', x: 0, width: 10 },
      {},
      null,
    ]) {
      const error = await run(section, scope);
      expect(error.code).toBe('INVALID_SCOPE');
      expect(error.details).toEqual({ reason: 'malformed' });
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it('US-BE.4: board oculto e board em camada oculta dão hidden', async () => {
    const hidden = setup();
    hidden.dispatch({ type: 'shape.update', id: 'b1', patch: { visible: false } });
    expect((await run(hidden, { board: 'b1' })).details).toEqual({ reason: 'hidden', id: 'b1' });

    const layerHidden = setup();
    layerHidden.dispatch({
      type: 'layer.update',
      id: layerHidden.getSnapshot().document.layers[0]!.id,
      patch: { visible: false },
    });
    expect((await run(layerHidden, { board: 'b1' })).details).toEqual({
      reason: 'hidden',
      id: 'b1',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('US-BE.5: um board de 5000 × 5000 com scale 2 dá LIMIT_EXCEEDED antes de alocar', async () => {
    const error = await run(setup({ width: 5000, height: 5000 }), { board: 'b1' }, { scale: 2 });

    expect(error.code).toBe('LIMIT_EXCEEDED');
    expect(factory).not.toHaveBeenCalled();
  });

  it('os erros não mudam a revisão nem o histórico', async () => {
    const section = setup();
    const before = section.getSnapshot();

    await run(section, { board: 'nope' });
    await run(section, null);

    expect(section.getSnapshot().revision).toBe(before.revision);
    expect(section.getSnapshot().history).toEqual(before.history);
  });
});
