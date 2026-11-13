import { describe, expect, it } from 'vitest';
import type {
  EllipseNode,
  FillStrokeStyle,
  LineNode,
  Point,
  RectangleNode,
  ShapeNode,
  StrokeStyle,
} from '../shapes.js';
import {
  boundsContain,
  boundsFromPoints,
  boundsIntersect,
  boundsUnion,
  shapeBounds,
  type Bounds,
} from './bounds.js';
import { rotatePoint } from './transform.js';

type Box = Pick<RectangleNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

const BLACK = '#000000';
/** Caixa padrão das fixtures: 40 × 30 em (10, 20), com centro em (30, 35). */
const BOX: Box = { x: 10, y: 20, width: 40, height: 30, rotation: 0 };
const NO_STROKE: FillStrokeStyle = { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 };

function rectangle(box: Partial<Box> = {}, style: Partial<FillStrokeStyle> = {}): RectangleNode {
  return {
    id: 'shape',
    type: 'rectangle',
    ...BOX,
    ...box,
    visible: true,
    locked: false,
    style: { ...NO_STROKE, ...style },
  };
}

function ellipse(box: Partial<Box> = {}, style: Partial<FillStrokeStyle> = {}): EllipseNode {
  return { ...rectangle(box, style), type: 'ellipse' };
}

function line(start: Point, end: Point, style: Partial<StrokeStyle> = {}): LineNode {
  return {
    id: 'shape',
    type: 'line',
    start,
    end,
    visible: true,
    locked: false,
    style: { stroke: BLACK, strokeWidth: 4, opacity: 1, ...style },
  };
}

function expectBoundsCloseTo(actual: Bounds, expected: Bounds): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.width).toBeCloseTo(expected.width, 9);
  expect(actual.height).toBeCloseTo(expected.height, 9);
}

describe('shapeBounds', () => {
  describe('retângulo', () => {
    it('é a própria caixa sem rotação nem traço', () => {
      expect(shapeBounds(rectangle())).toEqual({ x: 10, y: 20, width: 40, height: 30 });
    });

    it('sem rotação, sai direto dos campos do shape, sem o arredondamento de passar pelo centro', () => {
      // (0,1 + 0,05) - 0,05 não volta a 0,1 em ponto flutuante.
      const box = { x: 0.1, y: 0.1, width: 0.1, height: 33.3 };

      expect(shapeBounds(rectangle(box))).toEqual(box);
      expect(shapeBounds(ellipse(box))).toEqual(box);
      expect(shapeBounds(rectangle(box, { stroke: BLACK, strokeWidth: 0.7 }))).toEqual({
        x: 0.1 - 0.35,
        y: 0.1 - 0.35,
        width: 0.1 + 0.7,
        height: 33.3 + 0.7,
      });
    });

    it('cresce meio stroke para cada lado', () => {
      const shape = rectangle({}, { stroke: BLACK, strokeWidth: 6 });

      expect(shapeBounds(shape)).toEqual({ x: 7, y: 17, width: 46, height: 36 });
    });

    it('não cresce quando o traço não tem cor ou não tem largura', () => {
      const colorless = rectangle({}, { stroke: null, strokeWidth: 6 });
      const hairless = rectangle({}, { stroke: BLACK, strokeWidth: 0 });

      expect(shapeBounds(colorless)).toEqual({ x: 10, y: 20, width: 40, height: 30 });
      expect(shapeBounds(hairless)).toEqual({ x: 10, y: 20, width: 40, height: 30 });
    });

    it('troca largura e altura com um quarto de volta, em torno do centro', () => {
      expectBoundsCloseTo(shapeBounds(rectangle({ rotation: Math.PI / 2 })), {
        x: 15,
        y: 15,
        width: 30,
        height: 40,
      });
      expectBoundsCloseTo(shapeBounds(rectangle({ rotation: -Math.PI / 2 })), {
        x: 15,
        y: 15,
        width: 30,
        height: 40,
      });
    });

    it('volta à própria caixa com meia volta', () => {
      expectBoundsCloseTo(shapeBounds(rectangle({ rotation: -Math.PI })), {
        x: 10,
        y: 20,
        width: 40,
        height: 30,
      });
    });

    it('cobre a diagonal de um quadrado girado em 45 graus', () => {
      const square = rectangle({ x: 0, y: 0, width: 10, height: 10, rotation: Math.PI / 4 });
      const halfDiagonal = 5 * Math.SQRT2;

      expectBoundsCloseTo(shapeBounds(square), {
        x: 5 - halfDiagonal,
        y: 5 - halfDiagonal,
        width: 2 * halfDiagonal,
        height: 2 * halfDiagonal,
      });
    });

    it('gira o canto em esquadria do traço junto com a caixa', () => {
      // Com traço de 10 o quadrado pintado tem lado 20, e é a diagonal dele que conta.
      const square = rectangle(
        { x: 0, y: 0, width: 10, height: 10, rotation: Math.PI / 4 },
        { stroke: BLACK, strokeWidth: 10 },
      );
      const halfDiagonal = 10 * Math.SQRT2;

      expectBoundsCloseTo(shapeBounds(square), {
        x: 5 - halfDiagonal,
        y: 5 - halfDiagonal,
        width: 2 * halfDiagonal,
        height: 2 * halfDiagonal,
      });
    });
  });

  describe('elipse', () => {
    it('é a própria caixa sem rotação, mais meio stroke para cada lado', () => {
      expect(shapeBounds(ellipse())).toEqual({ x: 10, y: 20, width: 40, height: 30 });
      expect(shapeBounds(ellipse({}, { stroke: BLACK, strokeWidth: 6 }))).toEqual({
        x: 7,
        y: 17,
        width: 46,
        height: 36,
      });
    });

    it('troca largura e altura com um quarto de volta', () => {
      expectBoundsCloseTo(shapeBounds(ellipse({ rotation: Math.PI / 2 })), {
        x: 15,
        y: 15,
        width: 30,
        height: 40,
      });
    });

    it('fica justa à curva girada, menor que a caixa do retângulo de mesma geometria', () => {
      // Semi-eixos 20 e 15 a 45 graus: semi-extensão sqrt((20² + 15²) / 2) nos dois eixos.
      const extent = Math.sqrt(312.5);

      expectBoundsCloseTo(shapeBounds(ellipse({ rotation: Math.PI / 4 })), {
        x: 30 - extent,
        y: 35 - extent,
        width: 2 * extent,
        height: 2 * extent,
      });
      expect(shapeBounds(rectangle({ rotation: Math.PI / 4 })).width).toBeGreaterThan(2 * extent);
    });

    it('soma meio stroke à caixa da curva girada, em vez de girar a elipse inflada', () => {
      // Inflar os semi-eixos para 25 e 20 e só depois girar daria sqrt(512,5) ≈ 22,64: menos
      // que os sqrt(312,5) + 5 ≈ 22,68 a que o traço de fato chega.
      const shape = ellipse({ rotation: Math.PI / 4 }, { stroke: BLACK, strokeWidth: 10 });
      const extent = Math.sqrt(312.5) + 5;

      expectBoundsCloseTo(shapeBounds(shape), {
        x: 30 - extent,
        y: 35 - extent,
        width: 2 * extent,
        height: 2 * extent,
      });
    });

    it('não muda com a rotação quando é um círculo', () => {
      const circle = ellipse({ width: 30, rotation: 1.234 }, { stroke: BLACK, strokeWidth: 2 });

      expectBoundsCloseTo(shapeBounds(circle), { x: 9, y: 19, width: 32, height: 32 });
    });
  });

  describe('linha', () => {
    it('é a caixa dos dois extremos, em qualquer ordem, mais meio stroke para cada lado', () => {
      const expected = { x: -2, y: 8, width: 34, height: 44 };

      expect(shapeBounds(line({ x: 0, y: 10 }, { x: 30, y: 50 }))).toEqual(expected);
      expect(shapeBounds(line({ x: 30, y: 50 }, { x: 0, y: 10 }))).toEqual(expected);
      expect(shapeBounds(line({ x: 30, y: 10 }, { x: 0, y: 50 }))).toEqual(expected);
    });

    it('tem lado zero quando a linha é reta nos eixos e não tem traço visível', () => {
      const horizontal = line({ x: 0, y: 5 }, { x: 100, y: 5 }, { stroke: null });
      const vertical = line({ x: 7, y: 0 }, { x: 7, y: 50 }, { strokeWidth: 0 });

      expect(shapeBounds(horizontal)).toEqual({ x: 0, y: 5, width: 100, height: 0 });
      expect(shapeBounds(vertical)).toEqual({ x: 7, y: 0, width: 0, height: 50 });
    });
  });

  describe('opção stroke', () => {
    const style = { stroke: BLACK, strokeWidth: 6 };

    it('devolve só a caixa da geometria com stroke: false', () => {
      expect(shapeBounds(rectangle({}, style), { stroke: false })).toEqual({
        x: 10,
        y: 20,
        width: 40,
        height: 30,
      });
      expect(shapeBounds(ellipse({}, style), { stroke: false })).toEqual({
        x: 10,
        y: 20,
        width: 40,
        height: 30,
      });
      expect(shapeBounds(line({ x: 0, y: 10 }, { x: 30, y: 50 }), { stroke: false })).toEqual({
        x: 0,
        y: 10,
        width: 30,
        height: 40,
      });
    });

    it('com stroke: false, a caixa girada é a do mesmo shape sem traço', () => {
      for (const make of [rectangle, ellipse]) {
        const stroked = make({ rotation: 0.6 }, style);
        const bare = make({ rotation: 0.6 });

        expect(shapeBounds(stroked, { stroke: false })).toEqual(shapeBounds(bare));
        expect(shapeBounds(stroked).width).toBeGreaterThan(shapeBounds(bare).width);
      }
    });

    it('inclui o traço por padrão, com a opção omitida ou explícita', () => {
      const shape = rectangle({}, style);
      const painted = { x: 7, y: 17, width: 46, height: 36 };

      expect(shapeBounds(shape)).toEqual(painted);
      expect(shapeBounds(shape, {})).toEqual(painted);
      expect(shapeBounds(shape, { stroke: true })).toEqual(painted);
    });
  });

  describe('borda externa do traço em qualquer rotação', () => {
    /** Gerador congruente linear de semente fixa: a mesma sequência em toda execução. */
    function lcg(seed: number): () => number {
      let state = seed;
      return () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 2 ** 32;
      };
    }

    const NOTABLE_ROTATIONS = [0, Math.PI / 2, -Math.PI / 2, -Math.PI, Math.PI / 4, -3];
    /** Folga para o arredondamento das contas, em unidades de mundo. */
    const ROUNDING = 1e-9;

    /** Caixas de 50 a 400 de lado, traço de até 40 e rotação qualquer, as notáveis primeiro. */
    function* randomBoxes(seed: number, count: number): Generator<[Box, FillStrokeStyle]> {
      const random = lcg(seed);
      const between = (min: number, max: number): number => min + random() * (max - min);
      for (let index = 0; index < count; index += 1) {
        yield [
          {
            x: between(-1000, 1000),
            y: between(-1000, 1000),
            width: between(50, 400),
            height: between(50, 400),
            rotation: NOTABLE_ROTATIONS[index] ?? between(-Math.PI, Math.PI),
          },
          { ...NO_STROKE, stroke: BLACK, strokeWidth: between(0, 40) },
        ];
      }
    }

    /**
     * Confere que todos os pontos caem dentro da caixa e que ela é justa: em cada um dos quatro
     * lados, algum ponto chega a menos de `slack` dele.
     */
    function expectTightBounds(shape: ShapeNode, points: readonly Point[], slack: number): void {
      const bounds = shapeBounds(shape);
      const gaps = {
        left: Math.min(...points.map((point) => point.x)) - bounds.x,
        top: Math.min(...points.map((point) => point.y)) - bounds.y,
        right: bounds.x + bounds.width - Math.max(...points.map((point) => point.x)),
        bottom: bounds.y + bounds.height - Math.max(...points.map((point) => point.y)),
      };

      for (const [side, gap] of Object.entries(gaps)) {
        const context = `${side} de ${JSON.stringify(shape)}`;
        expect(gap, `ponto fora da caixa: ${context}`).toBeGreaterThanOrEqual(-ROUNDING);
        expect(gap, `caixa com sobra: ${context}`).toBeLessThanOrEqual(slack);
      }
    }

    it('contém os cantos e as arestas externas do traço do retângulo, sem sobra', () => {
      for (const [box, style] of randomBoxes(0xb0c5, 200)) {
        const shape = rectangle(box, style);
        const half = style.strokeWidth / 2;
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const left = box.x - half;
        const top = box.y - half;
        const right = box.x + box.width + half;
        const bottom = box.y + box.height + half;
        const outline: Point[] = [];
        for (let step = 0; step <= 8; step += 1) {
          const x = left + ((right - left) * step) / 8;
          const y = top + ((bottom - top) * step) / 8;
          outline.push({ x, y: top }, { x, y: bottom }, { x: left, y }, { x: right, y });
        }

        expectTightBounds(
          shape,
          outline.map((point) => rotatePoint(point, center, box.rotation)),
          ROUNDING,
        );
      }
    });

    it('contém a curva da elipse deslocada em meio stroke ao longo da normal, sem sobra', () => {
      const steps = 2048;
      for (const [box, style] of randomBoxes(0xe111, 200)) {
        const shape = ellipse(box, style);
        const half = style.strokeWidth / 2;
        const a = box.width / 2;
        const b = box.height / 2;
        const center = { x: box.x + a, y: box.y + b };
        const outline: Point[] = [];
        for (let step = 0; step < steps; step += 1) {
          const angle = (2 * Math.PI * step) / steps;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          // A normal à elipse no ponto (a cos, b sin) tem a direção (cos / a, sin / b).
          const length = Math.hypot(cos / a, sin / b);
          outline.push({
            x: center.x + a * cos + (half * cos) / a / length,
            y: center.y + b * sin + (half * sin) / b / length,
          });
        }

        // A amostra mais próxima de cada extremo fica aquém dele por menos que isto.
        expectTightBounds(
          shape,
          outline.map((point) => rotatePoint(point, center, box.rotation)),
          0.05,
        );
      }
    });
  });

  it('não altera o shape recebido', () => {
    const shapes = [
      rectangle({ rotation: 1 }, { stroke: BLACK, strokeWidth: 3 }),
      ellipse({ rotation: 1 }, { stroke: BLACK, strokeWidth: 3 }),
      line({ x: 0, y: 0 }, { x: 3, y: 4 }),
    ];

    for (const shape of shapes) {
      const copy = structuredClone(shape);
      Object.freeze(shape.style);
      shapeBounds(Object.freeze(shape));
      shapeBounds(shape, Object.freeze({ stroke: false }));

      expect(shape).toEqual(copy);
    }
  });
});

describe('boundsIntersect', () => {
  const base = { x: 0, y: 0, width: 10, height: 10 };

  it('é verdadeiro para caixas sobrepostas, nas duas ordens', () => {
    const other = { x: 5, y: 5, width: 10, height: 10 };

    expect(boundsIntersect(base, other)).toBe(true);
    expect(boundsIntersect(other, base)).toBe(true);
  });

  it('é verdadeiro quando uma caixa contém a outra', () => {
    const inner = { x: 2, y: 3, width: 1, height: 1 };

    expect(boundsIntersect(base, inner)).toBe(true);
    expect(boundsIntersect(inner, base)).toBe(true);
  });

  it.each([
    ['à direita', { x: 10.5, y: 0, width: 5, height: 10 }],
    ['à esquerda', { x: -5.5, y: 0, width: 5, height: 10 }],
    ['abaixo', { x: 0, y: 10.5, width: 10, height: 5 }],
    ['acima', { x: 0, y: -5.5, width: 10, height: 5 }],
  ])('é falso para uma caixa separada %s', (_side, other) => {
    expect(boundsIntersect(base, other)).toBe(false);
    expect(boundsIntersect(other, base)).toBe(false);
  });

  it('conta encostar em um lado ou em um canto', () => {
    expect(boundsIntersect(base, { x: 10, y: 2, width: 5, height: 5 })).toBe(true);
    expect(boundsIntersect(base, { x: 2, y: -5, width: 5, height: 5 })).toBe(true);
    expect(boundsIntersect(base, { x: 10, y: 10, width: 5, height: 5 })).toBe(true);
    expect(boundsIntersect(base, { x: -5, y: -5, width: 5, height: 5 })).toBe(true);
  });

  it('aceita caixas de lado zero', () => {
    const dot = { x: 10, y: 4, width: 0, height: 0 };

    expect(boundsIntersect(base, dot)).toBe(true);
    expect(boundsIntersect(dot, dot)).toBe(true);
    expect(boundsIntersect(base, { x: 10.1, y: 4, width: 0, height: 0 })).toBe(false);
  });
});

describe('boundsContain', () => {
  const outer = { x: 0, y: 0, width: 10, height: 10 };

  it('é verdadeiro para uma caixa inteira dentro da outra', () => {
    expect(boundsContain(outer, { x: 2, y: 3, width: 4, height: 5 })).toBe(true);
  });

  it('conta a borda coincidente', () => {
    expect(boundsContain(outer, outer)).toBe(true);
    expect(boundsContain(outer, { x: 0, y: 0, width: 10, height: 4 })).toBe(true);
    expect(boundsContain(outer, { x: 6, y: 6, width: 4, height: 4 })).toBe(true);
  });

  it.each([
    ['pela esquerda', { x: -0.5, y: 2, width: 4, height: 4 }],
    ['por cima', { x: 2, y: -0.5, width: 4, height: 4 }],
    ['pela direita', { x: 7, y: 2, width: 3.5, height: 4 }],
    ['por baixo', { x: 2, y: 7, width: 4, height: 3.5 }],
  ])('é falso para uma caixa que sai %s', (_side, inner) => {
    expect(boundsContain(outer, inner)).toBe(false);
  });

  it('é falso para a caixa maior dentro da menor', () => {
    expect(boundsContain({ x: 2, y: 3, width: 4, height: 5 }, outer)).toBe(false);
  });
});

describe('boundsUnion', () => {
  it('cobre as duas caixas, em qualquer ordem', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 20, y: -5, width: 5, height: 8 };
    const expected = { x: 0, y: -5, width: 25, height: 15 };

    expect(boundsUnion(a, b)).toEqual(expected);
    expect(boundsUnion(b, a)).toEqual(expected);
  });

  it('é a caixa de fora quando uma contém a outra', () => {
    const outer = { x: -3, y: -4, width: 20, height: 30 };
    const inner = { x: 0, y: 0, width: 1, height: 2 };

    expect(boundsUnion(outer, inner)).toEqual(outer);
    expect(boundsUnion(inner, outer)).toEqual(outer);
    expect(boundsUnion(outer, outer)).toEqual(outer);
  });

  it('não altera as caixas recebidas', () => {
    const a = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
    const b = Object.freeze({ x: 5, y: 5, width: 1, height: 1 });

    expect(boundsUnion(a, b)).toEqual({ x: 0, y: 0, width: 6, height: 6 });
    expect(a).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(b).toEqual({ x: 5, y: 5, width: 1, height: 1 });
  });
});

describe('boundsFromPoints', () => {
  it.each([
    [
      { x: 2, y: 3 },
      { x: 12, y: 8 },
    ],
    [
      { x: 12, y: 8 },
      { x: 2, y: 3 },
    ],
    [
      { x: 12, y: 3 },
      { x: 2, y: 8 },
    ],
    [
      { x: 2, y: 8 },
      { x: 12, y: 3 },
    ],
  ])('aceita os dois cantos em qualquer ordem: %o e %o', (a, b) => {
    expect(boundsFromPoints(a, b)).toEqual({ x: 2, y: 3, width: 10, height: 5 });
  });

  it('devolve uma caixa de lado zero para dois pontos iguais', () => {
    expect(boundsFromPoints({ x: -4, y: 9 }, { x: -4, y: 9 })).toEqual({
      x: -4,
      y: 9,
      width: 0,
      height: 0,
    });
  });
});
