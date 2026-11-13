import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';

interface Internals {
  readonly _rendererHandle: { getGridPointer: () => { x: number; y: number } | null } | undefined;
}

describe('<canvas-surface>: realce do grid com o ponteiro real', () => {
  let element: CanvasSurfaceElement | undefined;

  beforeAll(() => {
    // Registra só o canvas: carregar os demais componentes aqui mudaria a contagem de cobertura.
    if (!customElements.get('canvas-surface'))
      customElements.define('canvas-surface', CanvasSurfaceElement);
  });

  afterEach(() => {
    element?.remove();
    element = undefined;
  });

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  async function setup(attributes: Record<string, string> = {}): Promise<CanvasSurfaceElement> {
    const el = document.createElement('canvas-surface') as CanvasSurfaceElement;
    el.style.cssText = 'display:block;width:400px;height:300px';
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    document.body.appendChild(el);
    await el.updateComplete;
    element = el;
    await nextFrame();
    return el;
  }

  const container = (el: CanvasSurfaceElement): HTMLElement =>
    el.shadowRoot!.querySelector('.surface-container') as HTMLElement;

  const pixel = (el: CanvasSurfaceElement, x: number, y: number): readonly number[] => {
    const canvas = el.shadowRoot!.querySelector('canvas')!;
    const ratio = canvas.width / canvas.clientWidth;
    const data = canvas
      .getContext('2d')!
      .getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!];
  };

  const move = async (el: CanvasSurfaceElement, x: number, y: number): Promise<void> => {
    const rect = container(el).getBoundingClientRect();
    container(el).dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        bubbles: true,
        clientX: rect.left + x,
        clientY: rect.top + y,
      }),
    );
    await nextFrame();
    await nextFrame();
  };

  it('o pointermove no contêiner chega ao renderer e escurece o ponto sob o cursor', async () => {
    const el = await setup();
    expect(pixel(el, 200, 200)).toEqual([0xc9, 0xcb, 0xd1, 255]);

    await move(el, 200, 200);

    expect((el as unknown as Internals)._rendererHandle?.getGridPointer()).toEqual({
      x: 200,
      y: 200,
    });
    expect(pixel(el, 200, 200)).toEqual([0x8b, 0x8f, 0x99, 255]);
  });

  it('o pointerleave apaga o realce', async () => {
    const el = await setup();
    await move(el, 200, 200);

    container(el).dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }));
    await nextFrame();
    await nextFrame();

    expect((el as unknown as Internals)._rendererHandle?.getGridPointer()).toBeNull();
    expect(pixel(el, 200, 200)).toEqual([0xc9, 0xcb, 0xd1, 255]);
  });

  it('com grid-highlight="off" os pixels não mudam', async () => {
    const el = await setup({ 'grid-highlight': 'off' });

    await move(el, 200, 200);

    expect(pixel(el, 200, 200)).toEqual([0xc9, 0xcb, 0xd1, 255]);
  });

  it('trocar o atributo religa e desliga o realce', async () => {
    const el = await setup({ 'grid-highlight': 'off' });
    el.setAttribute('grid-highlight', 'on');
    await el.updateComplete;
    await nextFrame();

    await move(el, 200, 200);

    expect(pixel(el, 200, 200)).toEqual([0x8b, 0x8f, 0x99, 255]);
  });
});
