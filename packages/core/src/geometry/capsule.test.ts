import { describe, expect, it } from 'vitest';
import { capsuleInterval, segmentOutsideCapsule } from './capsule.js';

const P = { x: 0, y: 0 };
const Q = { x: 10, y: 0 };

describe('segmentOutsideCapsule', () => {
  it('um segmento longe da cápsula fica inteiro fora', () => {
    expect(segmentOutsideCapsule({ x: 0, y: 20 }, { x: 10, y: 20 }, P, Q, 2)).toEqual([[0, 1]]);
  });

  it('um segmento dentro da cápsula não deixa nada fora', () => {
    expect(segmentOutsideCapsule({ x: 2, y: 0 }, { x: 8, y: 1 }, P, Q, 3)).toEqual([]);
  });

  it('um segmento que atravessa a cápsula uma vez deixa os dois lados', () => {
    // Vertical em x = 5 de y = -10 a y = 10 corta a faixa |y| ≤ 2 entre t = 0,4 e t = 0,6.
    const outside = segmentOutsideCapsule({ x: 5, y: -10 }, { x: 5, y: 10 }, P, Q, 2);
    expect(outside).toHaveLength(2);
    expect(outside[0]![0]).toBe(0);
    expect(outside[0]![1]).toBeCloseTo(0.4, 12);
    expect(outside[1]![0]).toBeCloseTo(0.6, 12);
    expect(outside[1]![1]).toBe(1);
  });

  it('um segmento que entra e fica dentro deixa só o trecho de fora', () => {
    const outside = segmentOutsideCapsule({ x: 5, y: -10 }, { x: 5, y: 0 }, P, Q, 2);
    expect(outside).toHaveLength(1);
    expect(outside[0]![0]).toBe(0);
    expect(outside[0]![1]).toBeCloseTo(0.8, 12);
  });

  it('o disco da ponta também corta: segmento que passa só pela ponta arredondada', () => {
    // Passa a 1,5 do ponto Q, ao lado da ponta (fora do retângulo, dentro do disco).
    const outside = segmentOutsideCapsule({ x: 11, y: -5 }, { x: 11, y: 5 }, P, Q, 2);
    expect(outside).toHaveLength(2);
    const half = Math.sqrt(2 * 2 - 1);
    expect(outside[0]![1]).toBeCloseTo((5 - half) / 10, 12);
    expect(outside[1]![0]).toBeCloseTo((5 + half) / 10, 12);
  });

  it('um segmento que só toca a borda num ponto não é cortado', () => {
    expect(segmentOutsideCapsule({ x: 5, y: -5 }, { x: 5, y: -2 }, P, Q, 2)).toEqual([[0, 1]]);
    expect(segmentOutsideCapsule({ x: 12, y: -3 }, { x: 12, y: 3 }, P, Q, 2)).toEqual([[0, 1]]);
  });

  it('um segmento sobre a borda (distância igual ao raio) está sob a borracha, como em "≤ raio"', () => {
    expect(segmentOutsideCapsule({ x: 0, y: 2 }, { x: 10, y: 2 }, P, Q, 2)).toEqual([]);
  });

  it('um segmento minúsculo vale como um ponto', () => {
    expect(segmentOutsideCapsule({ x: 3, y: 1 }, { x: 3, y: 1 + 1e-12 }, P, Q, 2)).toEqual([]);
    expect(segmentOutsideCapsule({ x: 3, y: 9 }, { x: 3, y: 9 + 1e-12 }, P, Q, 2)).toEqual([
      [0, 1],
    ]);
  });

  it('uma cápsula de um ponto só é um disco', () => {
    const outside = segmentOutsideCapsule({ x: -10, y: 0 }, { x: 10, y: 0 }, P, P, 4);
    expect(outside).toEqual([
      [0, 0.3],
      [0.7, 1],
    ]);
  });

  it('um segmento de comprimento zero é um ponto: dentro some, fora fica', () => {
    expect(segmentOutsideCapsule({ x: 3, y: 1 }, { x: 3, y: 1 }, P, Q, 2)).toEqual([]);
    expect(segmentOutsideCapsule({ x: 3, y: 9 }, { x: 3, y: 9 }, P, Q, 2)).toEqual([[0, 1]]);
  });

  it('um segmento paralelo ao eixo da cápsula e dentro da faixa é coberto pelo trecho do eixo', () => {
    const outside = segmentOutsideCapsule({ x: -10, y: 1 }, { x: 20, y: 1 }, P, Q, 2);
    expect(outside).toHaveLength(2);
    // Sai do disco de P em x = -sqrt(3) e do disco de Q em x = 10 + sqrt(3).
    expect(outside[0]![1]).toBeCloseTo((10 - Math.sqrt(3)) / 30, 12);
    expect(outside[1]![0]).toBeCloseTo((20 + Math.sqrt(3)) / 30 - 0.0, 12);
  });

  it('um segmento que não atinge a cápsula nos parâmetros 0 a 1, ainda que a reta atinja', () => {
    expect(segmentOutsideCapsule({ x: 5, y: -30 }, { x: 5, y: -10 }, P, Q, 2)).toEqual([[0, 1]]);
  });

  it('capsuleInterval devolve o trecho dentro, ou null', () => {
    expect(capsuleInterval({ x: 5, y: -10 }, { x: 5, y: 10 }, P, Q, 2)).toEqual([
      expect.closeTo(0.4, 12),
      expect.closeTo(0.6, 12),
    ]);
    expect(capsuleInterval({ x: 0, y: 20 }, { x: 10, y: 20 }, P, Q, 2)).toBeNull();
  });
});
