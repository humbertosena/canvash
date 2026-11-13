import { createCanvasSection } from '@canvash/core';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type MountOptions, type RendererHandle } from './index.js';

describe('acento da seleção no canvas real (--canvash-accent-select)', () => {
  let container: HTMLElement;
  let handle: RendererHandle | undefined;

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    container?.remove();
  });

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  /** Monta com um retângulo selecionado em (60, 60, 80, 60); o grid fica desligado. */
  async function setup(options: {
    token?: string;
    overlays?: MountOptions['overlays'];
  }): Promise<void> {
    container = document.createElement('div');
    container.style.width = '300px';
    container.style.height = '200px';
    if (options.token !== undefined)
      container.style.setProperty('--canvash-accent-select', options.token);
    document.body.appendChild(container);

    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'r1',
        type: 'rectangle',
        x: 60,
        y: 60,
        width: 80,
        height: 60,
        rotation: 0,
        style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });
    section.setSelection(['r1']);
    const result = mount({
      section,
      container,
      grid: { enabled: false },
      ...(options.overlays ? { overlays: options.overlays } : {}),
    });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
    await nextFrame();
    await nextFrame();
  }

  /** Cor (RGB) do pixel com tinta mais opaco (y = 75 fica longe das alças, que são brancas) numa faixa em torno da borda esquerda do contorno (fora do retângulo, que tem preenchimento). */
  function outlineColor(): readonly [number, number, number] {
    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / canvas.clientWidth;
    const context = canvas.getContext('2d')!;
    let best: readonly number[] = [0, 0, 0, 0];
    for (let x = 57; x <= 59; x += 1) {
      const data = context.getImageData(Math.round(x * ratio), Math.round(75 * ratio), 1, 1).data;
      if ((data[3] ?? 0) > (best[3] ?? 0)) best = [data[0]!, data[1]!, data[2]!, data[3]!];
    }
    expect(best[3]).toBeGreaterThan(0);
    return [best[0]!, best[1]!, best[2]!];
  }

  it('sem o token, o contorno usa o violeta padrão #6d5df6', async () => {
    await setup({});

    const [r, g, b] = outlineColor();

    expect(r).toBeCloseTo(0x6d, -1);
    expect(g).toBeCloseTo(0x5d, -1);
    expect(b).toBeCloseTo(0xf6, -1);
  });

  it('o token no contêiner troca a cor do contorno e das alças', async () => {
    await setup({ token: '#ff0000' });

    const [r, g, b] = outlineColor();

    expect(r).toBeGreaterThan(240);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
  });

  it('a opção selectionColor explícita vence o token', async () => {
    await setup({
      token: '#ff0000',
      overlays: { selectionColor: '#00ff00', handleStroke: '#00ff00' },
    });

    const [r, g, b] = outlineColor();

    expect(g).toBeGreaterThan(240);
    expect(r).toBeLessThan(20);
    expect(b).toBeLessThan(20);
  });

  it('o preenchimento do marquee deriva do token quando ele é #rrggbb', async () => {
    await setup({ token: '#ff0000' });
    const section = createCanvasSection();
    handle?.destroy();
    const result = mount({ section, container, grid: { enabled: false } });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
    section.setPreview({ marquee: { x: 150, y: 20, width: 100, height: 100 } });
    await nextFrame();
    await nextFrame();

    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / canvas.clientWidth;
    const data = canvas
      .getContext('2d')!
      .getImageData(Math.round(200 * ratio), Math.round(70 * ratio), 1, 1).data;

    // 8% de vermelho puro sobre o vazio: alfa baixo, cor vermelha
    expect(data[3]).toBeGreaterThan(5);
    expect(data[3]).toBeLessThan(60);
    expect(data[0]).toBeGreaterThan(240);
    expect(data[2]).toBeLessThan(20);
  });
});
