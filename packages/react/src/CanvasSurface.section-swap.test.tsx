// @vitest-environment jsdom
import { act, createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvasSection } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSurface, type CanvasSurfaceHandle } from './CanvasSurface.js';

/**
 * Contexto 2D falso: o jsdom não implementa `getContext`, e sem contexto o `<canvas-surface>` não
 * chega a montar (emite `canvas-error`), então a troca de `section` não remonta nada. Com um
 * contexto que aceita qualquer chamada, a montagem acontece e `canvas-ready` é emitido.
 */
function fakeContext2d(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = { canvas: { width: 800, height: 600 } };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key as string];
      if (key === 'measureText') {
        return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      }
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (key === 'createLinearGradient' || key === 'createPattern') {
        return () => ({ addColorStop: () => undefined });
      }
      if (key === 'isPointInPath' || key === 'isPointInStroke') return () => false;
      return () => undefined;
    },
    set(t, key, value) {
      t[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe('CanvasSurface (React): canvas-ready e canvas-error na montagem e na troca de section', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => fakeContext2d() as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    act(() => {
      root.unmount();
    });
    container.remove();
    getContextSpy.mockRestore();
  });

  it('na ordem do navegador (sem act), monta uma vez só, já com a section do host', async () => {
    // Sem act(), o React roda os efeitos passivos numa tarefa posterior ao microtask em que o Lit
    // executa firstUpdated → _mount(), como acontece num navegador de verdade.
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      false;
    const onCanvasReady = vi.fn();
    const onError = vi.fn();
    const a = createCanvasSection();
    // canvas-ready borbulha: o contêiner vê toda montagem, inclusive as que o adaptador perderia.
    const readySections: unknown[] = [];
    container.addEventListener('canvas-ready', (event) => {
      readySections.push((event as CustomEvent<{ section: unknown }>).detail.section);
    });

    root.render(<CanvasSurface section={a} onCanvasReady={onCanvasReady} onError={onError} />);
    await settle();

    expect(onCanvasReady).toHaveBeenCalledTimes(1);
    expect(onCanvasReady).toHaveBeenCalledWith({ section: a });
    expect(onError).not.toHaveBeenCalled();
    // Uma montagem só: nenhuma section interna transitória antes da do host.
    expect(readySections).toEqual([a]);
  });

  it('na ordem do navegador (sem act), em StrictMode, monta uma vez só com a section do host', async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      false;
    const onCanvasReady = vi.fn();
    const a = createCanvasSection();
    const readySections: unknown[] = [];
    container.addEventListener('canvas-ready', (event) => {
      readySections.push((event as CustomEvent<{ section: unknown }>).detail.section);
    });

    root.render(
      <StrictMode>
        <CanvasSurface section={a} onCanvasReady={onCanvasReady} />
      </StrictMode>,
    );
    await settle();

    expect(onCanvasReady).toHaveBeenCalledTimes(1);
    expect(onCanvasReady).toHaveBeenCalledWith({ section: a });
    expect(readySections).toEqual([a]);
  });

  it('na ordem do navegador (sem act), sem section do host, monta já com a section do adaptador', async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      false;
    const onCanvasReady = vi.fn();
    const ref = createRef<CanvasSurfaceHandle>();
    const readySections: unknown[] = [];
    container.addEventListener('canvas-ready', (event) => {
      readySections.push((event as CustomEvent<{ section: unknown }>).detail.section);
    });

    root.render(<CanvasSurface ref={ref} onCanvasReady={onCanvasReady} />);
    await settle();

    const adapterSection = ref.current?.section;
    expect(adapterSection).toBeDefined();
    expect(onCanvasReady).toHaveBeenCalledTimes(1);
    expect(onCanvasReady).toHaveBeenCalledWith({ section: adapterSection });
    // Sem section interna do elemento antes da do adaptador (ela seria descartada sem destroy()).
    expect(readySections).toEqual([adapterSection]);
  });

  it('na ordem do navegador (sem act), entrega onError se a montagem inicial falhar', async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      false;
    getContextSpy.mockImplementation(() => null as never);
    const onCanvasReady = vi.fn();
    const onError = vi.fn();

    root.render(<CanvasSurface onCanvasReady={onCanvasReady} onError={onError} />);
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith({
      error: expect.objectContaining({ code: 'CONTEXT_UNAVAILABLE' }),
    });
    expect(onCanvasReady).not.toHaveBeenCalled();
  });

  it('entrega onCanvasReady da nova instância ao trocar section', async () => {
    const onCanvasReady = vi.fn();
    const a = createCanvasSection();
    const b = createCanvasSection();

    act(() => {
      root.render(<CanvasSurface section={a} onCanvasReady={onCanvasReady} />);
    });
    await settle();
    // Pré-condição: a primeira montagem já aconteceu; sem ela a troca não remonta nada.
    expect(onCanvasReady).toHaveBeenCalledWith({ section: a });
    onCanvasReady.mockClear();

    act(() => {
      root.render(<CanvasSurface section={b} onCanvasReady={onCanvasReady} />);
    });
    await settle();

    expect(onCanvasReady).toHaveBeenCalledTimes(1);
    expect(onCanvasReady).toHaveBeenCalledWith({ section: b });
  });

  it('entrega onError quando a remontagem da nova section falha', async () => {
    const onError = vi.fn();
    const onCanvasReady = vi.fn();
    const a = createCanvasSection();
    const b = createCanvasSection();

    act(() => {
      root.render(<CanvasSurface section={a} onCanvasReady={onCanvasReady} onError={onError} />);
    });
    await settle();
    expect(onCanvasReady).toHaveBeenCalledWith({ section: a });

    getContextSpy.mockImplementation(() => null as never);
    act(() => {
      root.render(<CanvasSurface section={b} onCanvasReady={onCanvasReady} onError={onError} />);
    });
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
