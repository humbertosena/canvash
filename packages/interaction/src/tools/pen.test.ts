import { createCanvasSection, type Point } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { findAnchorTargetAtPoint } from './arrow.js';
import {
  DEFAULT_PEN,
  PEN_PREVIEW_ID,
  appendRawPoint,
  buildPenPreview,
  finalizeStroke,
  isInkNode,
  isPenColor,
  mergePenSettings,
  previewPoints,
} from './pen.js';

describe('configurações da caneta', () => {
  it('o padrão é grafite, caneta, média', () => {
    expect(DEFAULT_PEN).toEqual({ color: '#1f2937', kind: 'pen', width: 'medium' });
  });

  it('isPenColor aceita #rrggbb e #rrggbbaa e recusa o resto', () => {
    expect(isPenColor('#1F2937')).toBe(true);
    expect(isPenColor('#1f293780')).toBe(true);
    for (const value of ['#fff', 'red', '', '#12345g', 7, null, undefined]) {
      expect(isPenColor(value)).toBe(false);
    }
  });

  it('mergePenSettings troca só os campos válidos e põe a cor em minúsculas', () => {
    expect(mergePenSettings(DEFAULT_PEN, { color: '#ABCDEF' }).color).toBe('#abcdef');
    expect(mergePenSettings(DEFAULT_PEN, { kind: 'highlighter' })).toEqual({
      ...DEFAULT_PEN,
      kind: 'highlighter',
    });
    expect(mergePenSettings(DEFAULT_PEN, { width: 'bold', kind: 'x', color: 4 })).toEqual(
      DEFAULT_PEN,
    );
  });
});

describe('pontos brutos', () => {
  it('appendRawPoint não repete o último ponto', () => {
    const points: Point[] = [];
    expect(appendRawPoint(points, { x: 1, y: 1 })).toBe(true);
    expect(appendRawPoint(points, { x: 1, y: 1 })).toBe(false);
    expect(appendRawPoint(points, { x: 1, y: 2 })).toBe(true);
    expect(points).toHaveLength(2);
  });

  it('finalizeStroke sem pontos devolve vazio e um gesto parado é um pingo', () => {
    expect(finalizeStroke([], 1)).toEqual([]);
    expect(
      finalizeStroke(
        [
          { x: 10, y: 10 },
          { x: 10.2, y: 10.1 },
        ],
        1,
      ),
    ).toEqual([{ x: 10, y: 10 }]);
  });

  it('finalizeStroke simplifica com 0,75 CSS px dividido pelo zoom', () => {
    const wiggle = [
      { x: 0, y: 0 },
      { x: 50, y: 0.5 },
      { x: 100, y: 0 },
    ];
    expect(finalizeStroke(wiggle, 1)).toHaveLength(2);
    // Em zoom 4 a tolerância é 0,1875 de mundo: o desvio de 0,5 fica.
    expect(finalizeStroke(wiggle, 4)).toHaveLength(3);
    // Zoom inválido não quebra.
    expect(finalizeStroke(wiggle, 0)).toHaveLength(2);
  });

  it('finalizeStroke nunca passa de 2.000 pontos', () => {
    const raw = Array.from({ length: 6000 }, (_, i) => ({ x: i, y: Math.sin(i / 3) * 20 }));
    expect(finalizeStroke(raw, 1).length).toBeLessThanOrEqual(2000);
  });
});

describe('preview do traço em andamento', () => {
  it('previewPoints devolve os brutos até o teto e amostra acima dele, com o último', () => {
    const raw = Array.from({ length: 1500 }, (_, i) => ({ x: i, y: 0 }));
    expect(previewPoints(raw)).toBe(raw);
    const big = Array.from({ length: 7000 }, (_, i) => ({ x: i, y: 0 }));
    const picked = previewPoints(big);
    expect(picked.length).toBeLessThanOrEqual(2000);
    expect(picked[0]).toBe(big[0]);
    expect(picked[picked.length - 1]).toBe(big[6999]);
  });

  it('buildPenPreview monta o elemento provisório com as configurações', () => {
    const preview = buildPenPreview([{ x: 1, y: 2 }], {
      color: '#ef4444',
      kind: 'marker',
      width: 'thin',
    });
    expect(preview).toEqual({
      id: PEN_PREVIEW_ID,
      type: 'ink',
      strokes: [{ points: [{ x: 1, y: 2 }], color: '#ef4444', kind: 'marker', width: 'thin' }],
    });
  });

  it('isInkNode distingue o elemento de traços', () => {
    expect(isInkNode({ type: 'ink' })).toBe(true);
    expect(isInkNode({ type: 'text' })).toBe(false);
  });
});

describe('a seta não se vincula ao traço à mão livre', () => {
  it('o traço sob o ponteiro não é alvo; o retângulo é', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'k', type: 'ink', strokes: [{ points: [{ x: 50, y: 50 }] }] },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 200, y: 200, width: 100, height: 100, rotation: 0 },
    });
    const hit = (point: Point) =>
      findAnchorTargetAtPoint(point, section.getSnapshot().document, (p, options) =>
        section.hitTest(p, { includePreview: false, ...options }),
      );
    expect(hit({ x: 50, y: 50 })).toBeUndefined();
    expect(hit({ x: 250, y: 250 })?.targetId).toBe('r');
  });
});
