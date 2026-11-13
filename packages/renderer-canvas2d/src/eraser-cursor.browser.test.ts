import { createCanvasSection } from '@canvash/core';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type RendererHandle } from './index.js';

describe('indicador da borracha no canvas real', () => {
  let container: HTMLElement;
  let handle: RendererHandle | undefined;

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    container?.remove();
  });

  function setup() {
    container = document.createElement('div');
    container.style.width = '300px';
    container.style.height = '200px';
    document.body.appendChild(container);
    const section = createCanvasSection();
    const result = mount({ section, container });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
    return { section, handle: result.value };
  }

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  function pixel(x: number, y: number): readonly number[] {
    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / canvas.clientWidth;
    const data = canvas
      .getContext('2d')!
      .getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!];
  }

  it('desenha o círculo em CSS px e o apaga ao esconder', async () => {
    const { handle } = setup();
    // As coordenadas fogem das linhas do grid, que o canvas desenha de 20 em 20 px.
    handle.setEraserCursor({ x: 101, y: 103, radius: 20 });
    await nextFrame();
    await nextFrame();
    expect(handle.getEraserCursor()).toEqual({ x: 101, y: 103, radius: 20 });
    // Sobre a borda do círculo há tinta; no centro e longe dele, não.
    expect(pixel(121, 103)[3]).toBeGreaterThan(0);
    expect(pixel(101, 103)[3]).toBe(0);
    expect(pixel(201, 153)[3]).toBe(0);

    handle.setEraserCursor(null);
    await nextFrame();
    await nextFrame();
    expect(pixel(121, 103)[3]).toBe(0);
    expect(handle.getEraserCursor()).toBeNull();
  });

  it('o raio fica o mesmo em qualquer zoom e a posição acompanha o mundo', async () => {
    const { section, handle } = setup();
    section.setViewport({ x: 0, y: 0, zoom: 2 });
    handle.setEraserCursor({ x: 75.5, y: 51.5, radius: 20 });
    await nextFrame();
    await nextFrame();
    // O ponto de mundo (75,5; 51,5) está na tela em (151, 103); a borda a 20 CSS px dele.
    expect(pixel(171, 103)[3]).toBeGreaterThan(0);
    expect(pixel(191, 103)[3]).toBe(0);
  });

  it('a cor vem de --canvash-eraser-cursor no contêiner', async () => {
    const { handle } = setup();
    container.style.setProperty('--canvash-eraser-cursor', '#ff0000');
    handle.setEraserCursor({ x: 101, y: 103, radius: 20 });
    await nextFrame();
    await nextFrame();
    const [r, g, b, a] = pixel(121, 103);
    expect(a).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('o mesmo indicador não força nova pintura', async () => {
    const { handle } = setup();
    handle.setEraserCursor({ x: 10, y: 10, radius: 8 });
    await nextFrame();
    await nextFrame();
    const painted = handle.getMetrics().paintCount;
    handle.setEraserCursor({ x: 10, y: 10, radius: 8 });
    await nextFrame();
    await nextFrame();
    expect(handle.getMetrics().paintCount).toBe(painted);
  });

  it('depois do destroy, o indicador é ignorado', () => {
    const { handle } = setup();
    handle.setEraserCursor({ x: 10, y: 10, radius: 8 });
    handle.destroy();
    handle.setEraserCursor({ x: 20, y: 20, radius: 8 });
    expect(handle.getEraserCursor()).toBeNull();
  });
});
