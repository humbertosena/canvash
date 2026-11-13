import { describe, expect, it } from 'vitest';
import type {
  EllipseNode,
  ShapeNode,
  FillStrokeStyle,
  LineNode,
  Point,
  RectangleNode,
  StrokeStyle,
} from '../shapes.js';
import { distanceToEllipse, distanceToSegment, halfStroke, pointInShape } from './shapes.js';
import { rotatePoint } from './transform.js';

type Box = Pick<RectangleNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

const BLACK = '#000000';
/** Caixa padrão das fixtures: 100 × 40 na origem, com centro em (50, 20). */
const BOX: Box = { x: 0, y: 0, width: 100, height: 40, rotation: 0 };
const CENTER: Point = { x: 50, y: 20 };
/** Preenchido e sem traço, para a forma testada ser só a geometria. */
const FILL_ONLY: FillStrokeStyle = { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 };

function rectangle(box: Partial<Box> = {}, style: Partial<FillStrokeStyle> = {}): RectangleNode {
  return {
    id: 'shape',
    type: 'rectangle',
    ...BOX,
    ...box,
    visible: true,
    locked: false,
    style: { ...FILL_ONLY, ...style },
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
    style: { stroke: BLACK, strokeWidth: 10, opacity: 1, ...style },
  };
}

/** Ponto dado no referencial da caixa padrão, levado ao mundo pela rotação do shape. */
function rotated(x: number, y: number, rotation: number): Point {
  return rotatePoint({ x, y }, CENTER, rotation);
}

describe('halfStroke', () => {
  it('é metade da largura quando o traço tem cor e largura', () => {
    expect(halfStroke({ stroke: BLACK, strokeWidth: 6, opacity: 1 })).toBe(3);
  });

  it('é zero sem cor de traço, qualquer que seja a largura', () => {
    expect(halfStroke({ stroke: null, strokeWidth: 6, opacity: 1 })).toBe(0);
  });

  it('é zero com largura zero', () => {
    expect(halfStroke({ stroke: BLACK, strokeWidth: 0, opacity: 1 })).toBe(0);
  });
});

describe('distanceToSegment', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 10, y: 0 };

  it('mede a perpendicular quando a projeção cai dentro do segmento', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, start, end)).toBe(3);
    expect(distanceToSegment({ x: 5, y: -3 }, start, end)).toBe(3);
  });

  it('mede até o início quando a projeção cai antes dele', () => {
    expect(distanceToSegment({ x: -3, y: 4 }, start, end)).toBe(5);
  });

  it('mede até o fim quando a projeção cai depois dele', () => {
    expect(distanceToSegment({ x: 13, y: -4 }, start, end)).toBe(5);
  });

  it('é zero sobre o segmento e nos dois extremos', () => {
    expect(distanceToSegment({ x: 7.5, y: 0 }, start, end)).toBe(0);
    expect(distanceToSegment(start, start, end)).toBe(0);
    expect(distanceToSegment(end, start, end)).toBe(0);
  });

  it('não depende da ordem dos extremos', () => {
    const point = { x: 2, y: 9 };
    const a = { x: -4, y: 1 };
    const b = { x: 6, y: 11 };

    expect(distanceToSegment(point, a, b)).toBeCloseTo(Math.SQRT2, 12);
    expect(distanceToSegment(point, b, a)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('mede até o ponto quando o segmento tem comprimento zero', () => {
    const spot = { x: 2, y: 2 };

    expect(distanceToSegment({ x: 5, y: 6 }, spot, spot)).toBe(5);
    expect(distanceToSegment(spot, spot, spot)).toBe(0);
  });
});

describe('pointInShape', () => {
  describe('retângulo preenchido', () => {
    it('atinge dentro e na borda, e não atinge fora', () => {
      const shape = rectangle();

      expect(pointInShape(shape, CENTER, 0)).toBe(true);
      expect(pointInShape(shape, { x: 0, y: 20 }, 0)).toBe(true);
      expect(pointInShape(shape, { x: 100, y: 40 }, 0)).toBe(true);
      expect(pointInShape(shape, { x: 100.01, y: 20 }, 0)).toBe(false);
      expect(pointInShape(shape, { x: -0.01, y: 20 }, 0)).toBe(false);
      expect(pointInShape(shape, { x: 50, y: -0.01 }, 0)).toBe(false);
      expect(pointInShape(shape, { x: 50, y: 40.01 }, 0)).toBe(false);
    });

    it('respeita a rotação: um ponto só acerta e outro só erra por causa dela', () => {
      // Com um quarto de volta, a caixa de 100 × 40 passa a ocupar x de 30 a 70 e y de -30 a 70.
      const upright = rectangle();
      const turned = rectangle({ rotation: Math.PI / 2 });
      const onlyWhenTurned = { x: 50, y: 65 };
      const onlyWhenUpright = { x: 5, y: 20 };

      expect(pointInShape(turned, onlyWhenTurned, 0)).toBe(true);
      expect(pointInShape(upright, onlyWhenTurned, 0)).toBe(false);
      expect(pointInShape(turned, onlyWhenUpright, 0)).toBe(false);
      expect(pointInShape(upright, onlyWhenUpright, 0)).toBe(true);
    });

    it('acompanha os cantos em um ângulo qualquer', () => {
      const rotation = Math.PI / 6;
      const shape = rectangle({ rotation });

      expect(pointInShape(shape, rotated(99, 39, rotation), 0)).toBe(true);
      expect(pointInShape(shape, rotated(1, 1, rotation), 0)).toBe(true);
      expect(pointInShape(shape, rotated(101, 39, rotation), 0)).toBe(false);
      expect(pointInShape(shape, rotated(99, 41, rotation), 0)).toBe(false);
      // O canto da caixa sem rotação fica fora da forma girada.
      expect(pointInShape(shape, { x: 99, y: 1 }, 0)).toBe(false);
    });

    it('alarga a forma em meio stroke, com canto em esquadria', () => {
      const shape = rectangle({}, { stroke: BLACK, strokeWidth: 20 });

      expect(pointInShape(shape, { x: -9, y: 20 }, 0)).toBe(true);
      expect(pointInShape(shape, { x: -10, y: 20 }, 0)).toBe(true);
      expect(pointInShape(shape, { x: -11, y: 20 }, 0)).toBe(false);
      expect(pointInShape(shape, { x: 50, y: 49 }, 0)).toBe(true);
      expect(pointInShape(shape, { x: 50, y: 51 }, 0)).toBe(false);
      expect(pointInShape(shape, { x: -9, y: -9 }, 0)).toBe(true);
    });

    it('não alarga quando o traço não tem cor ou não tem largura', () => {
      const colorless = rectangle({}, { stroke: null, strokeWidth: 20 });
      const hairless = rectangle({}, { stroke: BLACK, strokeWidth: 0 });

      expect(pointInShape(colorless, { x: -1, y: 20 }, 0)).toBe(false);
      expect(pointInShape(hairless, { x: -1, y: 20 }, 0)).toBe(false);
    });

    it('soma a tolerância ao alcance, com e sem traço', () => {
      const plain = rectangle();
      const stroked = rectangle({}, { stroke: BLACK, strokeWidth: 20 });

      expect(pointInShape(plain, { x: -5, y: 20 }, 4)).toBe(false);
      expect(pointInShape(plain, { x: -5, y: 20 }, 5)).toBe(true);
      expect(pointInShape(plain, { x: 50, y: 46 }, 6)).toBe(true);
      expect(pointInShape(stroked, { x: -14, y: 20 }, 5)).toBe(true);
      expect(pointInShape(stroked, { x: -16, y: 20 }, 5)).toBe(false);
    });
  });

  describe('retângulo sem preenchimento', () => {
    // Traço de 8: a faixa vai 4 para fora e 4 para dentro do contorno.
    const hollow = rectangle({}, { fill: null, stroke: BLACK, strokeWidth: 8 });

    it('não atinge no centro', () => {
      expect(pointInShape(hollow, CENTER, 0)).toBe(false);
    });

    it('atinge sobre o contorno', () => {
      expect(pointInShape(hollow, { x: 0, y: 20 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 100, y: 20 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 50, y: 0 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 50, y: 40 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 100, y: 40 }, 0)).toBe(true);
    });

    it('atinge até meio stroke para dentro e para fora do contorno', () => {
      expect(pointInShape(hollow, { x: 4, y: 20 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 4.1, y: 20 }, 0)).toBe(false);
      expect(pointInShape(hollow, { x: 50, y: 36 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 50, y: 35.9 }, 0)).toBe(false);
      expect(pointInShape(hollow, { x: -4, y: 20 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: -4.1, y: 20 }, 0)).toBe(false);
    });

    it('trata os cantos como a junta em esquadria do traço', () => {
      // Dentro do quadrado do canto externo, a mais de meio stroke do vértice do contorno.
      expect(pointInShape(hollow, { x: -3.5, y: -3.5 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 103.5, y: 43.5 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: -4.5, y: -3.5 }, 0)).toBe(false);
      // Junto ao canto interno: basta estar na faixa de um dos dois lados.
      expect(pointInShape(hollow, { x: 4.1, y: 3.9 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 3.9, y: 4.1 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 4.1, y: 4.1 }, 0)).toBe(false);
    });

    it('alarga a faixa com a tolerância, para os dois lados', () => {
      expect(pointInShape(hollow, { x: 7, y: 20 }, 3)).toBe(true);
      expect(pointInShape(hollow, { x: 7.1, y: 20 }, 3)).toBe(false);
      expect(pointInShape(hollow, { x: -7, y: 20 }, 3)).toBe(true);
      expect(pointInShape(hollow, { x: -7.1, y: 20 }, 3)).toBe(false);
      expect(pointInShape(hollow, CENTER, 3)).toBe(false);
    });

    it('respeita a rotação', () => {
      const rotation = 1;
      const turned = rectangle({ rotation }, { fill: null, stroke: BLACK, strokeWidth: 8 });

      expect(pointInShape(turned, rotated(0, 20, rotation), 0)).toBe(true);
      expect(pointInShape(turned, rotated(3, 20, rotation), 0)).toBe(true);
      expect(pointInShape(turned, rotated(5, 20, rotation), 0)).toBe(false);
      expect(pointInShape(turned, CENTER, 0)).toBe(false);
      // Sobre o contorno da caixa sem rotação, mas fora da forma girada.
      expect(pointInShape(turned, { x: 0, y: 20 }, 0)).toBe(false);
    });

    it('não tem buraco quando a faixa alcança o meio da forma', () => {
      // Altura 10: com alcance 5 as faixas de cima e de baixo se encontram no centro.
      const thin = rectangle({ height: 10 }, { fill: null, stroke: BLACK, strokeWidth: 8 });
      const middle = { x: 50, y: 5 };

      expect(pointInShape(thin, middle, 0)).toBe(false);
      expect(pointInShape(thin, middle, 1)).toBe(true);
      expect(pointInShape(thin, middle, 30)).toBe(true);
    });

    it('nunca atinge sem traço visível, nem com tolerância', () => {
      const noStroke = rectangle({}, { fill: null, stroke: null, strokeWidth: 8 });
      const noWidth = rectangle({}, { fill: null, stroke: BLACK, strokeWidth: 0 });

      for (const shape of [noStroke, noWidth]) {
        expect(pointInShape(shape, CENTER, 0)).toBe(false);
        expect(pointInShape(shape, { x: 0, y: 20 }, 0)).toBe(false);
        expect(pointInShape(shape, { x: 0, y: 20 }, 50)).toBe(false);
        expect(pointInShape(shape, CENTER, 50)).toBe(false);
      }
    });
  });

  describe('elipse preenchida', () => {
    it('atinge no centro e nos quatro vértices', () => {
      const shape = ellipse();

      expect(pointInShape(shape, CENTER, 0)).toBe(true);
      expect(pointInShape(shape, { x: 0, y: 20 }, 0)).toBe(true);
      expect(pointInShape(shape, { x: 100, y: 20 }, 0)).toBe(true);
      expect(pointInShape(shape, { x: 50, y: 0 }, 0)).toBe(true);
      expect(pointInShape(shape, { x: 50, y: 40 }, 0)).toBe(true);
    });

    it('não atinge nos cantos da caixa, fora da curva', () => {
      const shape = ellipse();

      expect(pointInShape(shape, { x: 5, y: 3 }, 0)).toBe(false);
      expect(pointInShape(shape, { x: 95, y: 37 }, 0)).toBe(false);
      expect(pointInShape(shape, { x: -0.01, y: 20 }, 0)).toBe(false);
      expect(pointInShape(shape, { x: 50, y: 40.01 }, 0)).toBe(false);
      // O mesmo ponto atinge o retângulo de mesma caixa.
      expect(pointInShape(rectangle(), { x: 5, y: 3 }, 0)).toBe(true);
    });

    it('respeita a rotação: um ponto só acerta e outro só erra por causa dela', () => {
      const upright = ellipse();
      const turned = ellipse({ rotation: Math.PI / 2 });
      const onlyWhenTurned = { x: 50, y: 65 };
      const onlyWhenUpright = { x: 5, y: 20 };

      expect(pointInShape(turned, onlyWhenTurned, 0)).toBe(true);
      expect(pointInShape(upright, onlyWhenTurned, 0)).toBe(false);
      expect(pointInShape(turned, onlyWhenUpright, 0)).toBe(false);
      expect(pointInShape(upright, onlyWhenUpright, 0)).toBe(true);
    });

    it('alarga os raios em meio stroke e na tolerância', () => {
      const plain = ellipse();
      const stroked = ellipse({}, { stroke: BLACK, strokeWidth: 10 });

      expect(pointInShape(stroked, { x: -4, y: 20 }, 0)).toBe(true);
      expect(pointInShape(stroked, { x: -6, y: 20 }, 0)).toBe(false);
      expect(pointInShape(plain, { x: -5, y: 20 }, 4)).toBe(false);
      expect(pointInShape(plain, { x: -5, y: 20 }, 5)).toBe(true);
      expect(pointInShape(stroked, { x: 50, y: -9 }, 5)).toBe(true);
      expect(pointInShape(stroked, { x: 50, y: -11 }, 5)).toBe(false);
    });
  });

  describe('elipse sem preenchimento', () => {
    // Traço de 8: a faixa fica entre as elipses de raios 54 × 24 e 46 × 16.
    const hollow = ellipse({}, { fill: null, stroke: BLACK, strokeWidth: 8 });

    it('não atinge no centro', () => {
      expect(pointInShape(hollow, CENTER, 0)).toBe(false);
    });

    it('atinge sobre o contorno', () => {
      expect(pointInShape(hollow, { x: 0, y: 20 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 100, y: 20 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 50, y: 0 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 50, y: 40 }, 0)).toBe(true);
    });

    it('atinge até meio stroke para dentro e para fora do contorno', () => {
      expect(pointInShape(hollow, { x: 4, y: 20 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 4.5, y: 20 }, 0)).toBe(false);
      expect(pointInShape(hollow, { x: 50, y: 4 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: 50, y: 4.5 }, 0)).toBe(false);
      expect(pointInShape(hollow, { x: -4, y: 20 }, 0)).toBe(true);
      expect(pointInShape(hollow, { x: -4.5, y: 20 }, 0)).toBe(false);
    });

    it('alarga a faixa com a tolerância, para os dois lados', () => {
      expect(pointInShape(hollow, { x: 7, y: 20 }, 3)).toBe(true);
      expect(pointInShape(hollow, { x: 7.5, y: 20 }, 3)).toBe(false);
      expect(pointInShape(hollow, { x: -7, y: 20 }, 3)).toBe(true);
      expect(pointInShape(hollow, { x: -7.5, y: 20 }, 3)).toBe(false);
    });

    it('respeita a rotação', () => {
      const rotation = -1.1;
      const turned = ellipse({ rotation }, { fill: null, stroke: BLACK, strokeWidth: 8 });

      expect(pointInShape(turned, rotated(0, 20, rotation), 0)).toBe(true);
      expect(pointInShape(turned, rotated(50, 3, rotation), 0)).toBe(true);
      expect(pointInShape(turned, rotated(50, 5, rotation), 0)).toBe(false);
      expect(pointInShape(turned, CENTER, 0)).toBe(false);
      expect(pointInShape(turned, { x: 0, y: 20 }, 0)).toBe(false);
    });

    it('não tem buraco quando encolher zera ou inverte um raio', () => {
      const middle = { x: 50, y: 4 };
      // Altura 8, raio vertical 4.
      const holed = ellipse({ height: 8 }, { fill: null, stroke: BLACK, strokeWidth: 6 });
      const closed = ellipse({ height: 8 }, { fill: null, stroke: BLACK, strokeWidth: 8 });

      expect(pointInShape(holed, middle, 0)).toBe(false);
      expect(pointInShape(closed, middle, 0)).toBe(true);
      expect(pointInShape(closed, middle, 20)).toBe(true);
      // Com o raio interno negativo, um ponto longe do contorno continua fora.
      expect(pointInShape(closed, { x: 50, y: 40 }, 20)).toBe(false);
    });

    it('nunca atinge sem traço visível, nem com tolerância', () => {
      const noStroke = ellipse({}, { fill: null, stroke: null, strokeWidth: 8 });
      const noWidth = ellipse({}, { fill: null, stroke: BLACK, strokeWidth: 0 });

      for (const shape of [noStroke, noWidth]) {
        expect(pointInShape(shape, CENTER, 0)).toBe(false);
        expect(pointInShape(shape, { x: 0, y: 20 }, 0)).toBe(false);
        expect(pointInShape(shape, { x: 0, y: 20 }, 50)).toBe(false);
      }
    });
  });

  describe('linha', () => {
    const horizontal = line({ x: 0, y: 0 }, { x: 100, y: 0 });

    it('atinge sobre o segmento e até meio stroke de distância', () => {
      expect(pointInShape(horizontal, { x: 50, y: 0 }, 0)).toBe(true);
      expect(pointInShape(horizontal, { x: 50, y: 5 }, 0)).toBe(true);
      expect(pointInShape(horizontal, { x: 50, y: -5 }, 0)).toBe(true);
      expect(pointInShape(horizontal, { x: 50, y: 5.1 }, 0)).toBe(false);
    });

    it('acompanha uma linha inclinada', () => {
      // De (0, 0) a (30, 40): direção (0,6, 0,8) e normal (-0,8, 0,6), a partir do meio (15, 20).
      const diagonal = line({ x: 0, y: 0 }, { x: 30, y: 40 });

      expect(pointInShape(diagonal, { x: 15 - 0.8 * 4.9, y: 20 + 0.6 * 4.9 }, 0)).toBe(true);
      expect(pointInShape(diagonal, { x: 15 - 0.8 * 5.1, y: 20 + 0.6 * 5.1 }, 0)).toBe(false);
      // Dentro da caixa dos extremos, longe do traço.
      expect(pointInShape(diagonal, { x: 28, y: 3 }, 0)).toBe(false);
    });

    it('atinge além das pontas só até meio stroke do extremo', () => {
      expect(pointInShape(horizontal, { x: -5, y: 0 }, 0)).toBe(true);
      expect(pointInShape(horizontal, { x: -5.1, y: 0 }, 0)).toBe(false);
      expect(pointInShape(horizontal, { x: 104, y: 3 }, 0)).toBe(true);
      expect(pointInShape(horizontal, { x: 104, y: 4 }, 0)).toBe(false);
    });

    it('soma a tolerância ao meio stroke', () => {
      expect(pointInShape(horizontal, { x: 50, y: 8 }, 3)).toBe(true);
      expect(pointInShape(horizontal, { x: 50, y: 8 }, 2.9)).toBe(false);
    });

    it('nunca atinge sem traço visível, nem com tolerância', () => {
      const noStroke = line({ x: 0, y: 0 }, { x: 100, y: 0 }, { stroke: null });
      const noWidth = line({ x: 0, y: 0 }, { x: 100, y: 0 }, { strokeWidth: 0 });

      for (const shape of [noStroke, noWidth]) {
        expect(pointInShape(shape, { x: 50, y: 0 }, 0)).toBe(false);
        expect(pointInShape(shape, { x: 50, y: 0 }, 100)).toBe(false);
      }
    });

    it('trata uma linha de comprimento zero como um ponto', () => {
      const dot = line({ x: 10, y: 10 }, { x: 10, y: 10 }, { strokeWidth: 4 });

      expect(pointInShape(dot, { x: 11, y: 10 }, 0)).toBe(true);
      expect(pointInShape(dot, { x: 13, y: 10 }, 0)).toBe(false);
      expect(pointInShape(dot, { x: 13, y: 10 }, 1)).toBe(true);
    });
  });

  it('não altera o shape nem o ponto recebidos', () => {
    const shapes = [
      rectangle({ rotation: 1 }),
      ellipse({ rotation: 1 }, { fill: null, stroke: BLACK, strokeWidth: 2 }),
      line({ x: 0, y: 0 }, { x: 3, y: 4 }),
    ];
    const point = Object.freeze({ x: 1, y: 2 });

    for (const shape of shapes) {
      const copy = structuredClone(shape);
      Object.freeze(shape.style);
      pointInShape(Object.freeze(shape), point, 2);

      expect(shape).toEqual(copy);
    }
    expect(point).toEqual({ x: 1, y: 2 });
  });
});

describe('distanceToEllipse', () => {
  /** Distância ao contorno por amostragem densa: oráculo independente da implementação. */
  function sampled(dx: number, dy: number, a: number, b: number): number {
    let best = Infinity;
    const steps = 200_000;
    for (let step = 0; step <= steps; step += 1) {
      const angle = (step / steps) * (Math.PI / 2);
      best = Math.min(best, Math.hypot(dx - a * Math.cos(angle), dy - b * Math.sin(angle)));
    }
    return best;
  }

  it.each([
    ['na ponta do eixo maior', 100, 0, 100, 10, 0],
    ['na ponta do eixo menor', 0, 10, 100, 10, 0],
    ['além da ponta do eixo maior', 130, 0, 100, 10, 30],
    ['acima da ponta do eixo menor', 0, 25, 100, 10, 15],
    ['no centro: o contorno mais próximo é a ponta do eixo menor', 0, 0, 100, 10, 10],
    ['no centro de um círculo', 0, 0, 7, 7, 7],
    ['fora de um círculo, na diagonal', 30, 40, 10, 10, 40],
    ['com o semi-eixo maior na vertical', 0, 130, 10, 100, 30],
  ])('%s', (_label, dx, dy, a, b, expected) => {
    expect(distanceToEllipse(dx, dy, a, b)).toBeCloseTo(expected, 9);
  });

  it('sobre o eixo maior, perto do centro, o ponto mais próximo fica fora do eixo', () => {
    // Em (50, 0) de uma elipse 100 × 10, subir até o contorno (cerca de 8,66) é mais perto
    // do que ir até a ponta (50).
    const distance = distanceToEllipse(50, 0, 100, 10);

    expect(distance).toBeLessThan(8.7);
    expect(distance).toBeCloseTo(sampled(50, 0, 100, 10), 4);
  });

  it.each([1e-300, 1e-17, 1e-15, 1e-14, 1e-13, 1e-9, 1e-7, 2e-7, 5e-7, 1e-6])(
    'a %d do eixo maior, perto do centro, mede o mesmo que sobre o eixo',
    (off) => {
      // Uma rotação deixa no ponto um resíduo de 1e-15 em vez de zero: ele fica quase sobre o
      // eixo, não em cima dele. O ponto mais próximo do contorno continua longe do eixo.
      const onAxis = distanceToEllipse(30, 0, 100, 20);

      expect(onAxis).toBeCloseTo(sampled(30, 0, 100, 20), 4);
      expect(distanceToEllipse(30, off, 100, 20)).toBeCloseTo(onAxis, 5);
      expect(distanceToEllipse(off, 30, 20, 100)).toBeCloseTo(onAxis, 5);
    },
  );

  it('quase sobre o eixo maior, além dos focos, mede até a ponta', () => {
    expect(distanceToEllipse(99, 1e-15, 100, 20)).toBeCloseTo(1, 9);
    expect(distanceToEllipse(130, 1e-15, 100, 20)).toBeCloseTo(30, 9);
  });

  it('quase sobre o eixo maior, na altura do foco, mede até a ponta sem perder o número', () => {
    // No limite em que o ponto mais próximo passa a ser a ponta, o x dele chega ao semi-eixo
    // e pode passar um bit: a raiz que dá o y não pode receber um número negativo.
    const a = 100;
    const b = 20;
    const focal = (a * a - b * b) / a;
    for (let step = -200; step <= 200; step += 1) {
      const dx = focal * (1 + step * 1e-12);

      expect(distanceToEllipse(dx, 1e-300, a, b)).toBeCloseTo(a - dx, 6);
    }
  });

  it('perto da ponta de uma elipse grande, mede com a precisão da distância, não a do contorno', () => {
    // Ponto a um milésimo do contorno, para fora, ao longo da normal, logo acima da ponta do
    // eixo maior de uma elipse de semi-eixos 2 milhões e 1 milhão. Ali o y do ponto mais
    // próximo, tirado da equação da elipse, erraria mais do que a distância medida.
    const a = 2e6;
    const b = 1e6;
    const angle = 1e-6;
    const onCurve = { x: a * Math.cos(angle), y: b * Math.sin(angle) };
    const normal = { x: b * Math.cos(angle), y: a * Math.sin(angle) };
    const length = Math.hypot(normal.x, normal.y);
    const point = {
      x: onCurve.x + (1e-3 * normal.x) / length,
      y: onCurve.y + (1e-3 * normal.y) / length,
    };

    expect(distanceToEllipse(point.x, point.y, a, b)).toBeCloseTo(1e-3, 8);
  });

  it('confere com a amostragem do contorno em elipses e pontos gerados', () => {
    let state = 99;
    const random = (): number => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
    for (let round = 0; round < 60; round += 1) {
      const a = 1 + random() * 200;
      const b = 1 + random() * 200;
      const dx = random() * 300;
      const dy = random() * 300;

      expect(distanceToEllipse(dx, dy, a, b)).toBeCloseTo(sampled(dx, dy, a, b), 3);
    }
    // A amostragem do contorno é pesada: em máquina ocupada passa do prazo padrão.
  }, 30_000);
});

describe('pointInShape em elipse girada, com o ponto sobre o eixo maior', () => {
  /** Elipse 200 × 40 sem preenchimento, com traço de largura 2 e o centro dado. */
  function hollow(rotation: number, cx: number, cy: number): EllipseNode {
    return {
      id: 'e',
      type: 'ellipse',
      x: cx - 100,
      y: cy - 20,
      width: 200,
      height: 40,
      rotation,
      visible: true,
      locked: false,
      style: { fill: null, stroke: BLACK, strokeWidth: 2, opacity: 1 },
    };
  }

  /** Distância ao contorno da elipse girada, por amostragem: não usa nada de pointInShape. */
  function toOutline(shape: EllipseNode, point: Point): number {
    const a = shape.width / 2;
    const b = shape.height / 2;
    const cos = Math.cos(shape.rotation);
    const sin = Math.sin(shape.rotation);
    let best = Infinity;
    for (let step = 0; step < 20_000; step += 1) {
      const angle = (2 * Math.PI * step) / 20_000;
      const x = shape.x + a + a * Math.cos(angle) * cos - b * Math.sin(angle) * sin;
      const y = shape.y + b + a * Math.cos(angle) * sin + b * Math.sin(angle) * cos;
      best = Math.min(best, Math.hypot(x - point.x, y - point.y));
    }
    return best;
  }

  it.each([
    ['um quarto de volta', Math.PI / 2, 3, 4, (k: number): Point => ({ x: 3, y: 4 + k })],
    ['45 graus', Math.PI / 4, 0, 0, (k: number): Point => ({ x: k, y: k })],
    ['meia volta', -Math.PI, 10, 0.5, (k: number): Point => ({ x: 10 + k, y: 0.5 })],
  ])(
    'com %s, concorda com a distância real ao contorno',
    (_label, rotation, cx, cy, at) => {
      // Girar o ponto para o referencial da elipse deixa um resíduo perto de zero na coordenada
      // que deveria ser nula. O alcance aqui é 1 (meio traço) + 9 = 10.
      const shape = hollow(rotation, cx, cy);
      const wrong: string[] = [];
      for (let k = -99; k <= 99; k += 1) {
        const point = at(k);
        const distance = toOutline(shape, point);
        // Ponto a menos de 0,05 da fronteira fica fora: a amostragem não decide.
        if (Math.abs(distance - 10) < 0.05) continue;
        if (pointInShape(shape, point, 9) !== distance < 10) {
          wrong.push(`k=${k}, distância ${distance.toFixed(2)}`);
        }
      }

      expect(wrong).toEqual([]);
      // A amostragem do contorno é pesada: em máquina ocupada passa do prazo padrão.
    },
    30_000,
  );
});

describe('pointInShape em elipse achatada', () => {
  // Elipse 200 × 20 centrada na origem: semi-eixos 100 e 10.
  function flat(fill: string | null, strokeWidth: number): EllipseNode {
    return {
      id: 'e',
      type: 'ellipse',
      x: -100,
      y: -10,
      width: 200,
      height: 20,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill, stroke: '#000000', strokeWidth, opacity: 1 },
    };
  }

  /** Ponto a `distance` do contorno, para fora (ou para dentro, se negativa), no "ombro" da elipse. */
  function shoulder(distance: number): Point {
    const angle = Math.atan(10 / 100);
    const normal = { x: 10 * Math.cos(angle), y: 100 * Math.sin(angle) };
    const length = Math.hypot(normal.x, normal.y);
    return {
      x: 100 * Math.cos(angle) + (distance * normal.x) / length,
      y: 10 * Math.sin(angle) + (distance * normal.y) / length,
    };
  }

  it('atinge o que o traço pinta fora dos eixos, com e sem preenchimento', () => {
    // Meio traço de 10: a 8 do contorno ainda é traço; a 11, não.
    expect(pointInShape(flat(null, 20), shoulder(8), 0)).toBe(true);
    expect(pointInShape(flat('#ffffff', 20), shoulder(8), 0)).toBe(true);
    expect(pointInShape(flat(null, 20), shoulder(11), 0)).toBe(false);
    expect(pointInShape(flat('#ffffff', 20), shoulder(11), 0)).toBe(false);
  });

  it('honra a tolerância inteira fora dos eixos', () => {
    // Alcance de meio traço (0,5) mais tolerância (6): 6,5.
    expect(pointInShape(flat(null, 1), shoulder(5), 6)).toBe(true);
    expect(pointInShape(flat(null, 1), shoulder(6.4), 6)).toBe(true);
    expect(pointInShape(flat(null, 1), shoulder(6.6), 6)).toBe(false);
  });

  it('sem preenchimento, a faixa do contorno vale também por dentro', () => {
    // No alto do eixo menor a curvatura é suave: descer d a partir do contorno é ficar a d dele.
    expect(pointInShape(flat(null, 4), { x: 0, y: 10 - 1.5 }, 0)).toBe(true);
    expect(pointInShape(flat(null, 4), { x: 0, y: 10 - 2.5 }, 0)).toBe(false);
    // Perto da ponta do eixo maior a elipse é estreita: quem entra 2,5 pela normal fica a menos
    // de 2 do contorno do outro lado, e por isso continua na faixa do traço.
    expect(pointInShape(flat(null, 4), shoulder(-2.5), 0)).toBe(true);
    expect(pointInShape(flat(null, 4), { x: 0, y: 0 }, 0)).toBe(false);
    expect(pointInShape(flat('#ffffff', 4), { x: 0, y: 0 }, 0)).toBe(true);
  });
});

describe('pointInShape: texto dentro da forma (US-SL.11)', () => {
  const NONE: FillStrokeStyle = { fill: null, stroke: null, strokeWidth: 0, opacity: 1 };
  const label = (text: string) => ({
    text,
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 'normal' as const,
    color: null,
    textAlign: 'center' as const,
    verticalAlign: 'middle' as const,
  });
  const labelled = (type: 'rectangle' | 'ellipse', text: string, extra = {}): ShapeNode =>
    ({
      id: 'shape',
      type,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      style: NONE,
      label: label(text),
      ...extra,
    }) as ShapeNode;
  const CENTER_POINT = { x: 100, y: 50 };

  it('elipse sem preenchimento: o ponto sobre o texto a atinge; sem texto, não', () => {
    expect(pointInShape(labelled('ellipse', 'Olá'), CENTER_POINT, 0)).toBe(true);
    expect(pointInShape(labelled('ellipse', ''), CENTER_POINT, 0)).toBe(false);
  });

  it('retângulo sem preenchimento e sem contorno: o texto o torna clicável', () => {
    expect(pointInShape(labelled('rectangle', 'Olá'), CENTER_POINT, 0)).toBe(true);
    expect(pointInShape(labelled('rectangle', ''), CENTER_POINT, 0)).toBe(false);
    const noLabel = { ...labelled('rectangle', 'x'), label: undefined } as ShapeNode;
    expect(pointInShape(noLabel, CENTER_POINT, 0)).toBe(false);
  });

  it('só a área inscrita conta: o miolo fora dela segue sem atingir a forma vazada', () => {
    // A área do retângulo 200 × 100 vai de (8, 8) a (192, 92): o canto da caixa fica fora.
    expect(pointInShape(labelled('rectangle', 'Olá'), { x: 4, y: 4 }, 0)).toBe(false);
    expect(pointInShape(labelled('rectangle', 'Olá'), { x: 10, y: 10 }, 0)).toBe(true);
  });

  it('labelAreas: true faz a área contar mesmo sem texto ou sem label', () => {
    const empty = labelled('ellipse', '');
    const absent = { ...labelled('ellipse', 'x'), label: undefined } as ShapeNode;

    expect(pointInShape(empty, CENTER_POINT, 0, { labelAreas: true })).toBe(true);
    expect(pointInShape(absent, CENTER_POINT, 0, { labelAreas: true })).toBe(true);
    expect(pointInShape(empty, CENTER_POINT, 0, { labelAreas: false })).toBe(false);
    expect(pointInShape(empty, CENTER_POINT, 0)).toBe(false);
  });

  it('com a forma girada em 30°, a área gira junto', () => {
    const angle = Math.PI / 6;
    const rotated = labelled('rectangle', 'Olá', { rotation: angle });
    const center = { x: 100, y: 50 };
    // Um ponto dentro da área, no referencial local, e levado à tela pela rotação.
    const inside = rotatePoint({ x: 20, y: 20 }, center, angle);
    const outside = rotatePoint({ x: 2, y: 2 }, center, angle);

    expect(pointInShape(rotated, inside, 0)).toBe(true);
    expect(pointInShape(rotated, outside, 0)).toBe(false);
  });

  it('formas que não aceitam label ignoram a opção', () => {
    const sticky = { ...rectangle(), type: 'brace' } as unknown as ShapeNode;

    expect(pointInShape(sticky, CENTER_POINT, 0, { labelAreas: true })).toBe(false);
  });
});
