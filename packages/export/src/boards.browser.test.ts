import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportPng } from './index.js';

// O PNG do documento com board (spec boards, US-BD.13): o fundo com o alfa, a borda, o título
// em #3f3f46 e o filho à frente do fundo, tudo pela mesma cena do Canvas.

const SCALE = 4;

/** Os pixels do PNG, na escala `SCALE`, a partir do canto superior esquerdo da caixa. */
async function decode(blob: Blob): Promise<{
  width: number;
  height: number;
  at: (x: number, y: number) => number[];
  data: Uint8ClampedArray;
}> {
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
    data,
    at: (x, y) => {
      const i = (y * bitmap.width + x) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    },
  };
}

function setup() {
  const section = createCanvasSection();
  const result = section.transact([
    {
      type: 'shape.create',
      shape: {
        id: 'b',
        type: 'board',
        x: 100,
        y: 200,
        width: 300,
        height: 150,
        title: 'MMMM',
        style: { fill: '#00ff00', fillOpacity: 0.5, stroke: '#0000ff' },
      },
    },
    {
      type: 'shape.create',
      shape: {
        id: 'c',
        type: 'rectangle',
        x: 120,
        y: 230,
        width: 40,
        height: 30,
        rotation: 0,
        style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    },
    { type: 'board.attach', boardId: 'b', ids: ['c'] },
  ] as never);
  expect(result.ok).toBe(true);
  return section;
}

describe('exportPng com board (navegador)', () => {
  it('a caixa tem a faixa do título e meia unidade da borda', async () => {
    const result = await exportPng(setup(), { scale: SCALE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const image = await decode(result.value);

    // De (99.5, 175.5) a (400.5, 350.5): 301 × 175 unidades.
    expect(image.width).toBe(301 * SCALE);
    expect(image.height).toBe(175 * SCALE);
  });

  it('o fundo tem a cor com o alfa, a borda a cor dela, e o filho a cor dele, sem o alfa do fundo', async () => {
    const result = await exportPng(setup(), { scale: SCALE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const image = await decode(result.value);
    // Unidade do documento → pixel: a origem da caixa é (99.5, 175.5).
    const px = (x: number, y: number): [number, number] => [
      Math.round((x - 99.5) * SCALE),
      Math.round((y - 175.5) * SCALE),
    ];

    const [bx, by] = px(300, 320);
    const background = image.at(bx, by);
    expect(background.slice(0, 3)).toEqual([0, 255, 0]);
    expect(Math.abs(background[3]! - 128)).toBeLessThanOrEqual(2);

    const [sx, sy] = px(100, 300);
    expect(image.at(sx, sy)).toEqual([0, 0, 255, 255]);

    const [cx, cy] = px(140, 245);
    expect(image.at(cx, cy)).toEqual([255, 0, 0, 255]);
  });

  it('o título tem pixels em #3f3f46 na faixa acima do board', async () => {
    const result = await exportPng(setup(), { scale: SCALE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const image = await decode(result.value);

    // A faixa vai de y = 176 a 200 (24 unidades) e a caixa começa em y = 175.5.
    const top = Math.round((176 - 175.5) * SCALE);
    const bottom = Math.round((200 - 175.5) * SCALE);
    let solid = 0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const [r, g, b, a] = image.at(x, y);
        if (r === 0x3f && g === 0x3f && b === 0x46 && a === 255) solid += 1;
      }
    }
    expect(solid).toBeGreaterThan(20);
  });

  it('com scope selection e um board selecionado, o filho entra e o que está fora não', async () => {
    const section = setup();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'out',
        type: 'rectangle',
        x: 900,
        y: 600,
        width: 50,
        height: 50,
        rotation: 0,
        style: { fill: '#ff00ff', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });
    section.setSelection(['b']);

    const result = await exportPng(section, { scale: 2, scope: 'selection' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const image = await decode(result.value);

    expect(image.width).toBe(301 * 2);
    expect(image.height).toBe(175 * 2);
    let magenta = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i] === 255 && image.data[i + 1] === 0 && image.data[i + 2] === 255) {
        magenta += 1;
      }
    }
    expect(magenta).toBe(0);
  });
});
