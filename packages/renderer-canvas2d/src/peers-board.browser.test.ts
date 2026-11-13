import { createCanvasSection, type CanvasSectionApi, type CanvasPeer } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, type RendererHandle } from './index.js';

// O contorno de bloqueio e a prévia de arrasto de um board remoto, no canvas de verdade (spec
// boards, US-BD.15 e US-BD.16): nada disso entra no documento.

const peer = (overrides: Partial<CanvasPeer> = {}): CanvasPeer => ({
  sessionId: 'p1',
  name: 'Ana',
  color: '#dc2626',
  cursor: null,
  selection: [],
  selectedAt: 1,
  drag: null,
  view: null,
  locks: [],
  followed: false,
  ...overrides,
});

describe('board remoto no renderer (navegador real)', () => {
  let container: HTMLDivElement;
  let section: CanvasSectionApi;
  let handle: RendererHandle;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = 'position:relative;width:400px;height:300px';
    document.body.appendChild(container);
    section = createCanvasSection();
    const result = mount({ section, container });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
    const created = section.transact([
      {
        type: 'shape.create',
        shape: {
          id: 'b',
          type: 'board',
          x: 60,
          y: 100,
          width: 200,
          height: 120,
          style: { fill: null, fillOpacity: 1, stroke: null },
        },
      },
      {
        type: 'shape.create',
        shape: {
          id: 'c',
          type: 'rectangle',
          x: 90,
          y: 140,
          width: 50,
          height: 40,
          rotation: 0,
          style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 },
        },
      },
      { type: 'board.attach', boardId: 'b', ids: ['c'] },
    ] as never);
    expect(created.ok).toBe(true);
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  /** O pixel do canvas na posição de tela (CSS px) como [r, g, b, a]. */
  const pixelAt = async (x: number, y: number): Promise<number[]> => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / 400;
    const { data } = canvas
      .getContext('2d')!
      .getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1);
    return [data[0]!, data[1]!, data[2]!, data[3]!];
  };
  const isReddish = (pixel: number[]): boolean =>
    pixel[0]! > 170 && pixel[1]! < 110 && pixel[2]! < 110 && pixel[3]! > 100;

  it('o contorno de bloqueio de A aparece no board travado, na cor de A', async () => {
    section.setPeers([peer({ locks: ['b'] })]);

    // A borda esquerda do board, a meio da altura: o contorno de 2 px é centrado nela.
    await expect.poll(async () => isReddish(await pixelAt(60, 160))).toBe(true);
    // O contorno cobre a faixa do título: o canto superior da caixa fica 24 acima do board.
    await expect.poll(async () => isReddish(await pixelAt(160, 76))).toBe(true);
  });

  it('o contorno de bloqueio de B aparece no filho travado, e o board não leva o contorno', async () => {
    section.setPeers([peer({ sessionId: 'p2', locks: ['c'] })]);

    await expect.poll(async () => isReddish(await pixelAt(90, 160))).toBe(true);
    expect(isReddish(await pixelAt(60, 160))).toBe(false);
  });

  it('enquanto A arrasta o board, a prévia mostra o board e o filho deslocados juntos', async () => {
    section.setPeers([peer({ locks: ['b'], drag: { ids: ['b', 'c'], dx: 100, dy: 0 } })]);

    // A moldura do board deslocada: a borda esquerda vai de x = 60 para x = 160.
    await expect.poll(async () => isReddish(await pixelAt(160, 160))).toBe(true);
    // O filho deslocado: a borda esquerda dele vai de x = 90 para x = 190.
    await expect.poll(async () => isReddish(await pixelAt(190, 160))).toBe(true);
  });

  it('a prévia e o contorno não mudam o documento, a revisão nem o histórico', () => {
    const before = section.getSnapshot();
    const json = JSON.stringify(before.document);

    section.setPeers([peer({ locks: ['b'], drag: { ids: ['b', 'c'], dx: 100, dy: 0 } })]);

    const after = section.getSnapshot();
    expect(after.revision).toBe(before.revision);
    expect(after.history).toEqual(before.history);
    expect(JSON.stringify(after.document)).toBe(json);
  });
});
