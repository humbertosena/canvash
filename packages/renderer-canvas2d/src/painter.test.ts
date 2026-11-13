import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ProjectedScene,
  RenderableBezier,
  RenderableBoard,
  RenderableCircle,
  RenderableEllipse,
  RenderableItem,
  RenderableLine,
  RenderablePolygon,
  RenderableRectangle,
  RenderableSquare,
  RenderableText,
} from './index.js';
import { paintItem, paintScene } from './index.js';

interface MockCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

function createMockContext() {
  const calls: MockCall[] = [];
  const state = {
    globalAlpha: 1,
    fillStyle: '#000000' as unknown,
    strokeStyle: '#000000' as unknown,
    lineWidth: 1,
    font: '10px sans-serif' as unknown,
    textBaseline: 'alphabetic' as unknown,
  };

  const context = {
    get calls(): readonly MockCall[] {
      return calls;
    },
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
      calls.push({ method: 'set globalAlpha', args: [v] });
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: unknown) {
      state.fillStyle = v;
      calls.push({ method: 'set fillStyle', args: [v] });
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: unknown) {
      state.strokeStyle = v;
      calls.push({ method: 'set strokeStyle', args: [v] });
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
      calls.push({ method: 'set lineWidth', args: [v] });
    },
    get font() {
      return state.font;
    },
    set font(v: unknown) {
      state.font = v;
      calls.push({ method: 'set font', args: [v] });
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(v: unknown) {
      state.textBaseline = v;
      calls.push({ method: 'set textBaseline', args: [v] });
    },
    save: () => calls.push({ method: 'save', args: [] }),
    restore: () => calls.push({ method: 'restore', args: [] }),
    translate: (x: number, y: number) => calls.push({ method: 'translate', args: [x, y] }),
    rotate: (angle: number) => calls.push({ method: 'rotate', args: [angle] }),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push({ method: 'fillRect', args: [x, y, w, h] }),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      calls.push({ method: 'strokeRect', args: [x, y, w, h] }),
    beginPath: () => calls.push({ method: 'beginPath', args: [] }),
    ellipse: (
      x: number,
      y: number,
      rx: number,
      ry: number,
      rot: number,
      start: number,
      end: number,
    ) => calls.push({ method: 'ellipse', args: [x, y, rx, ry, rot, start, end] }),
    fill: () => calls.push({ method: 'fill', args: [] }),
    stroke: () => calls.push({ method: 'stroke', args: [] }),
    moveTo: (x: number, y: number) => calls.push({ method: 'moveTo', args: [x, y] }),
    lineTo: (x: number, y: number) => calls.push({ method: 'lineTo', args: [x, y] }),
    closePath: () => calls.push({ method: 'closePath', args: [] }),
    bezierCurveTo: (cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) =>
      calls.push({ method: 'bezierCurveTo', args: [cp1x, cp1y, cp2x, cp2y, x, y] }),
    fillText: (text: string, x: number, y: number) =>
      calls.push({ method: 'fillText', args: [text, x, y] }),
    strokeText: (text: string, x: number, y: number) =>
      calls.push({ method: 'strokeText', args: [text, x, y] }),
  } as unknown as CanvasRenderingContext2D & { readonly calls: readonly MockCall[] };

  return context;
}

describe('contrato de tipos de painter', () => {
  it('paintItem e paintScene recebem contexto Canvas 2D e retornam void', () => {
    expectTypeOf<typeof paintItem>().parameters.toEqualTypeOf<
      [CanvasRenderingContext2D, RenderableItem]
    >();
    expectTypeOf<typeof paintItem>().returns.toEqualTypeOf<void>();

    expectTypeOf<typeof paintScene>().parameters.toEqualTypeOf<
      [CanvasRenderingContext2D, ProjectedScene]
    >();
    expectTypeOf<typeof paintScene>().returns.toEqualTypeOf<void>();
  });
});

describe('pintura de retângulos', () => {
  it('pinta retângulo não rotacionado com fill e stroke (fill primeiro)', () => {
    const ctx = createMockContext();
    const rect: RenderableRectangle = {
      type: 'rectangle',
      id: 'r1',
      layerId: 'layer-1',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      style: {
        fill: '#ff0000',
        stroke: '#00ff00',
        strokeWidth: 2,
        opacity: 1,
      },
    };

    paintItem(ctx, rect);

    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'set fillStyle', args: ['#ff0000'] },
      { method: 'fillRect', args: [10, 20, 100, 50] },
      { method: 'set strokeStyle', args: ['#00ff00'] },
      { method: 'set lineWidth', args: [2] },
      { method: 'strokeRect', args: [10, 20, 100, 50] },
      { method: 'restore', args: [] },
    ]);
  });

  it('pinta quadrado (RenderableSquare) com fill e stroke', () => {
    const ctx = createMockContext();
    const square: RenderableSquare = {
      type: 'square',
      id: 'sq1',
      layerId: 'layer-1',
      x: 15,
      y: 25,
      width: 60,
      height: 60,
      rotation: 0,
      style: {
        fill: '#123456',
        stroke: '#654321',
        strokeWidth: 2,
        opacity: 1,
      },
    };

    paintItem(ctx, square);

    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'set fillStyle', args: ['#123456'] },
      { method: 'fillRect', args: [15, 25, 60, 60] },
      { method: 'set strokeStyle', args: ['#654321'] },
      { method: 'set lineWidth', args: [2] },
      { method: 'strokeRect', args: [15, 25, 60, 60] },
      { method: 'restore', args: [] },
    ]);
  });

  it('pinta retângulo rotacionado aplicando translação ao centro e rotação', () => {
    const ctx = createMockContext();
    const rect: RenderableRectangle = {
      type: 'rectangle',
      id: 'r2',
      layerId: 'layer-1',
      x: 100,
      y: 100,
      width: 60,
      height: 40,
      rotation: Math.PI / 4,
      style: {
        fill: '#0000ff',
        stroke: null,
        strokeWidth: 0,
        opacity: 1,
      },
    };

    paintItem(ctx, rect);

    // Centro: cx = 100 + 30 = 130, cy = 100 + 20 = 120
    // Dimensões centradas: x = -30, y = -20
    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'translate', args: [130, 120] },
      { method: 'rotate', args: [Math.PI / 4] },
      { method: 'set fillStyle', args: ['#0000ff'] },
      { method: 'fillRect', args: [-30, -20, 60, 40] },
      { method: 'restore', args: [] },
    ]);
  });

  it('pinta retângulo rotacionado com contorno', () => {
    const ctx = createMockContext();
    const rect: RenderableRectangle = {
      type: 'rectangle',
      id: 'r2-stroke',
      layerId: 'layer-1',
      x: 0,
      y: 0,
      width: 10,
      height: 20,
      rotation: 0.5,
      style: {
        fill: null,
        stroke: '#112233',
        strokeWidth: 4,
        opacity: 1,
      },
    };

    paintItem(ctx, rect);

    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'translate', args: [5, 10] },
      { method: 'rotate', args: [0.5] },
      { method: 'set strokeStyle', args: ['#112233'] },
      { method: 'set lineWidth', args: [4] },
      { method: 'strokeRect', args: [-5, -10, 10, 20] },
      { method: 'restore', args: [] },
    ]);
  });

  it('aplica globalAlpha quando opacity < 1', () => {
    const ctx = createMockContext();
    const rect: RenderableRectangle = {
      type: 'rectangle',
      id: 'r3',
      layerId: 'layer-1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      style: {
        fill: '#ffffff',
        stroke: null,
        strokeWidth: 0,
        opacity: 0.65,
      },
    };

    paintItem(ctx, rect);

    expect(ctx.calls[0]).toEqual({ method: 'save', args: [] });
    expect(ctx.calls[1]).toEqual({ method: 'set globalAlpha', args: [0.65] });
    expect(ctx.calls[ctx.calls.length - 1]).toEqual({ method: 'restore', args: [] });
  });

  it('não executa chamadas quando opacity <= 0 ou sem fill e sem stroke', () => {
    const ctx1 = createMockContext();
    paintItem(ctx1, {
      type: 'rectangle',
      id: 'r-transparent',
      layerId: 'layer-1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      style: { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 1, opacity: 0 },
    });
    expect(ctx1.calls).toHaveLength(0);

    const ctx2 = createMockContext();
    paintItem(ctx2, {
      type: 'rectangle',
      id: 'r-invisible',
      layerId: 'layer-1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 },
    });
    expect(ctx2.calls).toHaveLength(0);
  });
});

describe('pintura de elipses', () => {
  it('pinta elipse com beginPath, ellipse, fill e stroke', () => {
    const ctx = createMockContext();
    const ellipse: RenderableEllipse = {
      type: 'ellipse',
      id: 'e1',
      layerId: 'layer-1',
      x: 20,
      y: 40,
      width: 80,
      height: 60,
      rotation: 0.2,
      style: {
        fill: '#123456',
        stroke: '#654321',
        strokeWidth: 3,
        opacity: 0.8,
      },
    };

    paintItem(ctx, ellipse);

    // cx = 20 + 40 = 60, cy = 40 + 30 = 70, rx = 40, ry = 30
    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'set globalAlpha', args: [0.8] },
      { method: 'beginPath', args: [] },
      { method: 'ellipse', args: [60, 70, 40, 30, 0.2, 0, Math.PI * 2] },
      { method: 'set fillStyle', args: ['#123456'] },
      { method: 'fill', args: [] },
      { method: 'set strokeStyle', args: ['#654321'] },
      { method: 'set lineWidth', args: [3] },
      { method: 'stroke', args: [] },
      { method: 'restore', args: [] },
    ]);
  });

  it('pinta elipse apenas com stroke ou apenas com fill', () => {
    const ctxFillOnly = createMockContext();
    paintItem(ctxFillOnly, {
      type: 'ellipse',
      id: 'e-fill',
      layerId: 'layer-1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
    });
    expect(ctxFillOnly.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'beginPath', args: [] },
      { method: 'ellipse', args: [5, 5, 5, 5, 0, 0, Math.PI * 2] },
      { method: 'set fillStyle', args: ['#ff0000'] },
      { method: 'fill', args: [] },
      { method: 'restore', args: [] },
    ]);

    const ctxStrokeOnly = createMockContext();
    paintItem(ctxStrokeOnly, {
      type: 'ellipse',
      id: 'e-stroke',
      layerId: 'layer-1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      style: { fill: null, stroke: '#00ff00', strokeWidth: 2, opacity: 1 },
    });
    expect(ctxStrokeOnly.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'beginPath', args: [] },
      { method: 'ellipse', args: [5, 5, 5, 5, 0, 0, Math.PI * 2] },
      { method: 'set strokeStyle', args: ['#00ff00'] },
      { method: 'set lineWidth', args: [2] },
      { method: 'stroke', args: [] },
      { method: 'restore', args: [] },
    ]);
  });

  it('pinta círculo (RenderableCircle) com beginPath, ellipse com raios iguais, fill e stroke', () => {
    const ctx = createMockContext();
    const circle: RenderableCircle = {
      type: 'circle',
      id: 'c1',
      layerId: 'layer-1',
      x: 20,
      y: 30,
      width: 80,
      height: 80,
      rotation: 0,
      style: {
        fill: '#10b981',
        stroke: '#047857',
        strokeWidth: 2,
        opacity: 1,
      },
    };

    paintItem(ctx, circle);

    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'beginPath', args: [] },
      { method: 'ellipse', args: [60, 70, 40, 40, 0, 0, Math.PI * 2] },
      { method: 'set fillStyle', args: ['#10b981'] },
      { method: 'fill', args: [] },
      { method: 'set strokeStyle', args: ['#047857'] },
      { method: 'set lineWidth', args: [2] },
      { method: 'stroke', args: [] },
      { method: 'restore', args: [] },
    ]);
  });
});

describe('pintura de linhas', () => {
  it('pinta linha com beginPath, moveTo, lineTo, strokeStyle, lineWidth e stroke', () => {
    const ctx = createMockContext();
    const line: RenderableLine = {
      type: 'line',
      id: 'l1',
      layerId: 'layer-1',
      start: { x: 5, y: 10 },
      end: { x: 50, y: 80 },
      style: {
        fill: null,
        stroke: '#aabbcc',
        strokeWidth: 1.5,
        opacity: 0.9,
      },
    };

    paintItem(ctx, line);

    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'set globalAlpha', args: [0.9] },
      { method: 'beginPath', args: [] },
      { method: 'moveTo', args: [5, 10] },
      { method: 'lineTo', args: [50, 80] },
      { method: 'set strokeStyle', args: ['#aabbcc'] },
      { method: 'set lineWidth', args: [1.5] },
      { method: 'stroke', args: [] },
      { method: 'restore', args: [] },
    ]);
  });

  it('não pinta linha se stroke for nulo ou strokeWidth <= 0', () => {
    const ctx1 = createMockContext();
    paintItem(ctx1, {
      type: 'line',
      id: 'l-null-stroke',
      layerId: 'layer-1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      style: { fill: null, stroke: null, strokeWidth: 2, opacity: 1 },
    });
    expect(ctx1.calls).toHaveLength(0);

    const ctx2 = createMockContext();
    paintItem(ctx2, {
      type: 'line',
      id: 'l-zero-width',
      layerId: 'layer-1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      style: { fill: null, stroke: '#000000', strokeWidth: 0, opacity: 1 },
    });
    expect(ctx2.calls).toHaveLength(0);
  });
});

describe('paintScene e ordenação', () => {
  it('pinta itens em ordem estrita da cena projetada', () => {
    const ctx = createMockContext();
    const scene: ProjectedScene = {
      items: [
        {
          type: 'rectangle',
          id: 'r1',
          layerId: 'layer-1',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
        },
        {
          type: 'line',
          id: 'l1',
          layerId: 'layer-1',
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
          style: { fill: null, stroke: '#00ff00', strokeWidth: 1, opacity: 1 },
        },
      ],
    };

    paintScene(ctx, scene);

    const methodSequence = ctx.calls.map((c) => c.method);
    expect(methodSequence).toEqual([
      // Retângulo r1
      'save',
      'set fillStyle',
      'fillRect',
      'restore',
      // Linha l1
      'save',
      'beginPath',
      'moveTo',
      'lineTo',
      'set strokeStyle',
      'set lineWidth',
      'stroke',
      'restore',
    ]);
  });

  it('cena vazia não gera chamadas no contexto', () => {
    const ctx = createMockContext();
    paintScene(ctx, { items: [] });
    expect(ctx.calls).toHaveLength(0);
  });

  it('ignora tipo não suportado de forma segura', () => {
    const ctx = createMockContext();
    const unsupportedItem = {
      type: 'unknown_future_type',
      id: 'u1',
      style: { fill: '#fff', stroke: null, strokeWidth: 0, opacity: 1 },
    } as unknown as RenderableItem;

    paintItem(ctx, unsupportedItem);
    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'restore', args: [] },
    ]);
  });
});

describe('pintura de texto', () => {
  it('pinta texto não rotacionado configurando font, fillStyle e chamando fillText', () => {
    const ctx = createMockContext();
    const item: RenderableText = {
      type: 'text',
      id: 't1',
      layerId: 'l1',
      x: 10,
      y: 20,
      width: 200,
      height: 40,
      rotation: 0,
      text: 'Olá Canvash',
      fontSize: 16,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      textAlign: 'left',
      lineHeight: 1.25,
      style: { fill: '#123456', stroke: null, strokeWidth: 0, opacity: 1 },
    };

    paintItem(ctx, item);

    expect(ctx.calls).toContainEqual({ method: 'save', args: [] });
    expect(ctx.calls).toContainEqual({ method: 'set font', args: ['normal 16px sans-serif'] });
    expect(ctx.calls).toContainEqual({ method: 'set textBaseline', args: ['top'] });
    expect(ctx.calls).toContainEqual({ method: 'set fillStyle', args: ['#123456'] });
    expect(ctx.calls).toContainEqual({ method: 'fillText', args: ['Olá Canvash', 10, 20] });
    expect(ctx.calls).toContainEqual({ method: 'restore', args: [] });
  });

  it('pinta texto rotacionado com translate e rotate ao redor do centro', () => {
    const ctx = createMockContext();
    const item: RenderableText = {
      type: 'text',
      id: 't2',
      layerId: 'l1',
      x: 100,
      y: 200,
      width: 150,
      height: 50,
      rotation: Math.PI / 2,
      text: 'Rotacionado',
      fontSize: 20,
      fontFamily: 'Inter',
      fontWeight: 'bold',
      textAlign: 'center',
      lineHeight: 1.5,
      style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
    };

    paintItem(ctx, item);

    expect(ctx.calls).toContainEqual({ method: 'translate', args: [175, 225] });
    expect(ctx.calls).toContainEqual({ method: 'rotate', args: [Math.PI / 2] });
    expect(ctx.calls).toContainEqual({ method: 'set font', args: ['bold 20px Inter'] });
    expect(ctx.calls.some((c) => c.method === 'fillText')).toBe(true);
  });

  it('pinta contorno de texto com strokeText quando stroke e strokeWidth estão definidos', () => {
    const ctx = createMockContext();
    const item: RenderableText = {
      type: 'text',
      id: 't3',
      layerId: 'l1',
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      rotation: 0,
      text: 'Contorno',
      fontSize: 14,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      textAlign: 'left',
      lineHeight: 1.25,
      style: { fill: null, stroke: '#ff0000', strokeWidth: 2, opacity: 1 },
    };

    paintItem(ctx, item);

    expect(ctx.calls).toContainEqual({ method: 'set strokeStyle', args: ['#ff0000'] });
    expect(ctx.calls).toContainEqual({ method: 'set lineWidth', args: [2] });
    expect(ctx.calls.some((c) => c.method === 'strokeText')).toBe(true);
  });

  it('pula pintura de texto se opacity <= 0', () => {
    const ctx = createMockContext();
    const item: RenderableText = {
      type: 'text',
      id: 't4',
      layerId: 'l1',
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      rotation: 0,
      text: 'Invisível',
      fontSize: 14,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      textAlign: 'left',
      lineHeight: 1.25,
      style: { fill: '#000', stroke: null, strokeWidth: 0, opacity: 0 },
    };

    paintItem(ctx, item);
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('pintura de losango (diamond)', () => {
  it('pinta losango sem rotação usando os 4 pontos médios das arestas e closePath', () => {
    const ctx = createMockContext();
    paintItem(ctx, {
      type: 'diamond',
      id: 'd1',
      layerId: 'l1',
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      rotation: 0,
      style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 2, opacity: 1 },
    });

    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'beginPath', args: [] },
      { method: 'moveTo', args: [60, 20] },
      { method: 'lineTo', args: [110, 50] },
      { method: 'lineTo', args: [60, 80] },
      { method: 'lineTo', args: [10, 50] },
      { method: 'closePath', args: [] },
      { method: 'set fillStyle', args: ['#f59e0b'] },
      { method: 'fill', args: [] },
      { method: 'set strokeStyle', args: ['#b45309'] },
      { method: 'set lineWidth', args: [2] },
      { method: 'stroke', args: [] },
      { method: 'restore', args: [] },
    ]);
  });

  it('pinta losango rotacionado aplicando translate e rotate em torno do centro', () => {
    const ctx = createMockContext();
    paintItem(ctx, {
      type: 'diamond',
      id: 'd2',
      layerId: 'l1',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      rotation: Math.PI / 4,
      style: { fill: '#f59e0b', stroke: null, strokeWidth: 0, opacity: 1 },
    });

    expect(ctx.calls).toContainEqual({ method: 'translate', args: [50, 30] });
    expect(ctx.calls).toContainEqual({ method: 'rotate', args: [Math.PI / 4] });
    expect(ctx.calls).toContainEqual({ method: 'translate', args: [-50, -30] });
    expect(ctx.calls).toContainEqual({ method: 'closePath', args: [] });
    expect(ctx.calls).toContainEqual({ method: 'fill', args: [] });
  });
});

describe('pintura de triângulo (triangle)', () => {
  it('pinta triângulo isósceles usando ápice no centro superior, base inferior e closePath', () => {
    const ctx = createMockContext();
    paintItem(ctx, {
      type: 'triangle',
      id: 'tr1',
      layerId: 'l1',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      rotation: 0,
      variant: 'isosceles',
      apex: 0.5,
      style: { fill: '#8b5cf6', stroke: '#5b21b6', strokeWidth: 2, opacity: 1 },
    });

    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'beginPath', args: [] },
      { method: 'moveTo', args: [60, 20] },
      { method: 'lineTo', args: [110, 100] },
      { method: 'lineTo', args: [10, 100] },
      { method: 'closePath', args: [] },
      { method: 'set fillStyle', args: ['#8b5cf6'] },
      { method: 'fill', args: [] },
      { method: 'set strokeStyle', args: ['#5b21b6'] },
      { method: 'set lineWidth', args: [2] },
      { method: 'stroke', args: [] },
      { method: 'restore', args: [] },
    ]);
  });

  it('pinta triângulo escaleno com apex customizado', () => {
    const ctx = createMockContext();
    paintItem(ctx, {
      type: 'triangle',
      id: 'tr2',
      layerId: 'l1',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      variant: 'scalene',
      apex: 0.25,
      style: { fill: '#8b5cf6', stroke: null, strokeWidth: 0, opacity: 1 },
    });

    expect(ctx.calls).toContainEqual({ method: 'moveTo', args: [25, 0] });
    expect(ctx.calls).toContainEqual({ method: 'lineTo', args: [100, 50] });
    expect(ctx.calls).toContainEqual({ method: 'lineTo', args: [0, 50] });
  });
});

describe('pintura de polígono (polygon)', () => {
  it('pinta o polígono regular pelo contorno, do vértice do topo em sentido horário', () => {
    const ctx = createMockContext();
    const item: RenderablePolygon = {
      type: 'polygon',
      id: 'pg1',
      layerId: 'l1',
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      rotation: 0,
      sides: 6,
      style: { fill: '#14b8a6', stroke: '#0f766e', strokeWidth: 2, opacity: 1 },
    };
    paintItem(ctx, item);

    const path = ctx.calls.filter((c) => c.method === 'moveTo' || c.method === 'lineTo');
    expect(path.map((c) => c.method)).toEqual([
      'moveTo',
      'lineTo',
      'lineTo',
      'lineTo',
      'lineTo',
      'lineTo',
    ]);
    path.forEach((call, k) => {
      const angle = -Math.PI / 2 + (k * Math.PI) / 3;
      const [x, y] = call.args as [number, number];
      expect(x).toBeCloseTo(60 + 50 * Math.cos(angle), 9);
      expect(y).toBeCloseTo(70 + 50 * Math.sin(angle), 9);
    });
    expect(ctx.calls).toContainEqual({ method: 'closePath', args: [] });
    expect(ctx.calls).toContainEqual({ method: 'fill', args: [] });
    expect(ctx.calls).toContainEqual({ method: 'stroke', args: [] });
  });
});

describe('pintura de curva Bézier (bezier)', () => {
  const curve: RenderableBezier = {
    type: 'bezier',
    id: 'bz1',
    layerId: 'l1',
    start: { x: 0, y: 0 },
    control1: { x: 0, y: -40 },
    control2: { x: 100, y: -40 },
    end: { x: 100, y: 0 },
    style: { fill: null, stroke: '#7c3aed', strokeWidth: 3, opacity: 1 },
  };

  it('pinta o traço com bezierCurveTo, sem preenchimento', () => {
    const ctx = createMockContext();
    paintItem(ctx, curve);
    expect(ctx.calls).toEqual([
      { method: 'save', args: [] },
      { method: 'beginPath', args: [] },
      { method: 'moveTo', args: [0, 0] },
      { method: 'bezierCurveTo', args: [0, -40, 100, -40, 100, 0] },
      { method: 'set strokeStyle', args: ['#7c3aed'] },
      { method: 'set lineWidth', args: [3] },
      { method: 'stroke', args: [] },
      { method: 'restore', args: [] },
    ]);
  });

  it('aplica a opacidade e não pinta sem traço visível', () => {
    const translucent = createMockContext();
    paintItem(translucent, { ...curve, style: { ...curve.style, opacity: 0.5 } });
    expect(translucent.calls).toContainEqual({ method: 'set globalAlpha', args: [0.5] });

    const hidden = createMockContext();
    paintItem(hidden, { ...curve, style: { ...curve.style, stroke: null } });
    expect(hidden.calls).toEqual([]);
  });
});

describe('pintura do board (spec boards, §5.5)', () => {
  interface Call {
    readonly method: string;
    readonly args: readonly unknown[];
  }

  /** Contexto que registra chamadas e atribuições; mede 7 px por caractere. */
  function recording(): { context: CanvasRenderingContext2D; calls: Call[] } {
    const calls: Call[] = [];
    const state: Record<string, unknown> = {};
    const context = new Proxy(state, {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : (...args: unknown[]) => {
              calls.push({ method: key, args });
              return key === 'measureText' ? { width: String(args[0]).length * 7 } : undefined;
            },
      set: (target, key: string, value) => {
        target[key] = value;
        calls.push({ method: `set ${key}`, args: [value] });
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { context, calls };
  }

  const BOARD: RenderableBoard = {
    type: 'board',
    id: 'b',
    layerId: 'l',
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    fill: '#eff6ff',
    fillOpacity: 0.5,
    stroke: '#d4d4d8',
    title: 'Planejamento',
    titleColor: '#3f3f46',
  };
  const callsOf = (calls: readonly Call[], method: string) =>
    calls.filter((call) => call.method === method);

  it('pinta o fundo com a opacidade do fundo, a borda de 1 e o título, nessa ordem', () => {
    const { context, calls } = recording();

    paintItem(context, BOARD);

    const order = calls
      .filter((call) => ['fillRect', 'strokeRect', 'fillText'].includes(call.method))
      .map((call) => call.method);
    expect(order).toEqual(['fillRect', 'strokeRect', 'fillText']);
    expect(callsOf(calls, 'fillRect')[0]!.args).toEqual([100, 200, 300, 150]);
    expect(callsOf(calls, 'strokeRect')[0]!.args).toEqual([100, 200, 300, 150]);
    // O alfa vale só para o fundo: é posto antes do fillRect e desfeito antes da borda.
    const alphaAt = calls.findIndex((c) => c.method === 'set globalAlpha' && c.args[0] === 0.5);
    const fillAt = calls.findIndex((c) => c.method === 'fillRect');
    const strokeAt = calls.findIndex((c) => c.method === 'strokeRect');
    const restoreBetween = calls.slice(fillAt, strokeAt).some((c) => c.method === 'restore');
    expect(alphaAt).toBeGreaterThanOrEqual(0);
    expect(alphaAt).toBeLessThan(fillAt);
    expect(restoreBetween).toBe(true);
    expect(calls.find((c) => c.method === 'set lineWidth')!.args).toEqual([1]);
    expect(calls.find((c) => c.method === 'set strokeStyle')!.args).toEqual(['#d4d4d8']);
  });

  it('o título fica na faixa acima da borda, em 14 de fonte, na cor do item', () => {
    const { context, calls } = recording();

    paintItem(context, BOARD);

    expect(callsOf(calls, 'fillText')[0]!.args).toEqual(['Planejamento', 100, 188]);
    const font = calls.find((c) => c.method === 'set font')!.args[0] as string;
    expect(font).toContain('14px sans-serif');
    expect(calls.filter((c) => c.method === 'set fillStyle').map((c) => c.args[0])).toContain(
      '#3f3f46',
    );
  });

  it('o título que passa da largura do board termina em reticências', () => {
    const { context, calls } = recording();

    // 300 de largura a 7 px por caractere: cabem 42 caracteres.
    paintItem(context, { ...BOARD, title: 'x'.repeat(60) });

    const [drawn] = callsOf(calls, 'fillText')[0]!.args as [string];
    expect(drawn.endsWith('…')).toBe(true);
    expect(drawn.length * 7).toBeLessThanOrEqual(300);
    expect((drawn.length + 1) * 7).toBeGreaterThan(300);
  });

  it('o título que cabe é desenhado inteiro', () => {
    const { context, calls } = recording();

    paintItem(context, { ...BOARD, title: 'Curto' });

    expect(callsOf(calls, 'fillText')[0]!.args[0]).toBe('Curto');
  });

  it('se nem as reticências cabem, o título não é desenhado', () => {
    const { context, calls } = recording();

    paintItem(context, { ...BOARD, width: 4, title: 'Qualquer' });

    expect(callsOf(calls, 'fillText')).toEqual([]);
  });

  it('sem title no item, o pintor não desenha o título', () => {
    const { context, calls } = recording();
    paintItem(context, { ...BOARD, title: undefined });

    expect(callsOf(calls, 'fillText')).toEqual([]);
    expect(callsOf(calls, 'fillRect')).toHaveLength(1);
  });

  it('sem preenchimento ou sem borda, não pinta o que falta', () => {
    const noFill = recording();
    const noStroke = recording();

    paintItem(noFill.context, { ...BOARD, fill: null });
    paintItem(noStroke.context, { ...BOARD, stroke: null });

    expect(callsOf(noFill.calls, 'fillRect')).toEqual([]);
    expect(callsOf(noFill.calls, 'strokeRect')).toHaveLength(1);
    expect(callsOf(noStroke.calls, 'strokeRect')).toEqual([]);
    expect(callsOf(noStroke.calls, 'fillRect')).toHaveLength(1);
  });

  it('o fundo opaco não muda o alfa', () => {
    const { context, calls } = recording();

    paintItem(context, { ...BOARD, fillOpacity: 1 });

    expect(calls.filter((c) => c.method === 'set globalAlpha')).toEqual([]);
  });

  it('fillOpacity 0 não pinta o fundo', () => {
    const { context, calls } = recording();

    paintItem(context, { ...BOARD, fillOpacity: 0 });

    expect(callsOf(calls, 'fillRect')).toEqual([]);
  });

  it('o board não recorta: nenhum clip é chamado, e os filhos pintam por cima', () => {
    const { context, calls } = recording();
    const child: RenderableRectangle = {
      type: 'rectangle',
      id: 'c',
      layerId: 'l',
      x: 90,
      y: 190,
      width: 400,
      height: 300,
      rotation: 0,
      style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
    };

    paintScene(context, { items: [BOARD, child] });

    expect(callsOf(calls, 'clip')).toEqual([]);
    const rects = callsOf(calls, 'fillRect').map((call) => call.args[0]);
    expect(rects).toEqual([100, 90]);
  });
});
