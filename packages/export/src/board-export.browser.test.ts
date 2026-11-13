import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportPng } from './index.js';

// O PNG só do board, lido pixel a pixel (spec board-export, §4.2; US-BE.1 a 3).

async function decode(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return {
    width: bitmap.width,
    height: bitmap.height,
    at: (x: number, y: number): number[] => {
      const i = (Math.round(y) * bitmap.width + Math.round(x)) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    },
  };
}

/** O board de referência (100, 50, 300 × 200) com um filho de (350, 100) a (450, 150). */
function setup(board: Record<string, unknown> = {}): CanvasSectionApi {
  const section = createCanvasSection();
  const result = section.transact([
    {
      type: 'shape.create',
      shape: {
        id: 'b1',
        type: 'board',
        x: 100,
        y: 50,
        width: 300,
        height: 200,
        title: 'Oculto',
        ...board,
      },
    },
    {
      type: 'shape.create',
      shape: {
        id: 'child',
        type: 'rectangle',
        x: 350,
        y: 100,
        width: 100,
        height: 50,
        rotation: 0,
        style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    },
    { type: 'board.attach', boardId: 'b1', ids: ['child'] },
  ] as never);
  expect(result.ok).toBe(true);
  return section;
}

async function png(section: CanvasSectionApi, options: Record<string, unknown> = {}) {
  const result = await exportPng(section, {
    scope: { board: 'b1' },
    scale: 2,
    ...options,
  } as never);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('exportação recusada');
  return decode(result.value);
}

describe('exportPng com o escopo de board (navegador)', () => {
  it('US-BE.1: 602 × 402 px com scale 2, e 642 × 442 com padding 10', async () => {
    const plain = await png(setup());
    const padded = await png(setup(), { padding: 10 });

    expect([plain.width, plain.height]).toEqual([602, 402]);
    expect([padded.width, padded.height]).toEqual([642, 442]);
  });

  it('US-BE.2: o filho que passa da borda é recortado; fora do board o pixel é transparente', async () => {
    const image = await png(setup(), { padding: 20 });
    // O pixel do ponto (x, y) do documento: ((x − bounds.x) × scale, (y − bounds.y) × scale).
    const pixel = (x: number, y: number) => image.at((x - 79.5) * 2, (y - 29.5) * 2);

    expect(pixel(410, 125)[3]).toBe(0);
    expect(pixel(375, 125)).toEqual([255, 0, 0, 255]);
  });

  it('US-BE.3: o fundo com fillOpacity 0.5 tem alfa em torno de 128, e o filho não herda esse alfa', async () => {
    const image = await png(setup({ style: { fill: '#00ff00', fillOpacity: 0.5, stroke: null } }));
    const pixel = (x: number, y: number) => image.at((x - 100) * 2, (y - 50) * 2);

    const background = pixel(150, 200);
    expect(background.slice(0, 3)).toEqual([0, 255, 0]);
    expect(Math.abs(background[3]! - 128)).toBeLessThanOrEqual(2);
    expect(pixel(375, 125)).toEqual([255, 0, 0, 255]);
  });

  it('US-BE.3: o título não é pintado na faixa acima do board', async () => {
    const image = await png(setup(), { padding: 30 });

    // A faixa do título ficaria 24 acima de y = 50: nenhum pixel dela tem a cor do título.
    for (let x = 0; x < image.width; x += 1) {
      for (let y = 0; y < 2 * 30; y += 1) {
        expect(image.at(x, y)[3]).toBe(0);
      }
    }
  });

  it('a borda aparece no padding e o fundo da opção cobre a área inteira', async () => {
    const image = await png(setup({ style: { fill: null, fillOpacity: 1, stroke: '#0000ff' } }), {
      padding: 10,
      background: '#ffffff',
    });

    // bounds.x = 100 − 0,5 − 10 = 89,5: a borda de 1 está em x = 100 (pixel 21).
    expect(image.at(0, 0)).toEqual([255, 255, 255, 255]);
    expect(image.at(21, 100)).toEqual([0, 0, 255, 255]);
  });
});
