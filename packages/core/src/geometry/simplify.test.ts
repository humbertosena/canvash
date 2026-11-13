import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Point } from '../arrows.js';
import { distanceToSegment } from './shapes.js';
import { simplifyPolyline } from './simplify.js';

/** Maior distância de um ponto a qualquer segmento da polilinha dada. */
function distanceToPolyline(point: Point, line: readonly Point[]): number {
  let best = Infinity;
  for (let index = 1; index < line.length; index++) {
    best = Math.min(best, distanceToSegment(point, line[index - 1]!, line[index]!));
  }
  return best;
}

describe('simplifyPolyline', () => {
  it('devolve cópia de 0, 1 e 2 pontos', () => {
    expect(simplifyPolyline([], 1, 10)).toEqual([]);
    const one = [{ x: 3, y: 4 }];
    expect(simplifyPolyline(one, 1, 10)).toEqual(one);
    expect(simplifyPolyline(one, 1, 10)).not.toBe(one);
    const two = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    expect(simplifyPolyline(two, 1, 1)).toEqual(two);
  });

  it('reduz uma reta com ruído às duas pontas', () => {
    const noisy = Array.from({ length: 101 }, (_, index) => ({
      x: index,
      y: index % 2 === 0 ? 0.2 : -0.2,
    }));
    noisy[0] = { x: 0, y: 0 };
    noisy[100] = { x: 100, y: 0 };
    expect(simplifyPolyline(noisy, 0.75, 2000)).toEqual([noisy[0], noisy[100]]);
  });

  it('mantém os vértices de um zigue-zague mais alto que a tolerância', () => {
    const zigzag = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
      { x: 40, y: 0 },
    ];
    expect(simplifyPolyline(zigzag, 0.75, 2000)).toEqual(zigzag);
    expect(simplifyPolyline(zigzag, 20, 2000)).toEqual([zigzag[0], zigzag[4]]);
  });

  it('com tolerância zero só tira os pontos exatamente alinhados', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 5 },
    ];
    expect(simplifyPolyline(line, 0, 100)).toEqual([line[0], line[2], line[3]]);
    expect(simplifyPolyline(line, -5, 100)).toEqual([line[0], line[2], line[3]]);
    expect(simplifyPolyline(line, Number.NaN, 100)).toEqual([line[0], line[2], line[3]]);
  });

  it('com tolerância zero e teto menor, cresce a partir da extensão do traço', () => {
    const wave = Array.from({ length: 200 }, (_, index) => ({
      x: index,
      y: Math.sin(index / 5) * 20,
    }));
    const result = simplifyPolyline(wave, 0, 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result[0]).toBe(wave[0]);
    expect(result[result.length - 1]).toBe(wave[199]);
  });

  it('o teto abaixo de 2 vale 2 e um laço fechado também cabe', () => {
    const loop = Array.from({ length: 50 }, (_, index) => ({
      x: Math.cos((index / 49) * 2 * Math.PI) * 30,
      y: Math.sin((index / 49) * 2 * Math.PI) * 30,
    }));
    expect(simplifyPolyline(loop, 0.1, 0)).toHaveLength(2);
    expect(simplifyPolyline(loop, 0.1, 1.9)).toHaveLength(2);
    expect(simplifyPolyline(loop, 0.1, 8).length).toBeLessThanOrEqual(8);
  });

  it('5.000 amostras de uma curva ficam em até 2.000 pontos e perto do original', () => {
    const raw = Array.from({ length: 5000 }, (_, index) => ({
      x: index * 0.2,
      y: Math.sin(index / 40) * 50 + (index % 7) * 0.01,
    }));
    const result = simplifyPolyline(raw, 0.75, 2000);
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result[0]).toBe(raw[0]);
    expect(result[result.length - 1]).toBe(raw[4999]);
    for (const point of raw) expect(distanceToPolyline(point, result)).toBeLessThanOrEqual(0.75);
  });

  it('não usa recursão: um traço suave de 200.000 pontos não estoura a pilha', () => {
    const raw = Array.from({ length: 200_000 }, (_, index) => ({
      x: index * 0.05,
      y: Math.sin(index / 3000) * 200,
    }));
    expect(simplifyPolyline(raw, 0.1, 2000).length).toBeLessThanOrEqual(2000);
  });

  const pointArb = fc.record({
    x: fc.double({ min: -1000, max: 1000, noNaN: true }),
    y: fc.double({ min: -1000, max: 1000, noNaN: true }),
  });

  it('propriedade: nunca passa de maxPoints e mantém as pontas', () => {
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 3, maxLength: 300 }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.integer({ min: 2, max: 40 }),
        (points, tolerance, maxPoints) => {
          const result = simplifyPolyline(points, tolerance, maxPoints);
          expect(result.length).toBeLessThanOrEqual(maxPoints);
          expect(result.length).toBeGreaterThanOrEqual(2);
          expect(result[0]).toBe(points[0]);
          expect(result[result.length - 1]).toBe(points[points.length - 1]);
        },
      ),
    );
  });

  it('propriedade: com folga no teto, todo ponto fica a até a tolerância do resultado', () => {
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 3, maxLength: 200 }),
        fc.double({ min: 0.01, max: 50, noNaN: true }),
        (points, tolerance) => {
          const result = simplifyPolyline(points, tolerance, points.length);
          for (const point of points) {
            expect(distanceToPolyline(point, result)).toBeLessThanOrEqual(tolerance + 1e-9);
          }
        },
      ),
    );
  });
});
