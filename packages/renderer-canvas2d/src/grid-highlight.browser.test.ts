import { createCanvasSection } from '@canvash/core';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type GridOptions, type RendererHandle } from './index.js';

describe('realce do grid no canvas real', () => {
  let container: HTMLElement;
  let handle: RendererHandle | undefined;
  const originalDpr = window.devicePixelRatio;

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    container?.remove();
    Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
  });

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  function setup(dpr: number, grid?: GridOptions): RendererHandle {
    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.appendChild(container);
    const result = mount({ section: createCanvasSection(), container, grid });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
    return result.value;
  }

  const rgba = (x: number, y: number): readonly number[] => {
    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / canvas.clientWidth;
    const data = canvas
      .getContext('2d')!
      .getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!];
  };

  async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
  }

  it.each([1, 2])(
    'DPR %i: escurece o ponto sob o cursor e só ele até o raio de 120 px',
    async (dpr) => {
      const renderer = setup(dpr);
      await settle();
      expect(rgba(200, 200)).toEqual([0xc9, 0xcb, 0xd1, 255]);

      renderer.setGridPointer({ x: 200, y: 200 });
      await settle();

      expect(rgba(200, 200)).toEqual([0x8b, 0x8f, 0x99, 255]);
      const [r] = rgba(260, 200);
      expect(r).toBeGreaterThan(0x8b);
      expect(r).toBeLessThan(0xc9);
      expect(rgba(340, 200)).toEqual([0xc9, 0xcb, 0xd1, 255]);
      // Entre dois pontos a camada continua transparente.
      expect(rgba(210, 210)[3]).toBe(0);
      expect(rgba(250, 190)[3]).toBe(0);
    },
  );

  it('apagar a posição devolve todos os pontos à cor base', async () => {
    const renderer = setup(1);
    renderer.setGridPointer({ x: 200, y: 200 });
    await settle();
    expect(rgba(200, 200)).toEqual([0x8b, 0x8f, 0x99, 255]);

    renderer.setGridPointer(null);
    await settle();

    expect(rgba(200, 200)).toEqual([0xc9, 0xcb, 0xd1, 255]);
  });

  it('com highlight false os pixels não mudam', async () => {
    const renderer = setup(1, { highlight: false });
    renderer.setGridPointer({ x: 200, y: 200 });
    await settle();

    expect(rgba(200, 200)).toEqual([0xc9, 0xcb, 0xd1, 255]);
  });

  it('o ponto continua com 1 CSS px de raio em DPR 2', async () => {
    const renderer = setup(2);
    renderer.setGridPointer({ x: 200, y: 200 });
    await settle();

    // 1 CSS px de raio = 2 px de backing store para cada lado do centro (px 398 a 401).
    expect(rgba(198.5, 200)[3]).toBe(0);
    expect(rgba(199, 200)[3]).toBe(255);
    expect(rgba(200.5, 200)[3]).toBe(255);
    expect(rgba(201, 200)[3]).toBe(0);
  });
});
