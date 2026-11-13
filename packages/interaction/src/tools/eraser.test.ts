import { createCanvasSection, inkStrokesToWorld, type InkNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ERASER_SIZE,
  buildEraseCommands,
  buildErasePreviews,
  eraseSegment,
  eraserSegmentBounds,
  isEraserSize,
  type ErasedInk,
} from './eraser.js';

describe('utilitários da borracha', () => {
  it('isEraserSize aceita os três tamanhos e recusa o resto', () => {
    for (const size of ['thin', 'medium', 'thick']) expect(isEraserSize(size)).toBe(true);
    for (const value of ['fina', '', 7, null, undefined]) expect(isEraserSize(value)).toBe(false);
    expect(DEFAULT_ERASER_SIZE).toBe('medium');
  });

  it('eraserSegmentBounds alarga a caixa do segmento pelo raio, em qualquer direção', () => {
    expect(eraserSegmentBounds({ x: 10, y: 20 }, { x: 30, y: 5 }, 4)).toEqual({
      x: 6,
      y: 1,
      width: 28,
      height: 23,
    });
    expect(eraserSegmentBounds({ x: 30, y: 5 }, { x: 10, y: 20 }, 4)).toEqual({
      x: 6,
      y: 1,
      width: 28,
      height: 23,
    });
  });
});

describe('passada sobre o canvas', () => {
  function setup() {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'k',
        type: 'ink',
        strokes: [
          {
            points: [
              { x: 0, y: 100 },
              { x: 200, y: 100 },
            ],
          },
        ],
      },
    });
    return { section, erased: new Map<string, ErasedInk>() };
  }

  it('acumula o estado apagado e reaproveita a base entre trechos', () => {
    const { section, erased } = setup();
    expect(eraseSegment(section, erased, { x: 50, y: 80 }, { x: 50, y: 120 }, 'medium', 1)).toBe(
      true,
    );
    const first = erased.get('k')!;
    expect(first.changed).toBe(true);
    expect(first.world).toHaveLength(2);

    // Um segundo trecho longe do primeiro corta de novo sobre o estado já apagado.
    expect(eraseSegment(section, erased, { x: 150, y: 80 }, { x: 150, y: 120 }, 'medium', 1)).toBe(
      true,
    );
    expect(erased.get('k')!.world).toHaveLength(3);
    // E um trecho que não toca nada não altera nada.
    expect(eraseSegment(section, erased, { x: 150, y: 300 }, { x: 150, y: 320 }, 'medium', 1)).toBe(
      false,
    );
  });

  it('um elemento tocado que não mudou fica sem marca de alterado', () => {
    const { section, erased } = setup();
    // A caixa do elemento é tocada, mas o traço (reto, y = 100) fica a mais de um raio.
    eraseSegment(section, erased, { x: 50, y: 110 }, { x: 50, y: 112 }, 'thin', 1);
    expect(erased.get('k')?.changed ?? false).toBe(false);
    expect(buildErasePreviews(erased)).toEqual([]);
    expect(buildEraseCommands(erased)).toEqual([]);
  });

  it('o preview usa a caixa original e oculta o esvaziado; os comandos removem e atualizam', () => {
    const { section, erased } = setup();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'm',
        type: 'ink',
        strokes: [
          {
            points: [
              { x: 0, y: 160 },
              { x: 200, y: 160 },
            ],
          },
        ],
      },
    });
    eraseSegment(section, erased, { x: 100, y: 80 }, { x: 100, y: 120 }, 'medium', 1);
    eraseSegment(section, erased, { x: -10, y: 160 }, { x: 210, y: 160 }, 'medium', 1);

    const previews = buildErasePreviews(erased);
    expect(previews.map((p) => p.id).sort()).toEqual(['k', 'm']);
    const k = previews.find((p) => p.id === 'k') as unknown as InkNode & { visible: boolean };
    const original = section.getSnapshot().document.nodes['k'] as InkNode;
    expect(k.x).toBe(original.x);
    expect(k.visible).toBe(true);
    const m = previews.find((p) => p.id === 'm') as unknown as { visible: boolean };
    expect(m.visible).toBe(false);

    const commands = buildEraseCommands(erased);
    expect(commands).toContainEqual({ type: 'shape.remove', id: 'm' });
    const update = commands.find((c) => c.id === 'k')!;
    expect(update.type).toBe('shape.update');
    expect(section.transact(commands).ok).toBe(true);
    expect(section.getSnapshot().document.nodes['m']).toBeUndefined();
    expect(inkStrokesToWorld(section.getSnapshot().document.nodes['k'] as InkNode)).toHaveLength(2);
  });
});
