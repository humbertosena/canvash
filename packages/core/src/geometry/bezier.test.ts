import { describe, expect, it } from 'vitest';
import {
  bezierBounds,
  bezierPoint,
  defaultBezierControls,
  flattenBezier,
  mirrorControl,
  type BezierCurve,
} from './bezier.js';
import { distanceToSegment } from './shapes.js';

/** Arco simétrico: sobe de (0, 0) a (100, 0) passando por (50, 75) em t = 0,5. */
const ARC: BezierCurve = {
  start: { x: 0, y: 0 },
  control1: { x: 0, y: 100 },
  control2: { x: 100, y: 100 },
  end: { x: 100, y: 0 },
};

/** Curva em S cujo x passa de 0 e de 100 entre as pontas. */
const S_CURVE: BezierCurve = {
  start: { x: 0, y: 0 },
  control1: { x: 400, y: 0 },
  control2: { x: -300, y: 100 },
  end: { x: 100, y: 100 },
};

function samples(curve: BezierCurve, count: number) {
  return Array.from({ length: count + 1 }, (_, k) => bezierPoint(curve, k / count));
}

describe('bezierPoint', () => {
  it('devolve as pontas em t = 0 e t = 1 e o ponto calculado à mão em t = 0,5', () => {
    expect(bezierPoint(ARC, 0)).toEqual({ x: 0, y: 0 });
    expect(bezierPoint(ARC, 1)).toEqual({ x: 100, y: 0 });
    // 0,125·P0 + 0,375·P1 + 0,375·P2 + 0,125·P3
    expect(bezierPoint(ARC, 0.5)).toEqual({ x: 50, y: 75 });
    // t = 0,25: pesos 27/64, 27/64, 9/64, 1/64
    const quarter = bezierPoint(ARC, 0.25);
    expect(quarter.x).toBeCloseTo((9 / 64) * 100 + (1 / 64) * 100, 12);
    expect(quarter.y).toBeCloseTo((27 / 64) * 100 + (9 / 64) * 100, 12);
  });
});

describe('bezierBounds', () => {
  it('é exata no arco: o topo em t = 0,5 fica fora do polígono de controle', () => {
    expect(bezierBounds(ARC)).toEqual({ x: 0, y: 0, width: 100, height: 75 });
  });

  it('acha os extremos internos pelas raízes da derivada', () => {
    // x'(t) = 6600t² − 6600t + 1200: raízes em t = (1 ± √(1 − 8/11)) / 2
    const root = Math.sqrt(1 - 8 / 11);
    const xs = [(1 - root) / 2, (1 + root) / 2].map((t) => bezierPoint(S_CURVE, t).x);
    const bounds = bezierBounds(S_CURVE);
    expect(bounds.x).toBeCloseTo(Math.min(...xs), 12);
    expect(bounds.x + bounds.width).toBeCloseTo(Math.max(...xs), 12);
    expect(bounds.x).toBeLessThan(-28);
    expect(bounds.x + bounds.width).toBeGreaterThan(128);
    expect(bounds.y).toBe(0);
    expect(bounds.height).toBe(100);
    for (const point of samples(S_CURVE, 2000)) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.x - 1e-9);
      expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-9);
    }
  });

  it('trata derivada linear (coeficiente quadrático nulo) e curva reta', () => {
    // x: 0, 10, 20, 30 é linear em t: sem extremo interno
    const straight: BezierCurve = {
      start: { x: 0, y: 0 },
      control1: { x: 10, y: 0 },
      control2: { x: 20, y: 0 },
      end: { x: 30, y: 0 },
    };
    expect(bezierBounds(straight)).toEqual({ x: 0, y: 0, width: 30, height: 0 });

    // y: 0, 40, 40, 0 zera o termo quadrático da derivada: o topo sai da raiz linear, t = 0,5
    const parabola: BezierCurve = {
      start: { x: 0, y: 0 },
      control1: { x: 10, y: 40 },
      control2: { x: 20, y: 40 },
      end: { x: 30, y: 0 },
    };
    expect(bezierBounds(parabola).height).toBeCloseTo(30, 12);
  });
});

describe('mirrorControl', () => {
  it('reflete pela mediatriz da corda', () => {
    expect(mirrorControl({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 20, y: -30 })).toEqual({
      x: 80,
      y: -30,
    });
    const diagonal = mirrorControl({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 50 });
    expect(diagonal.x).toBeCloseTo(50, 12);
    expect(diagonal.y).toBeCloseTo(100, 12);
  });

  it('é a própria inversa', () => {
    const start = { x: -12, y: 7 };
    const end = { x: 43, y: -91 };
    const control = { x: 3.5, y: 60 };
    const back = mirrorControl(start, end, mirrorControl(start, end, control));
    expect(back.x).toBeCloseTo(control.x, 9);
    expect(back.y).toBeCloseTo(control.y, 9);
  });
});

describe('defaultBezierControls', () => {
  it('põe os controles a 1/3 e 2/3 da corda, deslocados 1/4 dela para cima da corda', () => {
    expect(defaultBezierControls({ x: 0, y: 0 }, { x: 120, y: 0 })).toEqual({
      control1: { x: 40, y: -30 },
      control2: { x: 80, y: -30 },
    });
    const vertical = defaultBezierControls({ x: 0, y: 0 }, { x: 0, y: 120 });
    expect(vertical.control1.x).toBeCloseTo(30, 12);
    expect(vertical.control1.y).toBeCloseTo(40, 12);
    expect(vertical.control2.x).toBeCloseTo(30, 12);
    expect(vertical.control2.y).toBeCloseTo(80, 12);
  });

  it('dá controles simétricos', () => {
    const start = { x: 5, y: 9 };
    const end = { x: 77, y: -31 };
    const { control1, control2 } = defaultBezierControls(start, end);
    const mirrored = mirrorControl(start, end, control1);
    expect(mirrored.x).toBeCloseTo(control2.x, 9);
    expect(mirrored.y).toBeCloseTo(control2.y, 9);
  });
});

describe('flattenBezier', () => {
  function polylineDistance(
    point: { x: number; y: number },
    polyline: readonly { x: number; y: number }[],
  ) {
    let best = Infinity;
    for (let i = 1; i < polyline.length; i++) {
      best = Math.min(best, distanceToSegment(point, polyline[i - 1]!, polyline[i]!));
    }
    return best;
  }

  it.each([10, 1, 0.01])('fica a até %d da curva, das pontas às pontas', (tolerance) => {
    const polyline = flattenBezier(S_CURVE, tolerance);
    expect(polyline[0]).toEqual(S_CURVE.start);
    expect(polyline.at(-1)).toEqual(S_CURVE.end);
    for (const point of samples(S_CURVE, 1000)) {
      expect(polylineDistance(point, polyline)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('usa mais segmentos quanto menor a tolerância, com teto', () => {
    const coarse = flattenBezier(ARC, 10).length;
    const fine = flattenBezier(ARC, 0.01).length;
    expect(fine).toBeGreaterThan(coarse);
    expect(flattenBezier(ARC, 0).length).toBeLessThanOrEqual(4097);
    expect(flattenBezier(ARC, Number.NaN).length).toBeLessThanOrEqual(4097);
  });

  it('curva reta vira um segmento só', () => {
    const straight: BezierCurve = {
      start: { x: 0, y: 0 },
      control1: { x: 10, y: 10 },
      control2: { x: 20, y: 20 },
      end: { x: 30, y: 30 },
    };
    expect(flattenBezier(straight, 0.1)).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 30 },
    ]);
  });
});
