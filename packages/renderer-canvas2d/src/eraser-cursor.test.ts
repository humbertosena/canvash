import { describe, expect, it } from 'vitest';
import { paintOverlays } from './overlays.js';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function recordingContext(): { context: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const context = new Proxy(state, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : (...args: unknown[]) => {
            calls.push({ method: key, args });
            return undefined;
          },
    set: (target, key: string, value) => {
      target[key] = value;
      calls.push({ method: `set ${key}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

const named = (calls: readonly Call[], method: string) => calls.filter((c) => c.method === method);

describe('indicador da borracha no overlay', () => {
  it('desenha um círculo no ponto em tela, com o raio em CSS px', () => {
    const { context, calls } = recordingContext();
    paintOverlays(context, {
      viewport: { x: 10, y: 20, zoom: 1 },
      eraserCursor: { x: 100, y: 50, radius: 8 },
    });
    expect(named(calls, 'arc')).toEqual([{ method: 'arc', args: [110, 70, 8, 0, 2 * Math.PI] }]);
    expect(named(calls, 'stroke')).toHaveLength(1);
    expect(named(calls, 'set lineWidth').map((c) => c.args[0])).toContain(1);
  });

  it('o raio não muda com o zoom, só a posição', () => {
    const at = (zoom: number) => {
      const { context, calls } = recordingContext();
      paintOverlays(context, {
        viewport: { x: 0, y: 0, zoom },
        eraserCursor: { x: 100, y: 50, radius: 16 },
      });
      return named(calls, 'arc')[0]!.args;
    };
    expect(at(1)).toEqual([100, 50, 16, 0, 2 * Math.PI]);
    expect(at(2)).toEqual([200, 100, 16, 0, 2 * Math.PI]);
    expect(at(0.5)).toEqual([50, 25, 16, 0, 2 * Math.PI]);
  });

  it('usa a cor padrão e aceita outra pelas opções', () => {
    const colorOf = (color?: string) => {
      const { context, calls } = recordingContext();
      paintOverlays(context, {
        viewport: { x: 0, y: 0, zoom: 1 },
        eraserCursor: { x: 0, y: 0, radius: 4 },
        options: color ? { eraserCursorColor: color } : undefined,
      });
      return named(calls, 'set strokeStyle').map((c) => c.args[0]);
    };
    expect(colorOf()).toEqual(['#334155']);
    expect(colorOf('#ff0000')).toEqual(['#ff0000']);
  });

  it('sem indicador e sem mais nada, não pinta', () => {
    const { context, calls } = recordingContext();
    paintOverlays(context, { viewport: { x: 0, y: 0, zoom: 1 }, eraserCursor: null });
    expect(calls).toHaveLength(0);
  });

  it('convive com a seleção sem a atrapalhar', () => {
    const { context, calls } = recordingContext();
    paintOverlays(context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      marquee: { x: 0, y: 0, width: 10, height: 10 },
      eraserCursor: { x: 5, y: 5, radius: 4 },
    });
    expect(named(calls, 'fillRect')).toHaveLength(1);
    expect(named(calls, 'arc')).toHaveLength(1);
  });
});
