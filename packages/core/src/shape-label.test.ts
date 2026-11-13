import { describe, expect, it } from 'vitest';
import { shapeOutline, pointInOutline } from './geometry/outline.js';
import type { OutlineShapeNode } from './geometry/outline.js';
import {
  shapeLabelArea,
  shapeLabelColor,
  type LabelArea,
  type LabelLayoutShape,
} from './label-area.js';
import { DEFAULT_SHAPE_LABEL } from './shape-label.js';

interface Style {
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly strokeWidth: number;
  readonly opacity: number;
}

const PLAIN: Style = { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 };
const BOX = { x: 0, y: 0, width: 200, height: 100, rotation: 0 } as const;
const SQUARE = { x: 0, y: 0, width: 100, height: 100, rotation: 0 } as const;

const shape = (extra: Record<string, unknown>, style: Style = PLAIN): LabelLayoutShape =>
  ({ ...BOX, style, ...extra }) as unknown as LabelLayoutShape;

function expectArea(area: LabelArea | null, expected: readonly [number, number, number, number]) {
  expect(area).not.toBeNull();
  expect(area!.x).toBeCloseTo(expected[0], 4);
  expect(area!.y).toBeCloseTo(expected[1], 4);
  expect(area!.width).toBeCloseTo(expected[2], 4);
  expect(area!.height).toBeCloseTo(expected[3], 4);
}

describe('shapeLabelArea: área inscrita por forma (US-SL.4)', () => {
  it.each(['rectangle', 'square'])('%s: a caixa, menos a margem de 8', (type) => {
    expectArea(shapeLabelArea(shape({ type })), [8, 8, 184, 84]);
  });

  it.each(['ellipse', 'circle'])('%s: o retângulo de maior área inscrito (w/√2 × h/√2)', (type) => {
    expectArea(shapeLabelArea(shape({ type })), [37.28932, 22.64466, 125.42136, 54.71068]);
  });

  it('diamond: o retângulo centrado de metade da largura e da altura', () => {
    expectArea(shapeLabelArea(shape({ type: 'diamond' })), [58, 33, 84, 34]);
  });

  it.each([
    [0, [8, 58, 84, 34]],
    [0.5, [58, 58, 84, 34]],
    [1, [108, 58, 84, 34]],
  ] as const)('triangle com apex %s: a faixa útil da metade inferior', (apex, expected) => {
    expectArea(shapeLabelArea(shape({ type: 'triangle', apex })), expected);
  });

  it.each([
    [3, [40.32233, 40.32233, 19.35534, 19.35534]],
    [5, [29.39693, 29.39693, 41.20614, 41.20614]],
    [6, [27.38138, 27.38138, 45.23724, 45.23724]],
    [8, [25.33593, 25.33593, 49.32815, 49.32815]],
  ] as const)('polygon com %s lados: o quadrado inscrito no apótema', (sides, expected) => {
    expectArea(
      shapeLabelArea({ ...shape({ type: 'polygon', sides }), ...SQUARE } as never),
      expected,
    );
  });

  it.each([
    [1 / 3, [8, 41.33333, 84, 17.33333]],
    [1, [8, 8, 84, 84]],
  ] as const)('cross com armRatio %s: o braço central de lado a lado', (armRatio, expected) => {
    expectArea(
      shapeLabelArea({ ...shape({ type: 'cross', armRatio }), ...SQUARE } as never),
      expected,
    );
  });

  it('cross com braço fino demais para a margem não tem área', () => {
    expect(
      shapeLabelArea({ ...shape({ type: 'cross', armRatio: 0.05 }), ...SQUARE } as never),
    ).toBeNull();
  });

  it.each([
    ['right', 0, [8, 8, 184, 84]],
    ['right', 0.25, [58, 8, 84, 84]],
    ['left', 0.25, [58, 8, 84, 84]],
    ['up', 0.25, [8, 33, 184, 34]],
    ['down', 0.25, [8, 33, 184, 34]],
  ] as const)('chevron %s com notchDepth %s', (direction, notchDepth, expected) => {
    expectArea(shapeLabelArea(shape({ type: 'chevron', direction, notchDepth })), expected);
  });

  it('chevron com notchDepth 0,5 não tem área', () => {
    expect(
      shapeLabelArea(shape({ type: 'chevron', direction: 'right', notchDepth: 0.5 })),
    ).toBeNull();
  });

  it('o contorno visível tira mais meia espessura de cada lado', () => {
    const styled = { ...PLAIN, stroke: '#000000', strokeWidth: 4 };

    expectArea(shapeLabelArea(shape({ type: 'rectangle' }, styled)), [10, 10, 180, 80]);
    // Contorno com espessura zero, ou sem cor, não conta.
    expectArea(
      shapeLabelArea(shape({ type: 'rectangle' }, { ...styled, strokeWidth: 0 })),
      [8, 8, 184, 84],
    );
    expectArea(
      shapeLabelArea(shape({ type: 'rectangle' }, { ...styled, stroke: null })),
      [8, 8, 184, 84],
    );
  });

  it('uma caixa pequena demais para a margem não tem área', () => {
    expect(shapeLabelArea({ ...shape({ type: 'rectangle' }), width: 16, height: 40 })).toBeNull();
    expect(shapeLabelArea({ ...shape({ type: 'rectangle' }), width: 40, height: 16 })).toBeNull();
    expect(
      shapeLabelArea({ ...shape({ type: 'rectangle' }), width: 17, height: 17 }),
    ).not.toBeNull();
  });

  it('os quatro cantos da área caem dentro do contorno de cada forma', () => {
    const shapes: LabelLayoutShape[] = [
      ...[0, 0.25, 0.5, 1].map((apex) => shape({ type: 'triangle', apex })),
      shape({ type: 'diamond' }),
      ...[3, 5, 6, 8, 12].map(
        (sides) =>
          ({ ...shape({ type: 'polygon', sides }), ...SQUARE }) as unknown as LabelLayoutShape,
      ),
      ...[0.1, 1 / 3, 0.6, 1].map(
        (armRatio) =>
          ({ ...shape({ type: 'cross', armRatio }), ...SQUARE }) as unknown as LabelLayoutShape,
      ),
      ...(['right', 'left', 'up', 'down'] as const).flatMap((direction) =>
        [0, 0.1, 0.25, 0.4].map((notchDepth) => shape({ type: 'chevron', direction, notchDepth })),
      ),
    ];
    let checked = 0;
    for (const item of shapes) {
      const area = shapeLabelArea(item);
      if (area === null) continue;
      const outline = shapeOutline(item as OutlineShapeNode);
      const corners = [
        { x: area.x, y: area.y },
        { x: area.x + area.width, y: area.y },
        { x: area.x + area.width, y: area.y + area.height },
        { x: area.x, y: area.y + area.height },
      ];
      for (const corner of corners) {
        expect(pointInOutline(item as OutlineShapeNode, corner, outline)).toBe(true);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('os cantos da área da elipse e do círculo ficam sobre ou dentro da elipse', () => {
    for (const type of ['ellipse', 'circle']) {
      const item =
        type === 'circle' ? ({ ...shape({ type }), ...SQUARE } as never) : shape({ type });
      const area = shapeLabelArea(item)!;
      const it2 = item as { x: number; y: number; width: number; height: number };
      const cx = it2.x + it2.width / 2;
      const cy = it2.y + it2.height / 2;
      for (const dx of [area.x, area.x + area.width]) {
        for (const dy of [area.y, area.y + area.height]) {
          const value = ((dx - cx) / (it2.width / 2)) ** 2 + ((dy - cy) / (it2.height / 2)) ** 2;
          expect(value).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe('shapeLabelColor: cor do texto (US-SL.4)', () => {
  const label = (color: string | null) => ({ ...DEFAULT_SHAPE_LABEL, text: 'x', color });
  const colored = (fill: string | null, opacity = 1, color: string | null = null) =>
    shape({ type: 'rectangle', label: label(color) }, { ...PLAIN, fill, opacity });

  it('uma cor explícita vale como está', () => {
    expect(shapeLabelColor(colored('#000000', 1, '#ff0000'))).toBe('#ff0000');
  });

  it('com cor automática, escolhe a de maior contraste sobre o preenchimento', () => {
    expect(shapeLabelColor(colored('#000000'))).toBe('#ffffff');
    expect(shapeLabelColor(colored('#ffffff'))).toBe('#1f2937');
    expect(shapeLabelColor(colored('#2563eb'))).toBe('#ffffff');
  });

  it('sem preenchimento, usa a escura', () => {
    expect(shapeLabelColor(colored(null))).toBe('#1f2937');
  });

  it('preenchimento translúcido (alfa abaixo de 0,5) conta como sem preenchimento', () => {
    expect(shapeLabelColor(colored('#000000' + '26'))).toBe('#1f2937');
    expect(shapeLabelColor(colored('#000000' + '80'))).toBe('#ffffff');
  });

  it('a opacidade da forma entra na conta do alfa efetivo', () => {
    expect(shapeLabelColor(colored('#000000', 0.3))).toBe('#1f2937');
    expect(shapeLabelColor(colored('#000000', 0.5))).toBe('#ffffff');
    // 0xcc é alfa 0,8: com opacidade 0,8 o efetivo é 0,64 (escuro vira branco); com 0,5, é 0,4.
    expect(shapeLabelColor(colored('#000000' + 'cc', 0.8))).toBe('#ffffff');
    expect(shapeLabelColor(colored('#000000' + 'cc', 0.5))).toBe('#1f2937');
  });

  it('sem label na forma, também devolve a cor automática', () => {
    expect(shapeLabelColor(shape({ type: 'rectangle' }, { ...PLAIN, fill: '#000000' }))).toBe(
      '#ffffff',
    );
  });
});
