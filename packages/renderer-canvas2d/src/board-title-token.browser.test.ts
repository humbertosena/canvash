import { createCanvasSection } from '@canvash/core';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type RendererHandle } from './index.js';

describe('título do board no canvas real (--canvash-board-title-color)', () => {
  let container: HTMLElement;
  let handle: RendererHandle | undefined;

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    container?.remove();
  });

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  /** Monta um board em (40, 60, 220 × 100); o título fica na faixa de y = 36 a 60. */
  async function setup(token?: string): Promise<void> {
    container = document.createElement('div');
    container.style.width = '320px';
    container.style.height = '200px';
    if (token !== undefined) container.style.setProperty('--canvash-board-title-color', token);
    document.body.appendChild(container);

    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'b',
        type: 'board',
        x: 40,
        y: 60,
        width: 220,
        height: 100,
        title: 'WWWWWWWWWWWW',
        style: { fill: null, stroke: null },
      },
    } as never);
    const result = mount({ section, container, grid: { enabled: false } });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
    await nextFrame();
    await nextFrame();
  }

  /** Os pixels da faixa do título, como [r, g, b, a]. */
  function titlePixels(): number[][] {
    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / canvas.clientWidth;
    const context = canvas.getContext('2d')!;
    const { data } = context.getImageData(
      Math.round(40 * ratio),
      Math.round(36 * ratio),
      Math.round(220 * ratio),
      Math.round(24 * ratio),
    );
    const found: number[][] = [];
    for (let i = 0; i < data.length; i += 4)
      found.push([data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]);
    return found;
  }

  it('sem o token, o título sai em #3f3f46', async () => {
    await setup();

    const solid = titlePixels().filter(([, , , a]) => a! > 240);

    expect(solid.length).toBeGreaterThan(10);
    for (const [r, g, b] of solid) {
      expect(r).toBeCloseTo(0x3f, -1);
      expect(g).toBeCloseTo(0x3f, -1);
      expect(b).toBeCloseTo(0x46, -1);
    }
  });

  it('o token no contêiner troca a cor do título', async () => {
    await setup('#ff0000');

    const solid = titlePixels().filter(([, , , a]) => a! > 240);

    expect(solid.length).toBeGreaterThan(10);
    for (const [r, g, b] of solid) {
      expect(r).toBeGreaterThan(240);
      expect(g).toBeLessThan(16);
      expect(b).toBeLessThan(16);
    }
  });

  it('o board vazio de fundo e borda não pinta nada além do título', async () => {
    await setup();

    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / canvas.clientWidth;
    const { data } = canvas
      .getContext('2d')!
      .getImageData(Math.round(60 * ratio), Math.round(80 * ratio), 20, 20);

    expect(data.every((value) => value === 0)).toBe(true);
  });
});
