import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PEN_SETTINGS,
  INK_HIGHLIGHTER_ALPHA,
  INK_LIMITS,
  INK_WIDTHS,
  PEN_PALETTE,
  appendInkStroke,
  canAppendInkStroke,
  inkBounds,
  inkInputFromStroke,
  inkPathSegments,
  inkStrokeAlpha,
  inkStrokeWidth,
  inkStrokesToWorld,
  normalizeInkStrokes,
} from './ink.js';
import type { InkNode, ShapePatch } from './shapes.js';

/** O elemento depois do patch de `appendInkStroke`, que só traz caixa e traços. */
function applied(base: InkNode, patch: ShapePatch): InkNode {
  return {
    ...base,
    x: patch.x ?? base.x,
    y: patch.y ?? base.y,
    width: patch.width ?? base.width,
    height: patch.height ?? base.height,
    strokes: patch.strokes ?? base.strokes,
  };
}

const STROKE = { color: '#1f2937', kind: 'pen', width: 'medium' } as const;

function node(extra: Partial<InkNode> = {}): InkNode {
  return {
    id: 'ink',
    type: 'ink',
    x: 100,
    y: 50,
    width: 200,
    height: 100,
    rotation: 0,
    strokes: [{ ...STROKE, points: [{ x: 0.5, y: 0.5 }] }],
    visible: true,
    locked: false,
    style: { opacity: 1 },
    ...extra,
  };
}

describe('tabelas do traço à mão livre', () => {
  it('a espessura segue a tabela por tipo e tamanho', () => {
    expect(INK_WIDTHS.pen).toEqual({ thin: 2, medium: 4, thick: 8 });
    expect(INK_WIDTHS.marker).toEqual({ thin: 4, medium: 8, thick: 16 });
    expect(INK_WIDTHS.highlighter).toEqual({ thin: 6, medium: 12, thick: 24 });
    expect(inkStrokeWidth('marker', 'thick')).toBe(16);
  });

  it('só o marca-texto é semitransparente', () => {
    expect(INK_HIGHLIGHTER_ALPHA).toBe(0.4);
    expect(inkStrokeAlpha('highlighter')).toBe(0.4);
    expect(inkStrokeAlpha('marker')).toBe(1);
    expect(inkStrokeAlpha('pen')).toBe(1);
  });

  it('a paleta tem 8 cores #rrggbb e a primeira é o padrão', () => {
    expect(PEN_PALETTE).toHaveLength(8);
    for (const color of PEN_PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(DEFAULT_PEN_SETTINGS).toEqual({ color: PEN_PALETTE[0], kind: 'pen', width: 'medium' });
  });

  it('os limites são 500 traços, 20.000 pontos e 2.000 por traço', () => {
    expect(INK_LIMITS).toEqual({ maxStrokes: 500, maxPoints: 20_000, maxPointsPerStroke: 2_000 });
  });
});

describe('inkBounds', () => {
  it('é a envolvente dos pontos mais metade da maior espessura', () => {
    const box = inkBounds([
      {
        points: [
          { x: 10, y: 20 },
          { x: 50, y: 80 },
        ],
        kind: 'pen',
        width: 'medium',
      },
      { points: [{ x: 30, y: 30 }], kind: 'marker', width: 'thick' },
    ]);
    // A maior espessura é a do marcador grosso, 16: margem de 8.
    expect(box).toEqual({ x: 2, y: 12, width: 56, height: 76, rotation: 0 });
  });

  it('um ponto só tem caixa válida, do tamanho da espessura', () => {
    const box = inkBounds([{ points: [{ x: 5, y: 5 }], kind: 'pen', width: 'thin' }]);
    expect(box).toEqual({ x: 4, y: 4, width: 2, height: 2, rotation: 0 });
  });

  it('um traço reto horizontal ainda tem altura', () => {
    const box = inkBounds([
      {
        points: [
          { x: 0, y: 10 },
          { x: 100, y: 10 },
        ],
        kind: 'pen',
        width: 'thin',
      },
    ]);
    expect(box.height).toBe(2);
    expect(box.width).toBe(102);
  });
});

describe('normalizeInkStrokes e inkInputFromStroke', () => {
  it('leva os pontos de mundo a frações de 0 a 1 da caixa', () => {
    const { box, strokes } = normalizeInkStrokes([
      {
        ...STROKE,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 60 },
        ],
      },
    ]);
    expect(box).toEqual({ x: 8, y: 8, width: 104, height: 54, rotation: 0 });
    expect(strokes[0]!.points[0]).toEqual({ x: 2 / 104, y: 2 / 54 });
    expect(strokes[0]!.points[1]).toEqual({ x: 102 / 104, y: 52 / 54 });
    for (const p of strokes[0]!.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
    }
  });

  it('a entrada do primeiro traço guarda os pontos de mundo', () => {
    const input = inkInputFromStroke({ ...STROKE, worldPoints: [{ x: 1, y: 2 }] });
    expect(input).toEqual({ type: 'ink', strokes: [{ ...STROKE, points: [{ x: 1, y: 2 }] }] });
  });
});

describe('inkStrokesToWorld', () => {
  it('sem rotação soma a origem da caixa', () => {
    const world = inkStrokesToWorld(node());
    expect(world[0]!.points).toEqual([{ x: 200, y: 100 }]);
  });

  it('com rotação gira em torno do centro da caixa', () => {
    const world = inkStrokesToWorld(
      node({
        rotation: Math.PI / 2,
        strokes: [{ ...STROKE, points: [{ x: 1, y: 0.5 }] }],
      }),
    );
    // Meio da borda direita (300, 100) girado 90° em torno de (200, 100): (200, 200).
    expect(world[0]!.points[0]!.x).toBeCloseTo(200, 9);
    expect(world[0]!.points[0]!.y).toBeCloseTo(200, 9);
  });
});

describe('appendInkStroke', () => {
  it('dentro da caixa, só o traço novo entra e os pontos antigos não mudam', () => {
    const base = node();
    const patch = appendInkStroke(base, { ...STROKE, worldPoints: [{ x: 150, y: 75 }] });
    expect(patch.x).toBeUndefined();
    expect(patch.strokes).toHaveLength(2);
    expect(patch.strokes![0]).toBe(base.strokes[0]);
    expect(patch.strokes![1]!.points[0]).toEqual({ x: 0.25, y: 0.25 });
  });

  it('fora da caixa, a caixa cresce e todos os pontos são renormalizados', () => {
    const base = node();
    const patch = appendInkStroke(base, { ...STROKE, worldPoints: [{ x: 400, y: 200 }] });
    expect(patch.x).toBe(100);
    expect(patch.y).toBe(50);
    expect(patch.width).toBe(302);
    expect(patch.height).toBe(152);
    // O ponto antigo continua no mesmo lugar do mundo (200, 100).
    const old = patch.strokes![0]!.points[0]!;
    expect(100 + old.x * patch.width!).toBeCloseTo(200, 9);
    expect(50 + old.y * patch.height!).toBeCloseTo(100, 9);
    const added = patch.strokes![1]!.points[0]!;
    expect(100 + added.x * patch.width!).toBeCloseTo(400, 9);
    expect(50 + added.y * patch.height!).toBeCloseTo(200, 9);
  });

  it('cresce para a esquerda e para cima movendo a origem', () => {
    const patch = appendInkStroke(node(), { ...STROKE, worldPoints: [{ x: 20, y: 10 }] });
    expect(patch.x).toBe(18);
    expect(patch.y).toBe(8);
    expect(patch.width).toBe(282);
    expect(patch.height).toBe(142);
  });

  it('com rotação, os pontos de mundo continuam onde estavam depois da renormalização', () => {
    const base = node({
      rotation: 0.6,
      strokes: [
        {
          ...STROKE,
          points: [
            { x: 0.2, y: 0.3 },
            { x: 0.8, y: 0.7 },
          ],
        },
      ],
    });
    const before = inkStrokesToWorld(base)[0]!.points;
    const target = { x: 520, y: -40 };
    const patch = appendInkStroke(base, { ...STROKE, worldPoints: [target] });
    const next = applied(base, patch);
    const after = inkStrokesToWorld(next);
    expect(after).toHaveLength(2);
    for (const [i, p] of before.entries()) {
      expect(after[0]!.points[i]!.x).toBeCloseTo(p.x, 6);
      expect(after[0]!.points[i]!.y).toBeCloseTo(p.y, 6);
    }
    expect(after[1]!.points[0]!.x).toBeCloseTo(target.x, 6);
    expect(after[1]!.points[0]!.y).toBeCloseTo(target.y, 6);
    expect(next.rotation).toBe(0.6);
    for (const stroke of next.strokes) {
      for (const p of stroke.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('propriedade: renormalizar preserva todos os pontos de mundo (erro ≤ 1e-9)', () => {
    const coordinate = fc.double({ min: -500, max: 500, noNaN: true });
    fc.assert(
      fc.property(
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.array(fc.record({ x: coordinate, y: coordinate }), { minLength: 1, maxLength: 6 }),
        (rotation, extra) => {
          const base = node({ rotation });
          const before = inkStrokesToWorld(base)[0]!.points;
          const patch = appendInkStroke(base, { ...STROKE, worldPoints: extra });
          const next = applied(base, patch);
          const after = inkStrokesToWorld(next);
          for (const [i, p] of before.entries()) {
            expect(Math.abs(after[0]!.points[i]!.x - p.x)).toBeLessThan(1e-6);
            expect(Math.abs(after[0]!.points[i]!.y - p.y)).toBeLessThan(1e-6);
          }
          for (const [i, p] of extra.entries()) {
            expect(Math.abs(after[1]!.points[i]!.x - p.x)).toBeLessThan(1e-6);
            expect(Math.abs(after[1]!.points[i]!.y - p.y)).toBeLessThan(1e-6);
          }
        },
      ),
    );
  });
});

describe('canAppendInkStroke', () => {
  const many = (strokes: number, points: number): Pick<InkNode, 'strokes'> => ({
    strokes: Array.from({ length: strokes }, () => ({
      ...STROKE,
      points: Array.from({ length: points }, () => ({ x: 0, y: 0 })),
    })),
  });

  it('cabe dentro dos três limites', () => {
    expect(canAppendInkStroke(many(1, 10), 10)).toBe(true);
    expect(canAppendInkStroke(many(1, 10), 2_000)).toBe(true);
  });

  it('recusa traço vazio, longo demais, 501º traço e total acima de 20.000', () => {
    expect(canAppendInkStroke(many(1, 10), 0)).toBe(false);
    expect(canAppendInkStroke(many(1, 10), 2_001)).toBe(false);
    expect(canAppendInkStroke(many(500, 1), 1)).toBe(false);
    expect(canAppendInkStroke(many(10, 2_000), 2)).toBe(false);
    expect(canAppendInkStroke(many(10, 2_000), 1)).toBe(false);
    expect(canAppendInkStroke(many(9, 2_000), 2_000)).toBe(true);
  });
});

describe('inkPathSegments', () => {
  it('um ponto só não tem caminho e dois pontos são uma linha', () => {
    expect(inkPathSegments([])).toEqual([]);
    expect(inkPathSegments([{ x: 1, y: 1 }])).toEqual([]);
    expect(
      inkPathSegments([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toEqual([
      { kind: 'M', x: 0, y: 0 },
      { kind: 'L', x: 10, y: 5 },
    ]);
  });

  it('com três ou mais pontos usa os pontos como controle e os pontos médios como destino', () => {
    expect(
      inkPathSegments([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
        { x: 30, y: 10 },
      ]),
    ).toEqual([
      { kind: 'M', x: 0, y: 0 },
      { kind: 'Q', cx: 10, cy: 10, x: 15, y: 5 },
      { kind: 'Q', cx: 20, cy: 0, x: 25, y: 5 },
      { kind: 'L', x: 30, y: 10 },
    ]);
  });
});
