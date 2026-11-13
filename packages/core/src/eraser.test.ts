import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCanvasSection } from './canvas-section.js';
import {
  ERASER_RADII,
  eraseFromInk,
  eraseFromStrokes,
  eraserRadiusWorld,
  inkPatchFromWorldStrokes,
  inkStrokesToLocal,
} from './eraser.js';
import { inkStrokesToWorld, type WorldInkStroke } from './ink.js';
import type { InkNode, ShapePatch } from './shapes.js';

const STYLE = { color: '#1f2937', kind: 'pen', width: 'medium' } as const;

function stroke(
  points: Array<[number, number]>,
  extra: Partial<WorldInkStroke> = {},
): WorldInkStroke {
  return { ...STYLE, points: points.map(([x, y]) => ({ x, y })), ...extra };
}

const pass = (points: Array<[number, number]>, radius = 2, minPieceLength?: number) => ({
  points: points.map(([x, y]) => ({ x, y })),
  radius,
  minPieceLength,
});

describe('tabelas da borracha', () => {
  it('os raios são 4, 8 e 16 pixels CSS e o raio em mundo divide pelo zoom', () => {
    expect(ERASER_RADII).toEqual({ thin: 4, medium: 8, thick: 16 });
    expect(eraserRadiusWorld('medium', 1)).toBe(8);
    expect(eraserRadiusWorld('thick', 4)).toBe(4);
    expect(eraserRadiusWorld('thin', 0.5)).toBe(8);
    expect(eraserRadiusWorld('thin', 0)).toBe(4);
  });
});

describe('eraseFromStrokes', () => {
  const line = stroke([
    [0, 0],
    [100, 0],
  ]);

  it('passar pelo meio divide o traço em dois, com as pontas novas na borda da borracha', () => {
    const result = eraseFromStrokes(
      [line],
      pass(
        [
          [50, -5],
          [50, 5],
        ],
        4,
      ),
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.points).toEqual([
      { x: 0, y: 0 },
      { x: 46, y: 0 },
    ]);
    expect(result[1]!.points[0]!.x).toBeCloseTo(54, 9);
    expect(result[1]!.points[1]).toEqual({ x: 100, y: 0 });
    expect(result[0]).toMatchObject(STYLE);
  });

  it('passar pela ponta encurta o traço', () => {
    const result = eraseFromStrokes(
      [line],
      pass(
        [
          [0, -5],
          [0, 5],
        ],
        4,
      ),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.points[0]!.x).toBeCloseTo(4, 9);
    expect(result[0]!.points[1]).toEqual({ x: 100, y: 0 });
  });

  it('cobrir o traço inteiro o remove', () => {
    expect(
      eraseFromStrokes(
        [line],
        pass(
          [
            [-5, 0],
            [105, 0],
          ],
          4,
        ),
      ),
    ).toEqual([]);
  });

  it('um pingo some se está sob a borracha e fica se não está', () => {
    const dot = stroke([[10, 10]]);
    expect(eraseFromStrokes([dot], pass([[12, 10]], 4))).toEqual([]);
    expect(eraseFromStrokes([dot], pass([[30, 10]], 4))).toEqual([dot]);
  });

  it('uma amostra só apaga um círculo', () => {
    const result = eraseFromStrokes([line], pass([[50, 0]], 10));
    expect(result).toHaveLength(2);
    expect(result[0]!.points[1]!.x).toBeCloseTo(40, 9);
    expect(result[1]!.points[0]!.x).toBeCloseTo(60, 9);
  });

  it('uma passada que não toca nada devolve a própria lista', () => {
    const strokes = [line, stroke([[0, 50]])];
    expect(eraseFromStrokes(strokes, pass([[50, 30]], 4))).toBe(strokes);
  });

  it('só os traços tocados mudam; os outros ficam como estão', () => {
    const other = stroke(
      [
        [0, 50],
        [100, 50],
      ],
      { color: '#ef4444' },
    );
    const result = eraseFromStrokes(
      [line, other],
      pass(
        [
          [50, -5],
          [50, 5],
        ],
        4,
      ),
    );
    expect(result).toHaveLength(3);
    expect(result[2]).toBe(other);
  });

  it('uma polilinha com curva é cortada onde a borracha passa, mantendo os vértices fora dela', () => {
    const zigzag = stroke([
      [0, 0],
      [50, 50],
      [100, 0],
    ]);
    const result = eraseFromStrokes(
      [zigzag],
      pass(
        [
          [50, 40],
          [50, 60],
        ],
        5,
      ),
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.points[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]!.points[1]).toEqual({ x: 100, y: 0 });
  });

  it('uma passada em L apaga a união das cápsulas, sem reaparecer o meio', () => {
    const result = eraseFromStrokes(
      [line],
      pass(
        [
          [20, 0],
          [20, 0],
          [40, 0],
          [60, 5],
        ],
        3,
      ),
    );
    // Fica apagado de x = 17 até onde o último trecho da passada, inclinado, deixa de alcançar a
    // linha (distância 3 de (40, 0)–(60, 5)); sobram a cauda esquerda e a direita.
    expect(result).toHaveLength(2);
    expect(result[0]!.points[1]!.x).toBeCloseTo(17, 9);
    expect(result[1]!.points[0]!.x).toBeCloseTo(52.3693, 3);
    expect(result[1]!.points[1]).toEqual({ x: 100, y: 0 });
  });

  it('descarta o trecho restante menor que o comprimento mínimo', () => {
    // A borracha deixa 1 unidade na ponta esquerda e o resto à direita.
    const result = eraseFromStrokes(
      [line],
      pass(
        [
          [5, -5],
          [5, 5],
        ],
        4,
        2,
      ),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.points[0]!.x).toBeCloseTo(9, 9);
    // Sem o mínimo, o trecho de 1 unidade permanece.
    expect(
      eraseFromStrokes(
        [line],
        pass(
          [
            [5, -5],
            [5, 5],
          ],
          4,
        ),
      ),
    ).toHaveLength(2);
  });

  it('um traço de dois pontos iguais não vira lixo', () => {
    const odd = stroke([
      [10, 10],
      [10, 10],
      [40, 10],
    ]);
    const result = eraseFromStrokes([odd], pass([[10, 10]], 3));
    expect(result).toHaveLength(1);
    expect(result[0]!.points[0]!.x).toBeCloseTo(13, 9);
  });

  it('propriedade: nada restante fica sob a borracha e nada fora dela é perdido', () => {
    const coordinate = fc.double({ min: -60, max: 60, noNaN: true });
    const point = fc.tuple(coordinate, coordinate);
    fc.assert(
      fc.property(
        fc.array(point, { minLength: 2, maxLength: 8 }),
        fc.array(point, { minLength: 1, maxLength: 5 }),
        fc.double({ min: 1, max: 25, noNaN: true }),
        (strokePoints, passPoints, radius) => {
          const input = stroke(strokePoints);
          const eraser = pass(passPoints, radius);
          const result = eraseFromStrokes([input], eraser);

          const distance = (x: number, y: number): number => {
            let best = Infinity;
            for (let i = 0; i < Math.max(1, eraser.points.length - 1); i++) {
              const p = eraser.points[i]!;
              const q = eraser.points[i + 1] ?? p;
              const dx = q.x - p.x;
              const dy = q.y - p.y;
              const lengthSquared = dx * dx + dy * dy;
              const t =
                lengthSquared === 0
                  ? 0
                  : Math.min(1, Math.max(0, ((x - p.x) * dx + (y - p.y) * dy) / lengthSquared));
              best = Math.min(best, Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy)));
            }
            return best;
          };

          for (const piece of result) {
            expect(piece.points.length).toBeGreaterThanOrEqual(2);
            for (const p of piece.points)
              expect(distance(p.x, p.y)).toBeGreaterThanOrEqual(radius - 1e-6);
          }
          const kept = result.flatMap((piece) => piece.points);
          for (const p of input.points) {
            if (distance(p.x, p.y) > radius + 1e-6) {
              expect(
                kept.some((k) => Math.abs(k.x - p.x) < 1e-9 && Math.abs(k.y - p.y) < 1e-9),
              ).toBe(true);
            }
          }
        },
      ),
    );
  });
});

describe('eraseFromInk', () => {
  function inkSection(extra: Record<string, unknown> = {}) {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'k',
        type: 'ink',
        strokes: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
          },
          {
            points: [
              { x: 0, y: 40 },
              { x: 100, y: 40 },
            ],
            color: '#ef4444',
          },
        ],
        ...extra,
      } as never,
    });
    return section;
  }
  const node = (section: ReturnType<typeof createCanvasSection>) =>
    section.getSnapshot().document.nodes['k'] as InkNode;
  const apply = (section: ReturnType<typeof createCanvasSection>, patch: ShapePatch | object) =>
    section.dispatch({ type: 'shape.update', id: 'k', patch: patch as never });

  it('divide o traço, renormaliza a caixa e mantém os pontos do que sobrou no mesmo lugar do mundo', () => {
    const section = inkSection();
    const before = inkStrokesToWorld(node(section));
    const patch = eraseFromInk(
      node(section),
      pass(
        [
          [50, -5],
          [50, 5],
        ],
        4,
      ),
    )!;
    expect(apply(section, patch).ok).toBe(true);

    const after = inkStrokesToWorld(node(section));
    expect(after).toHaveLength(3);
    expect(after[0]!.points[0]).toEqual(before[0]!.points[0]);
    expect(after[2]).toMatchObject({ color: '#ef4444' });
    for (const p of after.flatMap((s) => s.points)) {
      expect(p.x).toBeGreaterThanOrEqual(node(section).x);
      expect(p.x).toBeLessThanOrEqual(node(section).x + node(section).width);
    }
  });

  it('a caixa volta a ser a envolvente dos traços que sobraram', () => {
    const section = inkSection();
    // Apaga o segundo traço inteiro: a caixa encolhe para o primeiro.
    const patch = eraseFromInk(
      node(section),
      pass(
        [
          [-5, 40],
          [105, 40],
        ],
        4,
      ),
    )!;
    expect(apply(section, patch).ok).toBe(true);
    expect(node(section).strokes).toHaveLength(1);
    expect(node(section).height).toBeCloseTo(4, 9);
    expect(node(section).y).toBeCloseTo(-2, 9);
  });

  it('devolve null quando todos os traços somem', () => {
    const section = inkSection();
    expect(
      eraseFromInk(
        node(section),
        pass(
          [
            [-5, 0],
            [105, 0],
            [105, 40],
            [-5, 40],
          ],
          6,
        ),
      ),
    ).toBeNull();
  });

  it('com rotação, mantém a rotação e os pontos no mesmo lugar do mundo', () => {
    const section = inkSection({
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      rotation: 0.5,
      strokes: [
        {
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.9, y: 0.8 },
          ],
        },
      ],
    });
    const before = inkStrokesToWorld(node(section))[0]!.points;
    const middle = { x: (before[0]!.x + before[1]!.x) / 2, y: (before[0]!.y + before[1]!.y) / 2 };
    const patch = eraseFromInk(node(section), pass([[middle.x, middle.y]], 5))!;
    expect(apply(section, patch).ok).toBe(true);

    expect(node(section).rotation).toBe(0.5);
    const after = inkStrokesToWorld(node(section));
    expect(after).toHaveLength(2);
    expect(after[0]!.points[0]!.x).toBeCloseTo(before[0]!.x, 6);
    expect(after[0]!.points[0]!.y).toBeCloseTo(before[0]!.y, 6);
    expect(after[1]!.points[1]!.x).toBeCloseTo(before[1]!.x, 6);
    expect(after[1]!.points[1]!.y).toBeCloseTo(before[1]!.y, 6);
  });

  it('desfazer restaura o elemento exatamente e refazer reaplica', () => {
    const section = inkSection();
    const original = node(section);
    apply(
      section,
      eraseFromInk(
        node(section),
        pass(
          [
            [50, -5],
            [50, 5],
          ],
          4,
        ),
      )!,
    );
    const erased = node(section);
    expect(erased).not.toEqual(original);

    section.undo();
    expect(node(section)).toEqual(original);
    section.redo();
    expect(node(section)).toEqual(erased);
  });

  it('remover o elemento esvaziado e desfazer o devolve inteiro', () => {
    const section = inkSection();
    const original = node(section);
    expect(
      eraseFromInk(
        node(section),
        pass(
          [
            [-5, 0],
            [105, 0],
            [105, 40],
            [-5, 40],
          ],
          6,
        ),
      ),
    ).toBeNull();
    section.dispatch({ type: 'shape.remove', id: 'k' });
    expect(section.getSnapshot().document.nodes['k']).toBeUndefined();
    section.undo();
    expect(node(section)).toEqual(original);
  });

  it('passada que não toca nada mantém os mesmos traços', () => {
    const section = inkSection();
    const patch = eraseFromInk(node(section), pass([[50, 200]], 4))!;
    expect(apply(section, patch).ok).toBe(true);
    expect(inkStrokesToWorld(node(section))).toEqual(
      inkStrokesToWorld(inkSection().getSnapshot().document.nodes['k'] as InkNode),
    );
  });
});

describe('inkStrokesToLocal e inkPatchFromWorldStrokes', () => {
  const box = { x: 100, y: 50, width: 200, height: 100, rotation: 0 };

  it('leva mundo à caixa dada e recorta o arredondamento a [0, 1]', () => {
    const local = inkStrokesToLocal(box, [
      stroke([
        [100, 50],
        [300.0000000001, 150],
        [200, 100],
      ]),
    ]);
    expect(local[0]!.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
    ]);
  });

  it('com rotação, desfaz a rotação antes de normalizar', () => {
    const rotated = { ...box, rotation: Math.PI / 2 };
    // O ponto local (1, 0.5) (meio da borda direita) fica, girado, no meio da borda de baixo.
    const world = inkStrokesToWorld({
      ...rotated,
      strokes: [{ ...STYLE, points: [{ x: 1, y: 0.5 }] }],
    });
    const local = inkStrokesToLocal(rotated, world);
    expect(local[0]!.points[0]!.x).toBeCloseTo(1, 9);
    expect(local[0]!.points[0]!.y).toBeCloseTo(0.5, 9);
  });

  it('sem traços não há patch', () => {
    expect(inkPatchFromWorldStrokes(box, [])).toBeNull();
  });

  it('com traços, a caixa é a envolvente com meia espessura', () => {
    const patch = inkPatchFromWorldStrokes(box, [
      stroke([
        [10, 10],
        [30, 20],
      ]),
    ])!;
    expect(patch).toMatchObject({ x: 8, y: 8, width: 24, height: 14 });
  });
});
