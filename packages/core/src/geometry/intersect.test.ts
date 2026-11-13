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
import { boundsContain, boundsIntersect, shapeBounds, type Bounds } from './bounds.js';
import { shapeInsideRect, shapeIntersectsRect } from './intersect.js';
import { pointInShape } from './shapes.js';
import { rotatePoint } from './transform.js';

type Box = Pick<RectangleNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

const BLACK = '#000000';
/** Caixa padrão das fixtures: 100 × 40 na origem, com centro em (50, 20). */
const BOX: Box = { x: 0, y: 0, width: 100, height: 40, rotation: 0 };
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
    style: { stroke: BLACK, strokeWidth: 10, opacity: 1, ...style },
  };
}

/** Retângulo de seleção com os lados dados, para os casos lerem como coordenadas. */
function marqueeOf(left: number, top: number, right: number, bottom: number): Bounds {
  return { x: left, y: top, width: right - left, height: bottom - top };
}

describe('shapeIntersectsRect', () => {
  describe('retângulo', () => {
    const shape = rectangle();

    it('é verdadeiro quando as áreas se sobrepõem, em parte ou por inteiro', () => {
      expect(shapeIntersectsRect(shape, marqueeOf(90, 30, 140, 80))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(40, 10, 45, 15))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(-10, -10, 190, 190))).toBe(true);
    });

    it.each([
      ['à direita', marqueeOf(100.5, 0, 110, 40)],
      ['à esquerda', marqueeOf(-10, 0, -0.5, 40)],
      ['abaixo', marqueeOf(0, 40.5, 100, 50)],
      ['acima', marqueeOf(0, -10, 100, -0.5)],
    ])('é falso com o retângulo separado %s', (_side, marquee) => {
      expect(shapeIntersectsRect(shape, marquee)).toBe(false);
    });

    it('conta encostar em um lado ou em um canto', () => {
      expect(shapeIntersectsRect(shape, marqueeOf(100, 10, 110, 20))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(20, -10, 30, 0))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(100, 40, 110, 50))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(-10, -10, 0, 0))).toBe(true);
    });

    it('inclui meio stroke visível', () => {
      const stroked = rectangle({}, { stroke: BLACK, strokeWidth: 10 });
      const near = marqueeOf(103, 10, 113, 20);

      expect(shapeIntersectsRect(stroked, near)).toBe(true);
      expect(shapeIntersectsRect(shape, near)).toBe(false);
      expect(shapeIntersectsRect(stroked, marqueeOf(105, 10, 115, 20))).toBe(true);
      expect(shapeIntersectsRect(stroked, marqueeOf(105.5, 10, 115, 20))).toBe(false);
      expect(shapeIntersectsRect(rectangle({}, { stroke: null, strokeWidth: 10 }), near)).toBe(
        false,
      );
      expect(shapeIntersectsRect(rectangle({}, { stroke: BLACK, strokeWidth: 0 }), near)).toBe(
        false,
      );
    });

    it('não devolve o shape girado cuja caixa toca o retângulo sem que a forma toque (CORE-06)', () => {
      // Quadrado de lado 100 girado em 45 graus: um losango com os vértices a 70,7 do centro
      // (50, 50). A caixa dele vai de -20,7 a 120,7 e sobra nos quatro cantos.
      const diamond = rectangle({ width: 100, height: 100, rotation: Math.PI / 4 });
      const inBoxCorners = [
        marqueeOf(100, 100, 115, 115),
        marqueeOf(-15, 100, 0, 115),
        marqueeOf(100, -15, 115, 0),
        marqueeOf(-15, -15, 0, 0),
      ];

      for (const marquee of inBoxCorners) {
        expect(boundsIntersect(shapeBounds(diamond), marquee)).toBe(true);
        expect(shapeIntersectsRect(diamond, marquee)).toBe(false);
      }
      expect(shapeIntersectsRect(diamond, marqueeOf(80, 80, 95, 95))).toBe(true);
      expect(shapeIntersectsRect(diamond, marqueeOf(115, 45, 130, 55))).toBe(true);
      expect(shapeIntersectsRect(diamond, marqueeOf(121, 45, 130, 55))).toBe(false);
    });
  });

  describe('elipse', () => {
    const shape = ellipse();

    it('é verdadeiro quando as áreas se sobrepõem, em parte ou por inteiro', () => {
      expect(shapeIntersectsRect(shape, marqueeOf(90, 15, 140, 25))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(45, 15, 55, 25))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(60, 18, 65, 22))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(-10, -10, 190, 190))).toBe(true);
    });

    it('conta encostar em um vértice da curva', () => {
      expect(shapeIntersectsRect(shape, marqueeOf(100, 15, 110, 25))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(45, 40, 55, 50))).toBe(true);
      expect(shapeIntersectsRect(shape, marqueeOf(100.5, 15, 110, 25))).toBe(false);
      expect(shapeIntersectsRect(shape, marqueeOf(45, 40.5, 55, 50))).toBe(false);
    });

    it('acha o toque por qualquer um dos quatro lados do retângulo', () => {
      const marquee = marqueeOf(200, 200, 250, 250);
      const at = (x: number, y: number): EllipseNode => ellipse({ x, y, width: 40, height: 20 });

      expect(shapeIntersectsRect(at(165, 215), marquee)).toBe(true);
      expect(shapeIntersectsRect(at(245, 215), marquee)).toBe(true);
      expect(shapeIntersectsRect(at(205, 185), marquee)).toBe(true);
      expect(shapeIntersectsRect(at(205, 245), marquee)).toBe(true);
      expect(shapeIntersectsRect(at(159, 215), marquee)).toBe(false);
      expect(shapeIntersectsRect(at(251, 215), marquee)).toBe(false);
      expect(shapeIntersectsRect(at(205, 179), marquee)).toBe(false);
      expect(shapeIntersectsRect(at(205, 251), marquee)).toBe(false);
    });

    it('não devolve a elipse cuja caixa toca o retângulo sem que a curva toque', () => {
      const inBoxCorners = [
        marqueeOf(0, 0, 5, 3),
        marqueeOf(95, 0, 100, 3),
        marqueeOf(0, 37, 5, 40),
        marqueeOf(95, 37, 100, 40),
      ];

      for (const marquee of inBoxCorners) {
        expect(boundsIntersect(shapeBounds(shape), marquee)).toBe(true);
        expect(shapeIntersectsRect(shape, marquee)).toBe(false);
        // O retângulo de mesma caixa ocupa esses cantos.
        expect(shapeIntersectsRect(rectangle(), marquee)).toBe(true);
      }
    });

    it('não devolve a elipse girada cuja caixa toca o retângulo sem que a curva toque (CORE-06)', () => {
      // Semi-eixos 100 e 10, centro na origem, deitada sobre a diagonal y = x.
      const slanted = ellipse({ x: -100, y: -10, width: 200, height: 20, rotation: Math.PI / 4 });
      const offDiagonal = [marqueeOf(40, -70, 65, -45), marqueeOf(-65, 45, -40, 70)];

      for (const marquee of offDiagonal) {
        expect(boundsIntersect(shapeBounds(slanted), marquee)).toBe(true);
        expect(shapeIntersectsRect(slanted, marquee)).toBe(false);
      }
      expect(shapeIntersectsRect(slanted, marqueeOf(40, 40, 65, 65))).toBe(true);
      expect(shapeIntersectsRect(slanted, marqueeOf(-65, -65, -40, -40))).toBe(true);
    });

    it('inclui meio stroke visível', () => {
      const stroked = ellipse({}, { stroke: BLACK, strokeWidth: 10 });
      const near = marqueeOf(103, 15, 113, 25);

      expect(shapeIntersectsRect(stroked, near)).toBe(true);
      expect(shapeIntersectsRect(shape, near)).toBe(false);
      expect(shapeIntersectsRect(stroked, marqueeOf(105.5, 15, 115, 25))).toBe(false);
    });

    it('acha o traço tocado por um só lado do retângulo, qualquer que seja o lado', () => {
      // Elipse 200 × 100 centrada na origem, com traço de 20: a faixa pintada vai até 10 além
      // do contorno. Cada retângulo chega a 5 do contorno por um único lado, longe dos cantos.
      const stroked = ellipse(
        { x: -100, y: -50, width: 200, height: 100 },
        { stroke: BLACK, strokeWidth: 20 },
      );

      expect(shapeIntersectsRect(stroked, marqueeOf(-200, 55, 200, 155))).toBe(true);
      expect(shapeIntersectsRect(stroked, marqueeOf(-200, -155, 200, -55))).toBe(true);
      expect(shapeIntersectsRect(stroked, marqueeOf(105, -200, 205, 200))).toBe(true);
      expect(shapeIntersectsRect(stroked, marqueeOf(-205, -200, -105, 200))).toBe(true);
      expect(shapeIntersectsRect(stroked, marqueeOf(-200, 61, 200, 155))).toBe(false);
      expect(shapeIntersectsRect(stroked, marqueeOf(-200, -155, 200, -61))).toBe(false);
      expect(shapeIntersectsRect(stroked, marqueeOf(111, -200, 205, 200))).toBe(false);
      expect(shapeIntersectsRect(stroked, marqueeOf(-205, -200, -111, 200))).toBe(false);
    });
  });

  describe('linha', () => {
    const diagonal = line({ x: 0, y: 0 }, { x: 100, y: 100 }, { stroke: null });
    const horizontal = line({ x: 0, y: 0 }, { x: 100, y: 0 });

    it('é verdadeiro quando o segmento cruza o retângulo, termina nele ou fica dentro dele', () => {
      expect(shapeIntersectsRect(diagonal, marqueeOf(40, 40, 60, 60))).toBe(true);
      expect(shapeIntersectsRect(diagonal, marqueeOf(90, 90, 140, 140))).toBe(true);
      expect(shapeIntersectsRect(diagonal, marqueeOf(-10, -10, 190, 190))).toBe(true);
    });

    it('não devolve a linha cuja caixa toca o retângulo sem que o segmento toque (CORE-06)', () => {
      for (const marquee of [marqueeOf(70, 10, 85, 25), marqueeOf(10, 70, 25, 85)]) {
        expect(boundsIntersect(shapeBounds(diagonal), marquee)).toBe(true);
        expect(shapeIntersectsRect(diagonal, marquee)).toBe(false);
      }
    });

    it('usa o segmento puro quando o traço não é visível', () => {
      for (const style of [{ stroke: null }, { strokeWidth: 0 }]) {
        const bare = line({ x: 0, y: 0 }, { x: 100, y: 0 }, style);

        expect(shapeIntersectsRect(bare, marqueeOf(40, -5, 50, 5))).toBe(true);
        expect(shapeIntersectsRect(bare, marqueeOf(40, 0, 50, 10))).toBe(true);
        expect(shapeIntersectsRect(bare, marqueeOf(40, 0.5, 50, 10))).toBe(false);
        expect(shapeIntersectsRect(bare, marqueeOf(100.5, -5, 110, 5))).toBe(false);
      }
    });

    it('trata o traço visível como um retângulo de pontas retas', () => {
      // Traço de 10: meio stroke para cada lado do segmento, e nada além das pontas.
      expect(shapeIntersectsRect(horizontal, marqueeOf(40, 5, 50, 15))).toBe(true);
      expect(shapeIntersectsRect(horizontal, marqueeOf(40, 5.5, 50, 15))).toBe(false);
      expect(shapeIntersectsRect(horizontal, marqueeOf(100, -3, 105, 3))).toBe(true);
      expect(shapeIntersectsRect(horizontal, marqueeOf(102, -3, 107, 3))).toBe(false);
      expect(shapeIntersectsRect(horizontal, marqueeOf(-5, -3, 0, 3))).toBe(true);
      expect(shapeIntersectsRect(horizontal, marqueeOf(-7, -3, -2, 3))).toBe(false);
    });

    it('alcança mais longe com traço largo em uma linha inclinada', () => {
      // O canto (60, 47) do retângulo fica a 13 / √2 ≈ 9,2 da reta y = x.
      const marquee = marqueeOf(60, 40, 75, 47);
      const thick = line({ x: 0, y: 0 }, { x: 100, y: 100 }, { strokeWidth: 20 });
      const thin = line({ x: 0, y: 0 }, { x: 100, y: 100 }, { strokeWidth: 2 });

      expect(shapeIntersectsRect(thick, marquee)).toBe(true);
      expect(shapeIntersectsRect(thin, marquee)).toBe(false);
      // Com o canto em (60, 45), a 15 / √2 ≈ 10,6, nem o traço largo chega.
      expect(shapeIntersectsRect(thick, marqueeOf(60, 40, 75, 45))).toBe(false);
    });

    it('vale para a linha tão curta que o quadrado do comprimento não cabe em um número', () => {
      // 1e-200 ao quadrado é zero em ponto flutuante: o comprimento não pode sair de uma soma
      // de quadrados.
      const around = marqueeOf(-10, -10, 10, 10);
      for (const end of [
        { x: 1e-200, y: 0 },
        { x: 0, y: 1e-200 },
        { x: 1e-200, y: 1e-200 },
      ]) {
        const tiny = line({ x: 0, y: 0 }, end, { strokeWidth: 4 });

        expect(shapeIntersectsRect(tiny, around)).toBe(true);
        expect(shapeInsideRect(tiny, around)).toBe(true);
        expect(shapeIntersectsRect(tiny, marqueeOf(5, 5, 10, 10))).toBe(false);
        expect(shapeInsideRect(tiny, marqueeOf(-1, -1, 10, 10))).toBe(false);
      }
    });

    it('não depende do sentido em que a linha foi traçada', () => {
      const down = line({ x: 7, y: 0 }, { x: 7, y: 50 }, { strokeWidth: 4 });
      const up = line({ x: 7, y: 50 }, { x: 7, y: 0 }, { strokeWidth: 4 });

      for (const vertical of [down, up]) {
        expect(shapeIntersectsRect(vertical, marqueeOf(9, 20, 14, 25))).toBe(true);
        expect(shapeIntersectsRect(vertical, marqueeOf(9.5, 20, 14, 25))).toBe(false);
        expect(shapeIntersectsRect(vertical, marqueeOf(0, 50, 14, 55))).toBe(true);
        expect(shapeIntersectsRect(vertical, marqueeOf(0, 50.5, 14, 55))).toBe(false);
      }
    });
  });
});

describe('shapeIntersectsRect em forma sem preenchimento', () => {
  const HOLLOW = { fill: null, stroke: BLACK, strokeWidth: 8 };

  it.each([
    ['retângulo', rectangle({}, HOLLOW)],
    ['elipse', ellipse({}, HOLLOW)],
    ['retângulo girado', rectangle({ rotation: 0.6 }, HOLLOW)],
    ['elipse girada', ellipse({ rotation: -1.1 }, HOLLOW)],
  ])('%s: não é tocado por um retângulo inteiro dentro do miolo', (_label, shape) => {
    expect(shapeIntersectsRect(shape, marqueeOf(45, 15, 55, 25))).toBe(false);
    expect(
      shapeIntersectsRect(
        { ...shape, style: { ...shape.style, fill: '#ffffff' } },
        marqueeOf(45, 15, 55, 25),
      ),
    ).toBe(true);
  });

  it('é tocado quando o retângulo alcança a face interna do contorno', () => {
    const frame = rectangle({}, HOLLOW);

    // O contorno de 8 ocupa de -4 a 4 em x: a face interna está em x = 4.
    expect(shapeIntersectsRect(frame, marqueeOf(4, 15, 20, 25))).toBe(true);
    expect(shapeIntersectsRect(frame, marqueeOf(4.01, 15, 20, 25))).toBe(false);
    expect(shapeIntersectsRect(frame, marqueeOf(-10, 15, 20, 25))).toBe(true);
    expect(shapeIntersectsRect(frame, marqueeOf(-20, -20, 120, 60))).toBe(true);
  });

  it('é tocado quando o retângulo cruza o contorno da elipse', () => {
    const ring = ellipse({}, HOLLOW);

    expect(shapeIntersectsRect(ring, marqueeOf(40, 10, 60, 30))).toBe(false);
    expect(shapeIntersectsRect(ring, marqueeOf(40, -10, 60, 20))).toBe(true);
    expect(shapeIntersectsRect(ring, marqueeOf(-10, -10, 110, 50))).toBe(true);
  });

  it('sem traço visível, o miolo vai até a própria borda geométrica', () => {
    // A largura fica guardada mesmo sem cor: ela não pode encolher o miolo.
    const outline = rectangle({}, { fill: null, stroke: null, strokeWidth: 8 });
    const ring = ellipse({}, { fill: null, stroke: null, strokeWidth: 8 });

    expect(shapeIntersectsRect(outline, marqueeOf(1, 1, 99, 39))).toBe(false);
    expect(shapeIntersectsRect(outline, marqueeOf(0, 1, 99, 39))).toBe(true);
    expect(shapeIntersectsRect(outline, marqueeOf(-5, 10, 5, 30))).toBe(true);
    // (98, 20) está dentro da elipse, a 2 do contorno: sem traço, é miolo.
    expect(shapeIntersectsRect(ring, marqueeOf(60, 20, 98, 20))).toBe(false);
  });

  it('o miolo do retângulo gira com ele', () => {
    const frame = rectangle({ rotation: 0.6 }, HOLLOW);
    // Quadrado de lado 1 em volta do ponto (dx, dy) do referencial do retângulo, com origem no
    // centro dele. O miolo tem semi-eixos 46 e 16.
    const around = (dx: number, dy: number): Bounds => {
      const center = rotatePoint({ x: 50 + dx, y: 20 + dy }, { x: 50, y: 20 }, 0.6);
      return { x: center.x - 0.5, y: center.y - 0.5, width: 1, height: 1 };
    };

    expect(shapeIntersectsRect(frame, around(40, 0))).toBe(false);
    expect(shapeIntersectsRect(frame, around(0, 12))).toBe(false);
    expect(shapeIntersectsRect(frame, around(50, 0))).toBe(true);
    expect(shapeIntersectsRect(frame, around(0, 20))).toBe(true);
    expect(shapeIntersectsRect(frame, around(-50, 0))).toBe(true);
    expect(shapeIntersectsRect(frame, around(0, -20))).toBe(true);
  });

  it('o retângulo é tocado quando o marquee sai do miolo por um lado só, qualquer que seja', () => {
    const frame = rectangle({}, HOLLOW);

    expect(shapeIntersectsRect(frame, marqueeOf(40, 15, 120, 25))).toBe(true);
    expect(shapeIntersectsRect(frame, marqueeOf(-20, 15, 60, 25))).toBe(true);
    expect(shapeIntersectsRect(frame, marqueeOf(40, 15, 60, 80))).toBe(true);
    expect(shapeIntersectsRect(frame, marqueeOf(40, -20, 60, 25))).toBe(true);
  });

  it('o miolo da elipse é uma elipse encolhida em meio traço, não a caixa dela', () => {
    const ring = ellipse({}, HOLLOW);

    // Sobre o contorno a 45°, em um ponto que o miolo de um retângulo de mesma caixa conteria.
    expect(shapeIntersectsRect(ring, marqueeOf(84.86, 33.64, 85.86, 34.64))).toBe(true);
    expect(shapeIntersectsRect(rectangle({}, HOLLOW), marqueeOf(84.86, 33.64, 85.86, 34.64))).toBe(
      false,
    );
    // O contorno de 8 vai de 96 a 104 no eixo maior: encostar na face interna já toca.
    expect(shapeIntersectsRect(ring, marqueeOf(60, 20, 96, 20))).toBe(true);
    expect(shapeIntersectsRect(ring, marqueeOf(60, 20, 95.9, 20))).toBe(false);
  });

  it('com traço tão largo que fecha o miolo, vale como forma cheia', () => {
    const thick = rectangle({}, { fill: null, stroke: BLACK, strokeWidth: 40 });
    const thickRing = ellipse({}, { fill: null, stroke: BLACK, strokeWidth: 100 });

    expect(shapeIntersectsRect(thick, marqueeOf(49, 19, 51, 21))).toBe(true);
    expect(shapeIntersectsRect(thickRing, marqueeOf(49, 19, 51, 21))).toBe(true);
  });
});

describe('shapeInsideRect', () => {
  describe('retângulo', () => {
    const shape = rectangle();

    it('é verdadeiro com a forma inteira dentro, e a borda coincidente conta', () => {
      expect(shapeInsideRect(shape, marqueeOf(-1, -1, 101, 41))).toBe(true);
      expect(shapeInsideRect(shape, marqueeOf(0, 0, 100, 40))).toBe(true);
    });

    it.each([
      ['pela esquerda', marqueeOf(1, -5, 150, 50)],
      ['por cima', marqueeOf(-5, 1, 150, 50)],
      ['pela direita', marqueeOf(-5, -5, 99, 50)],
      ['por baixo', marqueeOf(-5, -5, 150, 39)],
    ])('é falso com a forma saindo %s', (_side, marquee) => {
      expect(shapeInsideRect(shape, marquee)).toBe(false);
      expect(shapeIntersectsRect(shape, marquee)).toBe(true);
    });

    it('é falso com o retângulo dentro da forma', () => {
      expect(shapeInsideRect(shape, marqueeOf(40, 10, 45, 15))).toBe(false);
    });

    it('inclui meio stroke visível', () => {
      const stroked = rectangle({}, { stroke: BLACK, strokeWidth: 10 });

      expect(shapeInsideRect(stroked, marqueeOf(0, 0, 100, 40))).toBe(false);
      expect(shapeInsideRect(stroked, marqueeOf(-5, -5, 105, 45))).toBe(true);
      expect(shapeInsideRect(stroked, marqueeOf(-5, -5, 104.5, 45))).toBe(false);
    });

    it('usa os cantos girados, não a caixa sem rotação', () => {
      // O losango do quadrado de lado 100 vai de -20,7 a 120,7 nos dois eixos.
      const diamond = rectangle({ width: 100, height: 100, rotation: Math.PI / 4 });

      expect(shapeInsideRect(diamond, marqueeOf(0, 0, 100, 100))).toBe(false);
      expect(shapeInsideRect(diamond, marqueeOf(-21, -21, 121, 121))).toBe(true);
      expect(shapeInsideRect(diamond, marqueeOf(-20, -21, 121, 121))).toBe(false);
      expect(shapeInsideRect(diamond, marqueeOf(-21, -21, 121, 120))).toBe(false);
    });
  });

  describe('elipse', () => {
    // Semi-eixos 100 e 10, centro na origem, deitada sobre a diagonal y = x.
    const slantedBox = { x: -100, y: -10, width: 200, height: 20, rotation: Math.PI / 4 };

    it('é verdadeiro com a forma inteira dentro, e a borda coincidente conta', () => {
      expect(shapeInsideRect(ellipse(), marqueeOf(0, 0, 100, 40))).toBe(true);
      expect(shapeInsideRect(ellipse(), marqueeOf(0.5, 0, 100, 40))).toBe(false);
      expect(shapeInsideRect(ellipse(), marqueeOf(0, 0, 100, 39.5))).toBe(false);
    });

    it('usa a caixa justa da curva girada, menor que a do retângulo de mesma geometria', () => {
      // A curva chega a sqrt((100² + 10²) / 2) ≈ 71,06 do centro; os cantos do retângulo, a 77,8.
      expect(shapeInsideRect(ellipse(slantedBox), marqueeOf(-72, -72, 72, 72))).toBe(true);
      expect(shapeInsideRect(ellipse(slantedBox), marqueeOf(-71, -72, 72, 72))).toBe(false);
      expect(shapeInsideRect(rectangle(slantedBox), marqueeOf(-72, -72, 72, 72))).toBe(false);
    });

    it('com traço, conta a curva deslocada em meio stroke', () => {
      // O traço de 10 chega a 71,06 + 5 = 76,06. A elipse de semi-eixos inflados para 105 e 15
      // só chegaria a 75,0 e caberia, por engano, em um retângulo de 75,5.
      const stroked = ellipse(slantedBox, { stroke: BLACK, strokeWidth: 10 });

      expect(shapeInsideRect(stroked, marqueeOf(-76.1, -76.1, 76.1, 76.1))).toBe(true);
      expect(shapeInsideRect(stroked, marqueeOf(-75.5, -75.5, 75.5, 75.5))).toBe(false);
      expect(shapeInsideRect(stroked, marqueeOf(-72, -72, 72, 72))).toBe(false);
    });
  });

  describe('linha', () => {
    it('sem traço visível, vale a caixa dos dois extremos', () => {
      const bare = line({ x: 0, y: 0 }, { x: 100, y: 100 }, { stroke: null });

      expect(shapeInsideRect(bare, marqueeOf(0, 0, 100, 100))).toBe(true);
      expect(shapeInsideRect(bare, marqueeOf(0, 0, 99, 100))).toBe(false);
      expect(shapeInsideRect(bare, marqueeOf(1, 0, 100, 100))).toBe(false);
    });

    it('com traço, vale o retângulo de pontas retas, mais justo que a caixa de shapeBounds', () => {
      const horizontal = line({ x: 0, y: 0 }, { x: 100, y: 0 });
      const tight = marqueeOf(0, -5, 100, 5);

      expect(shapeInsideRect(horizontal, tight)).toBe(true);
      // A caixa de shapeBounds também sobra meio stroke além de cada ponta.
      expect(boundsContain(tight, shapeBounds(horizontal))).toBe(false);
      expect(shapeInsideRect(horizontal, marqueeOf(0, -4.5, 100, 5))).toBe(false);
      expect(shapeInsideRect(horizontal, marqueeOf(0.5, -5, 100, 5))).toBe(false);
    });

    it('em uma linha inclinada, conta os quatro cantos do traço', () => {
      // De (0, 0) a (30, 40) com traço de 10: cantos em (-4, 3), (4, -3), (26, 43) e (34, 37).
      const slanted = line({ x: 0, y: 0 }, { x: 30, y: 40 });
      const loose = marqueeOf(-4.5, -3.5, 34.5, 43.5);

      expect(shapeInsideRect(slanted, loose)).toBe(true);
      expect(boundsContain(loose, shapeBounds(slanted))).toBe(false);
      expect(shapeInsideRect(slanted, marqueeOf(-3.5, -3.5, 34.5, 43.5))).toBe(false);
      expect(shapeInsideRect(slanted, marqueeOf(-4.5, -2.5, 34.5, 43.5))).toBe(false);
      expect(shapeInsideRect(slanted, marqueeOf(-4.5, -3.5, 33.5, 43.5))).toBe(false);
      expect(shapeInsideRect(slanted, marqueeOf(-4.5, -3.5, 34.5, 42.5))).toBe(false);
    });
  });
});

describe('shape contra retângulo em amostras determinísticas', () => {
  /** Gerador congruente linear de semente fixa: a mesma sequência em toda execução. */
  function lcg(seed: number): () => number {
    let state = seed;
    return () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
  }

  type Random = () => number;

  const NOTABLE_ROTATIONS = [0, Math.PI / 2, -Math.PI / 2, -Math.PI, Math.PI / 4, -3];

  function between(random: Random, min: number, max: number): number {
    return min + random() * (max - min);
  }

  function randomMarquee(random: Random): Bounds {
    return {
      x: between(random, -250, 150),
      y: between(random, -250, 150),
      width: between(random, 1, 200),
      height: between(random, 1, 200),
    };
  }

  function randomBox(random: Random, index: number): Box {
    const width = between(random, 20, 300);
    const height = between(random, 20, 300);
    return {
      x: between(random, -150, 150) - width / 2,
      y: between(random, -150, 150) - height / 2,
      width,
      height,
      rotation: NOTABLE_ROTATIONS[index] ?? between(random, -Math.PI, Math.PI),
    };
  }

  /** Um caso em cada quatro sem traço visível. */
  function randomStroke(random: Random): StrokeStyle {
    const strokeWidth = between(random, 0, 30);
    return { stroke: random() < 0.25 ? null : BLACK, strokeWidth, opacity: 1 };
  }

  function insideMarquee(point: Point, marquee: Bounds): boolean {
    return (
      point.x >= marquee.x &&
      point.x <= marquee.x + marquee.width &&
      point.y >= marquee.y &&
      point.y <= marquee.y + marquee.height
    );
  }

  function cornersOf(marquee: Bounds): Point[] {
    const right = marquee.x + marquee.width;
    const bottom = marquee.y + marquee.height;
    return [
      { x: marquee.x, y: marquee.y },
      { x: right, y: marquee.y },
      { x: right, y: bottom },
      { x: marquee.x, y: bottom },
    ];
  }

  /** Arestas de um polígono fechado, cada uma como par de vértices. */
  function edgesOf(polygon: readonly Point[]): (readonly [Point, Point])[] {
    return polygon.map((vertex, index) => [
      vertex,
      polygon[(index + 1) % polygon.length] ?? vertex,
    ]);
  }

  /** Dobro da área com sinal do triângulo: diz de que lado da reta `ab` fica `c`. */
  function turn(a: Point, b: Point, c: Point): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function insideConvex(polygon: readonly Point[], point: Point): boolean {
    const turns = edgesOf(polygon).map(([a, b]) => turn(a, b, point));
    return (
      polygon.length > 2 && (turns.every((side) => side >= 0) || turns.every((side) => side <= 0))
    );
  }

  /**
   * Oráculo sem eixos separadores: um polígono convexo toca o retângulo se tem vértice nele, se
   * contém um canto dele ou se alguma aresta de um cruza alguma do outro.
   */
  function polygonTouches(polygon: readonly Point[], marquee: Bounds): boolean {
    const corners = cornersOf(marquee);
    return (
      polygon.some((vertex) => insideMarquee(vertex, marquee)) ||
      corners.some((corner) => insideConvex(polygon, corner)) ||
      edgesOf(polygon).some(([a, b]) =>
        edgesOf(corners).some(
          ([c, d]) => turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0,
        ),
      )
    );
  }

  /** O que o retângulo pinta: a caixa alargada em meio stroke, girada em torno do centro. */
  function paintedCorners(shape: RectangleNode): Point[] {
    const half = shape.style.stroke === null ? 0 : shape.style.strokeWidth / 2;
    const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    return cornersOf({
      x: shape.x - half,
      y: shape.y - half,
      width: shape.width + 2 * half,
      height: shape.height + 2 * half,
    }).map((corner) => rotatePoint(corner, center, shape.rotation));
  }

  /** O que a linha pinta: os quatro cantos do traço de pontas retas, ou só o segmento. */
  function strokeCorners(shape: LineNode): Point[] {
    const half = shape.style.stroke === null ? 0 : shape.style.strokeWidth / 2;
    if (half === 0) return [shape.start, shape.end];
    const length = Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y);
    const normal = {
      x: (-(shape.end.y - shape.start.y) / length) * half,
      y: ((shape.end.x - shape.start.x) / length) * half,
    };
    return [
      { x: shape.start.x + normal.x, y: shape.start.y + normal.y },
      { x: shape.end.x + normal.x, y: shape.end.y + normal.y },
      { x: shape.end.x - normal.x, y: shape.end.y - normal.y },
      { x: shape.start.x - normal.x, y: shape.start.y - normal.y },
    ];
  }

  /** Relações que valem para qualquer shape: conter implica tocar, e tocar implica caixas que se tocam. */
  function expectConsistent(shape: ShapeNode, marquee: Bounds): void {
    const context = JSON.stringify({ shape, marquee });
    const intersects = shapeIntersectsRect(shape, marquee);
    if (shapeInsideRect(shape, marquee)) expect(intersects, context).toBe(true);
    if (intersects) expect(boundsIntersect(shapeBounds(shape), marquee), context).toBe(true);
  }

  /** Conta os dois resultados, para o teste provar que a amostra exercita os dois. */
  function tally(): { count(result: boolean): void; expectBoth(): void } {
    let hits = 0;
    let misses = 0;
    return {
      count(result) {
        if (result) hits += 1;
        else misses += 1;
      },
      expectBoth() {
        expect(hits).toBeGreaterThan(50);
        expect(misses).toBeGreaterThan(50);
      },
    };
  }

  it('retângulo girado: toca e cabe exatamente quando o polígono pintado toca e cabe', () => {
    const random = lcg(0x5a7);
    const touching = tally();
    const fitting = tally();
    for (let index = 0; index < 2000; index += 1) {
      const shape = rectangle(randomBox(random, index), randomStroke(random));
      // Metade dos retângulos de seleção é grande o bastante para conter o shape.
      const marquee =
        index % 2 === 0
          ? randomMarquee(random)
          : marqueeOf(
              between(random, -450, -150),
              between(random, -450, -150),
              between(random, 150, 450),
              between(random, 150, 450),
            );
      const polygon = paintedCorners(shape);
      const context = JSON.stringify({ shape, marquee });
      const touches = polygonTouches(polygon, marquee);
      const fits = polygon.every((corner) => insideMarquee(corner, marquee));

      expect(shapeIntersectsRect(shape, marquee), context).toBe(touches);
      expect(shapeInsideRect(shape, marquee), context).toBe(fits);
      expectConsistent(shape, marquee);
      touching.count(touches);
      fitting.count(fits);
    }
    touching.expectBoth();
    fitting.expectBoth();
  });

  it('linha: toca e cabe exatamente quando o traço de pontas retas toca e cabe', () => {
    const random = lcg(0x11e);
    const touching = tally();
    const fitting = tally();
    for (let index = 0; index < 2000; index += 1) {
      const start = { x: between(random, -200, 200), y: between(random, -200, 200) };
      // Os primeiros casos são linhas retas nos eixos, nos dois sentidos.
      const offset = [
        { x: 120, y: 0 },
        { x: -120, y: 0 },
        { x: 0, y: 120 },
        { x: 0, y: -120 },
      ][index] ?? { x: between(random, -200, 200), y: between(random, -200, 200) };
      const shape = line(
        start,
        { x: start.x + offset.x, y: start.y + offset.y },
        randomStroke(random),
      );
      const marquee =
        index % 2 === 0
          ? randomMarquee(random)
          : marqueeOf(
              between(random, -450, -100),
              between(random, -450, -100),
              between(random, 100, 450),
              between(random, 100, 450),
            );
      const polygon = strokeCorners(shape);
      const context = JSON.stringify({ shape, marquee });
      const touches = polygonTouches(polygon, marquee);
      const fits = polygon.every((corner) => insideMarquee(corner, marquee));

      expect(shapeIntersectsRect(shape, marquee), context).toBe(touches);
      expect(shapeInsideRect(shape, marquee), context).toBe(fits);
      expectConsistent(shape, marquee);
      touching.count(touches);
      fitting.count(fits);
    }
    touching.expectBoth();
    fitting.expectBoth();
  });

  it('elipse girada: toca exatamente quando algum ponto da borda do retângulo cai nela', () => {
    // A elipse toca o retângulo se o centro dela está nele ou se algum ponto da borda dele está
    // nela. A borda é amostrada a cada 0,5 ou menos; a folga cobre o toque que passa entre duas
    // amostras.
    const stepsPerSide = 400;
    const samplingSlack = 0.25;
    const random = lcg(0xe11);
    const touching = tally();
    for (let index = 0; index < 200; index += 1) {
      const shape = ellipse(randomBox(random, index), { ...NO_STROKE, ...randomStroke(random) });
      const marquee = randomMarquee(random);
      const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
      const border: Point[] = [];
      for (const [a, b] of edgesOf(cornersOf(marquee))) {
        for (let step = 0; step < stepsPerSide; step += 1) {
          const along = step / stepsPerSide;
          border.push({ x: a.x + (b.x - a.x) * along, y: a.y + (b.y - a.y) * along });
        }
      }
      const centerInside = insideMarquee(center, marquee);
      const surely = centerInside || border.some((point) => pointInShape(shape, point, 0));
      const maybe =
        centerInside || border.some((point) => pointInShape(shape, point, samplingSlack));
      const context = JSON.stringify({ shape, marquee });
      const intersects = shapeIntersectsRect(shape, marquee);

      if (surely) expect(intersects, context).toBe(true);
      if (!maybe) expect(intersects, context).toBe(false);
      expectConsistent(shape, marquee);
      touching.count(intersects);
    }
    touching.expectBoth();
    // Centenas de milhares de distâncias a elipse: o prazo padrão é curto em máquina ocupada.
  }, 30_000);
});
