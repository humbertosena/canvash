import { describe, expect, it } from 'vitest';
import type { Point } from '../arrows.js';
import { distanceToPolyline } from './shapes.js';
import { braceBounds, bracePath, braceRadius, flattenBrace, type BraceGeometry } from './brace.js';

const KAPPA = 0.5522847498307936;

function brace(extra: Partial<BraceGeometry> = {}): BraceGeometry {
  return {
    x: 10,
    y: 20,
    width: 100,
    height: 200,
    rotation: 0,
    orientation: 'left',
    tipPosition: 0.5,
    curvature: 1,
    ...extra,
  };
}

function close(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('raio das chaves', () => {
  it('é a curvatura vezes o maior raio que cabe: metade da profundidade ou do menor trecho reto', () => {
    // Profundidade 100 → 50; trechos da espinha: 100 e 100 → 50.
    expect(braceRadius(brace())).toBe(50);
    expect(braceRadius(brace({ curvature: 0.5 }))).toBe(25);
    expect(braceRadius(brace({ curvature: 0 }))).toBe(0);
    // Ponta a 1/4: o menor trecho é 50 → 25.
    expect(braceRadius(brace({ tipPosition: 0.25 }))).toBe(25);
    // Caixa estreita: a profundidade limita (30 / 2 = 15).
    expect(braceRadius(brace({ width: 30 }))).toBe(15);
    // Ponta numa das pontas: não sobra espinha para um arco.
    expect(braceRadius(brace({ tipPosition: 0 }))).toBe(0);
    expect(braceRadius(brace({ tipPosition: 1 }))).toBe(0);
  });

  it('nas orientações deitadas, a profundidade é a altura e o eixo é a largura', () => {
    expect(braceRadius(brace({ orientation: 'up', width: 200, height: 40 }))).toBe(20);
    expect(braceRadius(brace({ orientation: 'down', width: 200, height: 400 }))).toBe(50);
  });
});

describe('contorno da chave com curvatura máxima', () => {
  const path = bracePath(brace());
  const k = KAPPA * 50;

  it('começa na perna de cima, na borda oposta à ponta', () => {
    close(path.start, { x: 110, y: 20 });
    expect(path.radius).toBe(50);
  });

  it('desenha quatro quartos de círculo e as pernas e a espinha ligando-os', () => {
    expect(path.segments.map((s) => s.kind)).toEqual([
      'line',
      'curve',
      'line',
      'curve',
      'curve',
      'line',
      'curve',
      'line',
    ]);

    const [, topArc, , upperTipArc, lowerTipArc, , bottomArc] = path.segments;
    expect(topArc).toMatchObject({ kind: 'curve' });
    if (
      topArc?.kind !== 'curve' ||
      upperTipArc?.kind !== 'curve' ||
      lowerTipArc?.kind !== 'curve' ||
      bottomArc?.kind !== 'curve'
    ) {
      throw new Error('esperava cúbicas');
    }

    // Espinha em x = 10 + 50, ponta em (10, 120), pernas em y = 20 e y = 220.
    close(topArc.to, { x: 60, y: 70 });
    close(topArc.control1, { x: 10 + 100 - k, y: 20 });
    close(topArc.control2, { x: 60, y: 70 - k });
    close(upperTipArc.to, { x: 10, y: 120 });
    close(upperTipArc.control1, { x: 60, y: 120 - 50 + k });
    close(upperTipArc.control2, { x: 10 + k, y: 120 });
    close(lowerTipArc.to, { x: 60, y: 170 });
    close(lowerTipArc.control1, { x: 10 + k, y: 120 });
    close(lowerTipArc.control2, { x: 60, y: 120 + 50 - k });
    close(bottomArc.to, { x: 110, y: 220 });
  });

  it('o ponto médio de cada arco está sobre o círculo, a menos do erro da cúbica', () => {
    const [, topArc] = path.segments;
    if (topArc?.kind !== 'curve') throw new Error('esperava cúbica');
    // Primeiro arco: de (110, 20) a (60, 70), centro (110, 70), raio 50.
    const start = { x: 110, y: 20 };
    const mid = {
      x: (start.x + 3 * topArc.control1.x + 3 * topArc.control2.x + topArc.to.x) / 8,
      y: (start.y + 3 * topArc.control1.y + 3 * topArc.control2.y + topArc.to.y) / 8,
    };
    expect(Math.hypot(mid.x - 110, mid.y - 70)).toBeCloseTo(50, 1);
  });
});

describe('contorno em cada orientação', () => {
  const endpoints = (orientation: BraceGeometry['orientation'], box: Partial<BraceGeometry>) => {
    const path = bracePath(brace({ orientation, ...box }));
    const tip = path.segments[3]!;
    const last = path.segments[7]!;
    return { start: path.start, tip: tip.to, end: last.to };
  };

  it('left e right: a ponta cai em lados opostos e as pernas no lado contrário', () => {
    const left = endpoints('left', {});
    close(left.tip, { x: 10, y: 120 });
    close(left.start, { x: 110, y: 20 });
    close(left.end, { x: 110, y: 220 });

    const right = endpoints('right', {});
    close(right.tip, { x: 110, y: 120 });
    close(right.start, { x: 10, y: 20 });
    close(right.end, { x: 10, y: 220 });
  });

  it('up e down: a espinha corre na largura e a ponta usa tipPosition nela', () => {
    const up = endpoints('up', { width: 200, height: 100, tipPosition: 0.25 });
    close(up.tip, { x: 10 + 50, y: 20 });
    close(up.start, { x: 10, y: 120 });
    close(up.end, { x: 210, y: 120 });

    const down = endpoints('down', { width: 200, height: 100, tipPosition: 0.25 });
    close(down.tip, { x: 10 + 50, y: 120 });
    close(down.start, { x: 10, y: 20 });
    close(down.end, { x: 210, y: 20 });
  });

  it('com a curvatura zero é a polilinha de cantos vivos, sem curvas abertas', () => {
    const path = bracePath(brace({ curvature: 0 }));
    expect(path.radius).toBe(0);
    for (const segment of path.segments) {
      if (segment.kind === 'curve') {
        close(segment.control1, segment.to);
        close(segment.control2, segment.to);
      }
    }
    const points = flattenBrace(brace({ curvature: 0 }), 0.01);
    // Os cantos da polilinha: pernas em x = 110 e espinha em x = 10.
    expect(points[0]).toEqual({ x: 110, y: 20 });
    expect(points.at(-1)).toEqual({ x: 110, y: 220 });
    for (const p of points.slice(1, -1)) expect(p.x).toBe(10);
  });

  it('com a curvatura 0,5 a espinha fica a um raio da ponta e as pernas ocupam o resto', () => {
    const path = bracePath(brace({ curvature: 0.5 }));
    // r = 25: espinha em x = 35 e pernas de x = 110 até x = 60.
    expect(path.radius).toBe(25);
    close(path.segments[0]!.to, { x: 60, y: 20 });
    close(path.segments[1]!.to, { x: 35, y: 45 });
  });
});

describe('braceBounds e flattenBrace', () => {
  it('a caixa é a do nó', () => {
    expect(braceBounds(brace())).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('o contorno achatado fica dentro da caixa e encosta nos quatro lados', () => {
    for (const orientation of ['left', 'right', 'up', 'down'] as const) {
      for (const curvature of [0, 0.3, 1]) {
        const node = brace({ orientation, curvature, tipPosition: 0.4 });
        const points = flattenBrace(node, 0.05);
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(node.x - 1e-9);
        expect(Math.max(...xs)).toBeLessThanOrEqual(node.x + node.width + 1e-9);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(node.y - 1e-9);
        expect(Math.max(...ys)).toBeLessThanOrEqual(node.y + node.height + 1e-9);
        expect(Math.min(...xs)).toBeCloseTo(node.x, 6);
        expect(Math.max(...xs)).toBeCloseTo(node.x + node.width, 6);
        expect(Math.min(...ys)).toBeCloseTo(node.y, 6);
        expect(Math.max(...ys)).toBeCloseTo(node.y + node.height, 6);
      }
    }
  });

  it('mais trechos para tolerância menor, com teto, e o teto para tolerância inválida', () => {
    const node = brace();
    const coarse = flattenBrace(node, 5).length;
    const fine = flattenBrace(node, 0.01).length;
    expect(fine).toBeGreaterThan(coarse);
    expect(flattenBrace(node, 1e-12).length).toBe(flattenBrace(node, 0).length);
    expect(flattenBrace(node, Number.NaN).length).toBe(flattenBrace(node, -1).length);
    expect(flattenBrace(node, 0).length).toBe(1 + 4 * 64 + 4);
  });

  it('a polilinha fica a até a tolerância da curva desenhada, em todas as orientações', () => {
    for (const orientation of ['left', 'right', 'up', 'down'] as const) {
      for (const tolerance of [0.5, 0.05]) {
        const node = brace({ orientation, curvature: 0.8, tipPosition: 0.35 });
        const polyline = flattenBrace(node, tolerance);
        const { start, segments } = bracePath(node);

        let from = start;
        for (const segment of segments) {
          if (segment.kind === 'curve') {
            for (let i = 0; i <= 50; i++) {
              const t = i / 50;
              const mt = 1 - t;
              const point = {
                x:
                  mt ** 3 * from.x +
                  3 * mt ** 2 * t * segment.control1.x +
                  3 * mt * t ** 2 * segment.control2.x +
                  t ** 3 * segment.to.x,
                y:
                  mt ** 3 * from.y +
                  3 * mt ** 2 * t * segment.control1.y +
                  3 * mt * t ** 2 * segment.control2.y +
                  t ** 3 * segment.to.y,
              };
              expect(distanceToPolyline(point, polyline)).toBeLessThanOrEqual(tolerance + 1e-9);
            }
          }
          from = segment.to;
        }
      }
    }
  });
});
