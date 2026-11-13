import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { prepareExportContext } from './bounds.js';

describe('prepareExportContext', () => {
  it('calcula bounds para grupo de formas', () => {
    const section = createCanvasSection();

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 10, y: 10, width: 20, height: 20, rotation: 0 },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 's2', type: 'rectangle', x: 50, y: 50, width: 30, height: 30, rotation: 0 },
    });

    // Cria grupo contendo s1 e s2
    section.dispatch({
      type: 'group.create',
      childIds: ['s1', 's2'],
    });

    const ctx = prepareExportContext(section, { padding: 5 });
    expect(ctx.bounds.x).toBeLessThanOrEqual(5);
    expect(ctx.bounds.width).toBeGreaterThanOrEqual(70);
  });

  it('calcula bounds quando escopo é seleção contendo um grupo', () => {
    const section = createCanvasSection();

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 10, y: 10, width: 20, height: 20, rotation: 0 },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 's2', type: 'rectangle', x: 50, y: 50, width: 30, height: 30, rotation: 0 },
    });

    section.dispatch({
      type: 'group.create',
      id: 'g1',
      childIds: ['s1', 's2'],
    });

    // Seleciona o grupo
    section.setSelection(['g1']);

    const ctx = prepareExportContext(section, { scope: 'selection' });
    expect(ctx.candidateIds).toBeDefined();
    expect(ctx.candidateIds?.has('s1')).toBe(true);
    expect(ctx.candidateIds?.has('s2')).toBe(true);
  });
});

describe('prepareExportContext com o texto da forma (US-SL.12)', () => {
  it('os limites da exportação não mudam com o texto', () => {
    const shape = { type: 'rectangle', x: 10, y: 10, width: 100, height: 60, rotation: 0 } as const;
    const plain = createCanvasSection();
    plain.dispatch({ type: 'shape.create', shape: { id: 'a', ...shape } });
    const withText = createCanvasSection();
    withText.dispatch({
      type: 'shape.create',
      shape: { id: 'a', ...shape, label: { text: 'x'.repeat(2000) } },
    });

    expect(prepareExportContext(withText, { padding: 4 }).bounds).toEqual(
      prepareExportContext(plain, { padding: 4 }).bounds,
    );
  });
});
