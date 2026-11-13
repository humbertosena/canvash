import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitViewportToBounds } from './viewport-fit.js';
import { DEFAULT_ZOOM_LIMITS, worldToScreen } from './transform.js';

const AREA = { width: 800, height: 600 };

describe('fitViewportToBounds', () => {
  it('enquadra uma caixa larga pelo eixo horizontal e a centraliza', () => {
    const viewport = fitViewportToBounds({ x: 0, y: 0, width: 1000, height: 100 }, AREA);

    // área útil: 800 - 80 = 720 de largura; 720 / 1000 = 0,72
    expect(viewport?.zoom).toBeCloseTo(0.72, 10);
    expect(viewport && worldToScreen(viewport, { x: 500, y: 50 })).toEqual({ x: 400, y: 300 });
  });

  it('enquadra uma caixa alta pelo eixo vertical e a centraliza', () => {
    const viewport = fitViewportToBounds({ x: 100, y: 200, width: 100, height: 1040 }, AREA);

    // área útil: 600 - 80 = 520 de altura; 520 / 1040 = 0,5
    expect(viewport?.zoom).toBeCloseTo(0.5, 10);
    expect(viewport && worldToScreen(viewport, { x: 150, y: 720 })).toEqual({ x: 400, y: 300 });
  });

  it('usa a margem informada em cada lado', () => {
    const viewport = fitViewportToBounds({ x: 0, y: 0, width: 400, height: 400 }, AREA, {
      padding: 100,
    });

    // área útil: 400 de largura e 400 de altura
    expect(viewport?.zoom).toBeCloseTo(1, 10);
  });

  it('limita o zoom a 16 numa caixa minúscula', () => {
    const viewport = fitViewportToBounds({ x: 5, y: 5, width: 1, height: 1 }, AREA);

    expect(viewport?.zoom).toBe(DEFAULT_ZOOM_LIMITS.max);
    expect(viewport && worldToScreen(viewport, { x: 5.5, y: 5.5 })).toEqual({ x: 400, y: 300 });
  });

  it('limita o zoom a 0,05 numa caixa enorme', () => {
    const viewport = fitViewportToBounds(
      { x: -5_000_000, y: -5_000_000, width: 10_000_000, height: 10_000_000 },
      AREA,
    );

    expect(viewport?.zoom).toBe(DEFAULT_ZOOM_LIMITS.min);
  });

  it('respeita limites de zoom customizados', () => {
    const viewport = fitViewportToBounds({ x: 0, y: 0, width: 10, height: 10 }, AREA, {
      limits: { min: 0.5, max: 2 },
    });

    expect(viewport?.zoom).toBe(2);
  });

  it('mantém a área útil positiva quando a margem é maior que a área', () => {
    const viewport = fitViewportToBounds({ x: 0, y: 0, width: 100, height: 100 }, AREA, {
      padding: 10_000,
    });

    // área útil mínima de 1 px: zoom = 1 / 100
    expect(viewport?.zoom).toBe(DEFAULT_ZOOM_LIMITS.min);
  });

  it('devolve null para caixa sem área', () => {
    expect(fitViewportToBounds({ x: 0, y: 0, width: 0, height: 100 }, AREA)).toBeNull();
    expect(fitViewportToBounds({ x: 0, y: 0, width: 100, height: 0 }, AREA)).toBeNull();
    expect(fitViewportToBounds({ x: 0, y: 0, width: -5, height: 100 }, AREA)).toBeNull();
  });

  it('devolve null para área de apresentação sem tamanho', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };

    expect(fitViewportToBounds(bounds, { width: 0, height: 600 })).toBeNull();
    expect(fitViewportToBounds(bounds, { width: 800, height: 0 })).toBeNull();
  });

  it('devolve null para entrada não finita', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };

    expect(fitViewportToBounds({ ...bounds, x: Number.NaN }, AREA)).toBeNull();
    expect(fitViewportToBounds({ ...bounds, width: Number.POSITIVE_INFINITY }, AREA)).toBeNull();
    expect(fitViewportToBounds(bounds, { width: Number.NaN, height: 600 })).toBeNull();
    expect(fitViewportToBounds(bounds, AREA, { padding: Number.NaN })).toBeNull();
  });

  it('propriedade: o centro da caixa cai no centro da área, com o zoom dentro dos limites', () => {
    const coordinate = fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true });
    const length = fc.double({ min: 0.01, max: 1_000_000, noNaN: true });
    const side = fc.double({ min: 50, max: 4000, noNaN: true });

    fc.assert(
      fc.property(coordinate, coordinate, length, length, side, side, (x, y, w, h, aw, ah) => {
        const viewport = fitViewportToBounds(
          { x, y, width: w, height: h },
          { width: aw, height: ah },
        );
        expect(viewport).not.toBeNull();
        if (!viewport) return;

        expect(viewport.zoom).toBeGreaterThanOrEqual(DEFAULT_ZOOM_LIMITS.min);
        expect(viewport.zoom).toBeLessThanOrEqual(DEFAULT_ZOOM_LIMITS.max);
        const center = worldToScreen(viewport, { x: x + w / 2, y: y + h / 2 });
        expect(Math.abs(center.x - aw / 2)).toBeLessThan(1e-6);
        expect(Math.abs(center.y - ah / 2)).toBeLessThan(1e-6);
      }),
    );
  });
});
