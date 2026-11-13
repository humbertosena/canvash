import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { GridOptions, PaintGridParams } from './grid.js';
import { calculateAdaptiveGridStep, paintGrid } from './grid.js';

describe('calculateAdaptiveGridStep', () => {
  it('mantém o passo base em zoom 1.0 quando dentro da faixa confortável', () => {
    const step = calculateAdaptiveGridStep({ baseSize: 20, zoom: 1 });
    expect(step).toBe(20);
    // 20 * 1 = 20px em tela
    expect(step * 1).toBeGreaterThanOrEqual(16);
    expect(step * 1).toBeLessThanOrEqual(100);
  });

  it('amplia o passo em zoom reduzido (zoom 0.05) para evitar acúmulo subpixel de linhas', () => {
    const step = calculateAdaptiveGridStep({ baseSize: 20, zoom: 0.05 });
    // Sem adaptação: 20 * 0.05 = 1px (ilegível)
    // Com adaptação: step = 320 -> 320 * 0.05 = 16px em tela
    expect(step).toBe(320);
    const screenStep = step * 0.05;
    expect(screenStep).toBeGreaterThanOrEqual(16);
    expect(screenStep).toBeLessThanOrEqual(100);
  });

  it('reduz o passo em zoom elevado (zoom 16) para manter referência visual detalhada', () => {
    const step = calculateAdaptiveGridStep({ baseSize: 20, zoom: 16 });
    // Sem adaptação: 20 * 16 = 320px
    // Com adaptação: step = 5 -> 5 * 16 = 80px em tela
    expect(step).toBe(5);
    const screenStep = step * 16;
    expect(screenStep).toBeGreaterThanOrEqual(16);
    expect(screenStep).toBeLessThanOrEqual(100);
  });

  it('respeita limites customizados de minScreenStep e maxScreenStep', () => {
    const step = calculateAdaptiveGridStep({
      baseSize: 50,
      zoom: 0.1,
      minScreenStep: 25,
      maxScreenStep: 150,
    });
    const screenStep = step * 0.1;
    expect(screenStep).toBeGreaterThanOrEqual(25);
    expect(screenStep).toBeLessThanOrEqual(150);
  });

  it('lida defensivamente com valores inválidos ou não finitos', () => {
    expect(calculateAdaptiveGridStep({ baseSize: 0, zoom: 1 })).toBe(20);
    expect(calculateAdaptiveGridStep({ baseSize: -10, zoom: 1 })).toBe(20);
    expect(calculateAdaptiveGridStep({ baseSize: 20, zoom: 0 })).toBe(20);
    expect(calculateAdaptiveGridStep({ baseSize: 20, zoom: Number.NaN })).toBe(20);
  });
});

describe('paintGrid', () => {
  it('respeita o contrato estrito de tipos', () => {
    expectTypeOf<GridOptions>().toBeObject();
    expectTypeOf<PaintGridParams>().toBeObject();
  });

  it('não executa nenhuma operação no contexto se enabled for false', () => {
    const save = vi.fn();
    const stroke = vi.fn();
    const fakeContext = { save, stroke } as unknown as CanvasRenderingContext2D;

    paintGrid(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 800,
      height: 600,
      options: { enabled: false },
    });

    expect(save).not.toHaveBeenCalled();
    expect(stroke).not.toHaveBeenCalled();
  });

  it('não executa nenhuma operação no contexto se dimensões forem <= 0', () => {
    const save = vi.fn();
    const fakeContext = { save } as unknown as CanvasRenderingContext2D;

    paintGrid(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 0,
      height: 600,
    });

    paintGrid(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 800,
      height: -50,
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('alinha linhas com a origem do mundo (0, 0) e preserva estabilidade durante pan', () => {
    const moves: { x: number; y: number }[] = [];
    const lines: { x: number; y: number }[] = [];

    const fakeContext = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      stroke: vi.fn(),
      moveTo: (x: number, y: number) => moves.push({ x, y }),
      lineTo: (x: number, y: number) => lines.push({ x, y }),
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    // Viewport com pan x = 100, y = 60, zoom = 1
    paintGrid(fakeContext, {
      viewport: { x: 100, y: 60, zoom: 1 },
      width: 800,
      height: 600,
      options: { size: 20, style: 'lines' },
    });

    expect(fakeContext.save).toHaveBeenCalledTimes(1);
    expect(fakeContext.beginPath).toHaveBeenCalledTimes(1);
    expect(fakeContext.stroke).toHaveBeenCalledTimes(1);
    expect(fakeContext.restore).toHaveBeenCalledTimes(1);

    // Como o mundo 0 está em panX = 100 e panY = 60:
    // Deve haver uma linha vertical passando exatamente por x = 100
    const verticalOriginLine = moves.find((m) => Math.abs(m.x - 100) < 0.001 && m.y === 0);
    expect(verticalOriginLine).toBeDefined();

    // Deve haver uma linha horizontal passando exatamente por y = 60
    const horizontalOriginLine = moves.find((m) => Math.abs(m.y - 60) < 0.001 && m.x === 0);
    expect(horizontalOriginLine).toBeDefined();

    // As linhas adjacentes devem estar separadas exatamente por 20px (step * zoom)
    const verticalLine20 = moves.find((m) => Math.abs(m.x - 120) < 0.001 && m.y === 0);
    expect(verticalLine20).toBeDefined();
  });

  it('em zoom reduzido (0.05) desenha uma quantidade controlada e limpa de linhas', () => {
    const moves: { x: number; y: number }[] = [];

    const fakeContext = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      stroke: vi.fn(),
      moveTo: (x: number, y: number) => moves.push({ x, y }),
      lineTo: vi.fn(),
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    paintGrid(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 0.05 },
      width: 800,
      height: 600,
      options: { size: 20, style: 'lines' },
    });

    // Sem densidade adaptativa, haveria (800 / (20 * 0.05)) + (600 / 1) = 1400 linhas!
    // Com passo adaptativo de 320 (16px em tela):
    // Linhas verticais: ~51, horizontais: ~39 -> Total ~90 linhas
    expect(moves.length).toBeLessThan(100);
    expect(moves.length).toBeGreaterThan(20);
  });
});

interface DotRecorder {
  readonly context: CanvasRenderingContext2D;
  readonly rects: { x: number; y: number; width: number; height: number }[];
  readonly calls: string[];
  readonly styles: { fillStyle: string; strokeStyle: string };
}

/** Contexto gravador que registra os pontos (retângulos) e a ordem das chamadas. */
function recordDots(): DotRecorder {
  const rects: DotRecorder['rects'] = [];
  const calls: string[] = [];
  const styles = { fillStyle: '', strokeStyle: '' };
  const context = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    rect: (x: number, y: number, width: number, height: number) => {
      calls.push('rect');
      rects.push({ x, y, width, height });
    },
    get fillStyle() {
      return styles.fillStyle;
    },
    set fillStyle(value: string) {
      styles.fillStyle = value;
    },
    get strokeStyle() {
      return styles.strokeStyle;
    },
    set strokeStyle(value: string) {
      styles.strokeStyle = value;
    },
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
  return { context, rects, calls, styles };
}

const centerOf = (r: { x: number; y: number; width: number }): { x: number; y: number } => ({
  x: r.x + r.width / 2,
  y: r.y + r.width / 2,
});

describe('paintGrid: pontos (estilo padrão)', () => {
  it('desenha pontos num único path com um único fill, sem traçar linhas', () => {
    const { context, rects, calls } = recordDots();

    paintGrid(context, { viewport: { x: 0, y: 0, zoom: 1 }, width: 800, height: 600 });

    expect(rects.length).toBeGreaterThan(1000);
    expect(calls.filter((c) => c === 'beginPath')).toHaveLength(1);
    expect(calls.filter((c) => c === 'fill')).toHaveLength(1);
    expect(calls).not.toContain('stroke');
    expect(calls).not.toContain('lineTo');
    expect(calls[0]).toBe('save');
    expect(calls[calls.length - 1]).toBe('restore');
  });

  it('alinha os pontos à origem do mundo e os mantém ancorados durante o pan', () => {
    const { context, rects } = recordDots();

    paintGrid(context, { viewport: { x: 100, y: 60, zoom: 1 }, width: 800, height: 600 });

    const centers = rects.map(centerOf);
    expect(centers).toContainEqual({ x: 100, y: 60 });
    expect(centers).toContainEqual({ x: 120, y: 60 });
    expect(centers).toContainEqual({ x: 100, y: 80 });
  });

  it('mantém o espaçamento de tela entre 16 e 100 px em zoom 0,05, 1 e 16', () => {
    for (const zoom of [0.05, 1, 16]) {
      const { context, rects } = recordDots();

      paintGrid(context, { viewport: { x: 0, y: 0, zoom }, width: 800, height: 600 });

      const xs = [...new Set(rects.map((r) => centerOf(r).x))].sort((a, b) => a - b);
      const spacing = (xs[1] ?? 0) - (xs[0] ?? 0);
      expect(spacing).toBeGreaterThanOrEqual(15.5);
      expect(spacing).toBeLessThanOrEqual(100.5);
    }
  });

  it('mantém o ponto com o mesmo tamanho de tela em qualquer zoom (raio padrão de 1 px)', () => {
    for (const zoom of [0.05, 1, 16]) {
      const { context, rects } = recordDots();

      paintGrid(context, { viewport: { x: 0, y: 0, zoom }, width: 800, height: 600 });

      expect(new Set(rects.map((r) => r.width))).toEqual(new Set([2]));
      expect(new Set(rects.map((r) => r.height))).toEqual(new Set([2]));
    }
  });

  it('desenha só pontos visíveis, sem acumular pontos subpixel em zoom reduzido', () => {
    const { context, rects } = recordDots();

    paintGrid(context, { viewport: { x: 0, y: 0, zoom: 0.05 }, width: 800, height: 600 });

    expect(rects.length).toBeLessThan(2500);
    expect(rects.length).toBeGreaterThan(20);
  });

  it('usa #c9cbd1 nos pontos e #e2e8f0 nas linhas, e respeita a cor explícita nos dois', () => {
    const dots = recordDots();
    paintGrid(dots.context, { viewport: { x: 0, y: 0, zoom: 1 }, width: 100, height: 100 });
    expect(dots.styles.fillStyle).toBe('#c9cbd1');

    const lines = recordDots();
    paintGrid(lines.context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 100,
      height: 100,
      options: { style: 'lines' },
    });
    expect(lines.styles.strokeStyle).toBe('#e2e8f0');

    const customDots = recordDots();
    paintGrid(customDots.context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 100,
      height: 100,
      options: { color: '#ff0000' },
    });
    expect(customDots.styles.fillStyle).toBe('#ff0000');

    const customLines = recordDots();
    paintGrid(customLines.context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 100,
      height: 100,
      options: { style: 'lines', color: '#00ff00' },
    });
    expect(customLines.styles.strokeStyle).toBe('#00ff00');
  });

  it('aplica dotRadius e cai no padrão quando o valor é inválido', () => {
    const big = recordDots();
    paintGrid(big.context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 100,
      height: 100,
      options: { dotRadius: 2 },
    });
    expect(new Set(big.rects.map((r) => r.width))).toEqual(new Set([4]));

    for (const dotRadius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { context, rects } = recordDots();
      paintGrid(context, {
        viewport: { x: 0, y: 0, zoom: 1 },
        width: 100,
        height: 100,
        options: { dotRadius },
      });
      expect(new Set(rects.map((r) => r.width))).toEqual(new Set([2]));
    }
  });

  it('não desenha nada com enabled false nem com contexto sem rect', () => {
    const disabled = recordDots();
    paintGrid(disabled.context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 100,
      height: 100,
      options: { enabled: false },
    });
    expect(disabled.calls).toHaveLength(0);

    const incomplete = { beginPath: vi.fn() } as unknown as CanvasRenderingContext2D;
    expect(() =>
      paintGrid(incomplete, { viewport: { x: 0, y: 0, zoom: 1 }, width: 100, height: 100 }),
    ).not.toThrow();
    expect(incomplete.beginPath).not.toHaveBeenCalled();
  });

  it('o estilo lines produz as mesmas chamadas de antes (traços, sem fill)', () => {
    const { context, calls, rects } = recordDots();

    paintGrid(context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      width: 100,
      height: 100,
      options: { style: 'lines' },
    });

    expect(calls).toContain('stroke');
    expect(calls).toContain('lineTo');
    expect(calls).not.toContain('fill');
    expect(rects).toHaveLength(0);
  });
});
