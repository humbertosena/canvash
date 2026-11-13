import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BoardNode, ShapeNode } from '@canvash/core';
import type {
  OverlayGuide,
  OverlayHandle,
  OverlayHandleId,
  OverlayOptions,
  PaintOverlaysParams,
  SelectionOverlay,
} from './overlays.js';
import { computeSelectionOverlay, paintOverlays } from './overlays.js';

type IsAny<T> = 0 extends 1 & T ? true : false;
type HasAny<T, Depth extends unknown[] = []> = Depth['length'] extends 8
  ? false
  : IsAny<T> extends true
    ? true
    : T extends (...args: infer Args) => infer Return
      ? HasAny<Args, [...Depth, 0]> extends true
        ? true
        : HasAny<Return, [...Depth, 0]>
      : T extends object
        ? true extends { [Key in keyof T]: HasAny<T[Key], [...Depth, 0]> }[keyof T]
          ? true
          : false
        : false;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

describe('contrato de tipos de overlays', () => {
  it('nenhum tipo da API de overlays contém any', () => {
    expectTypeOf<HasAny<OverlayHandleId>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<OverlayHandle>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<OverlayGuide>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<SelectionOverlay>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<OverlayOptions>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<PaintOverlaysParams>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<typeof computeSelectionOverlay>>().toEqualTypeOf<false>();
    expectTypeOf<typeof paintOverlays>().toBeFunction();
  });

  it('todos os tipos são profundamente somente leitura', () => {
    expectTypeOf<OverlayHandle>().toEqualTypeOf<DeepReadonly<OverlayHandle>>();
    expectTypeOf<OverlayGuide>().toEqualTypeOf<DeepReadonly<OverlayGuide>>();
    expectTypeOf<SelectionOverlay>().toEqualTypeOf<DeepReadonly<SelectionOverlay>>();
    expectTypeOf<OverlayOptions>().toEqualTypeOf<DeepReadonly<OverlayOptions>>();
    expectTypeOf<PaintOverlaysParams>().toEqualTypeOf<DeepReadonly<PaintOverlaysParams>>();
  });
});

describe('computeSelectionOverlay', () => {
  it('converte bounds de mundo para tela e gera os 8 handles em CSS px', () => {
    const worldBounds = { x: 100, y: 50, width: 200, height: 100 };
    const viewport = { x: 20, y: 30, zoom: 2 };

    const overlay = computeSelectionOverlay(worldBounds, viewport);

    // screenX = 100 * 2 + 20 = 220
    // screenY = 50 * 2 + 30 = 130
    // screenWidth = 200 * 2 = 400
    // screenHeight = 100 * 2 = 200
    expect(overlay.bounds).toEqual({
      x: 220,
      y: 130,
      width: 400,
      height: 200,
    });

    expect(overlay.handles).toHaveLength(8);

    const handleMap = Object.fromEntries(overlay.handles.map((h) => [h.id, h]));

    // 4 cantos
    expect(handleMap['tl']).toEqual({ id: 'tl', x: 220, y: 130 });
    expect(handleMap['tr']).toEqual({ id: 'tr', x: 620, y: 130 });
    expect(handleMap['br']).toEqual({ id: 'br', x: 620, y: 330 });
    expect(handleMap['bl']).toEqual({ id: 'bl', x: 220, y: 330 });

    // 4 pontos médios
    expect(handleMap['tc']).toEqual({ id: 'tc', x: 420, y: 130 });
    expect(handleMap['rc']).toEqual({ id: 'rc', x: 620, y: 230 });
    expect(handleMap['bc']).toEqual({ id: 'bc', x: 420, y: 330 });
    expect(handleMap['lc']).toEqual({ id: 'lc', x: 220, y: 230 });

    expect(overlay.rotationHandle).toEqual({ id: 'rot', x: 420, y: 106 });
  });

  it('lida defensivamente com zoom zero ou negativo', () => {
    const worldBounds = { x: 10, y: 20, width: 30, height: 40 };
    const viewport = { x: 0, y: 0, zoom: 0 };

    const overlay = computeSelectionOverlay(worldBounds, viewport);
    // fallback para zoom 1
    expect(overlay.bounds).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

describe('paintOverlays', () => {
  it('não realiza nenhuma operação no canvas quando não há seleção nem marquee', () => {
    const calls: string[] = [];
    const fakeContext = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      strokeRect: () => calls.push('strokeRect'),
      fillRect: () => calls.push('fillRect'),
    } as unknown as CanvasRenderingContext2D;

    paintOverlays(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectionBounds: null,
      marquee: null,
    });

    expect(calls).toEqual([]);
  });

  it('desenha contorno de seleção e 8 handles com dimensões e cores configuradas', () => {
    const rectCalls: { type: 'stroke' | 'fill'; args: unknown[] }[] = [];
    const fakeContext = {
      save: () => {},
      restore: () => {},
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      strokeRect: (...args: unknown[]) => rectCalls.push({ type: 'stroke', args }),
      fillRect: (...args: unknown[]) => rectCalls.push({ type: 'fill', args }),
    } as unknown as CanvasRenderingContext2D;

    paintOverlays(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectionBounds: { x: 10, y: 20, width: 100, height: 60 },
      options: {
        selectionColor: '#00ff00',
        selectionLineWidth: 2,
        handleSize: 10,
        handleFill: '#ffffff',
        handleStroke: '#00ff00',
      },
    });

    // 1 contorno de seleção + 8 handles preenchidos + 8 contornos de handle
    expect(rectCalls.filter((c) => c.type === 'stroke')).toHaveLength(9);
    expect(rectCalls.filter((c) => c.type === 'fill')).toHaveLength(8);

    // Contorno principal
    expect(rectCalls[0]).toEqual({
      type: 'stroke',
      args: [10, 20, 100, 60],
    });

    // Primeiro handle (tl): centro em (10, 20) com size 10 => x = 10 - 5 = 5, y = 20 - 5 = 15
    expect(rectCalls[1]).toEqual({
      type: 'fill',
      args: [5, 15, 10, 10],
    });
  });

  it('desenha handle circular de rotação e haste conectora quando showRotationHandle está ativo', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const fakeContext = {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      beginPath: () => calls.push({ name: 'beginPath', args: [] }),
      moveTo: (x: number, y: number) => calls.push({ name: 'moveTo', args: [x, y] }),
      lineTo: (x: number, y: number) => calls.push({ name: 'lineTo', args: [x, y] }),
      arc: (...args: unknown[]) => calls.push({ name: 'arc', args }),
      fill: () => calls.push({ name: 'fill', args: [] }),
      stroke: () => calls.push({ name: 'stroke', args: [] }),
      strokeRect: () => {},
      fillRect: () => {},
    } as unknown as CanvasRenderingContext2D;

    paintOverlays(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectionBounds: { x: 100, y: 100, width: 200, height: 100 },
      options: { showRotationHandle: true },
    });

    // Deve ter chamado moveTo e lineTo para haste da rotação (do topo centro (200, 100) para (200, 76))
    const lineTo = calls.find((c) => c.name === 'lineTo');
    expect(lineTo).toBeDefined();
    expect(lineTo?.args).toEqual([200, 76]);

    // Deve ter desenhado o arco circular no centro do rotation handle
    const arc = calls.find((c) => c.name === 'arc');
    expect(arc).toBeDefined();
    expect((arc?.args as number[])[0]).toBe(200);
    expect((arc?.args as number[])[1]).toBe(76);
  });

  it('desenha retângulo de marquee com preenchimento e contorno tracejado', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    let currentLineDash: number[] = [];

    const fakeContext = {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      setLineDash: (dash: number[]) => {
        currentLineDash = dash;
        calls.push({ name: 'setLineDash', args: [dash] });
      },
      strokeRect: (...args: unknown[]) => calls.push({ name: 'strokeRect', args }),
      fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args }),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    paintOverlays(fakeContext, {
      viewport: { x: 50, y: 50, zoom: 1.5 },
      marquee: { x: 10, y: 20, width: 100, height: 80 },
    });

    // screenX = 10 * 1.5 + 50 = 65
    // screenY = 20 * 1.5 + 50 = 80
    // screenWidth = 100 * 1.5 = 150
    // screenHeight = 80 * 1.5 = 120
    const fillCall = calls.find((c) => c.name === 'fillRect');
    expect(fillCall).toEqual({
      name: 'fillRect',
      args: [65, 80, 150, 120],
    });

    const strokeCall = calls.find((c) => c.name === 'strokeRect');
    expect(strokeCall).toEqual({
      name: 'strokeRect',
      args: [65, 80, 150, 120],
    });

    // O traço de linha foi resetado após o desenho
    expect(currentLineDash).toEqual([]);
  });

  it('desenha seleção orientada com translate e rotate quando selectedNodes possui um nó rotacionado', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const fakeContext = {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      translate: (x: number, y: number) => calls.push({ name: 'translate', args: [x, y] }),
      rotate: (angle: number) => calls.push({ name: 'rotate', args: [angle] }),
      strokeRect: (...args: unknown[]) => calls.push({ name: 'strokeRect', args }),
      fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args }),
      beginPath: () => calls.push({ name: 'beginPath', args: [] }),
      moveTo: (...args: unknown[]) => calls.push({ name: 'moveTo', args }),
      lineTo: (...args: unknown[]) => calls.push({ name: 'lineTo', args }),
      arc: (...args: unknown[]) => calls.push({ name: 'arc', args }),
      stroke: () => calls.push({ name: 'stroke', args: [] }),
      fill: () => calls.push({ name: 'fill', args: [] }),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const rotatedNode: ShapeNode = {
      id: 'rect-rot',
      type: 'rectangle',
      visible: true,
      locked: false,
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 0.5,
      style: { fill: '#ff0000', stroke: '#000000', strokeWidth: 1, opacity: 1 },
    };

    paintOverlays(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodes: [rotatedNode],
      options: { showRotationHandle: true },
    });

    // Centro do nó: x + width/2 = 200, y + height/2 = 150
    const translateCall = calls.find((c) => c.name === 'translate');
    expect(translateCall).toEqual({ name: 'translate', args: [200, 150] });

    // Rotação aplicada no contexto do canvas
    const rotateCall = calls.find((c) => c.name === 'rotate');
    expect(rotateCall).toEqual({ name: 'rotate', args: [0.5] });

    // strokeRect centrado no nó (-halfW, -halfH, width, height)
    const strokeRectCall = calls.find((c) => c.name === 'strokeRect');
    expect(strokeRectCall).toEqual({ name: 'strokeRect', args: [-100, -50, 200, 100] });

    // Handle de rotação desenhado no eixo normal acima da borda superior (-halfH - 24 = -74)
    const arcCall = calls.find((c) => c.name === 'arc');
    expect(arcCall).toBeDefined();
    expect((arcCall?.args as number[])[0]).toBe(0);
    expect((arcCall?.args as number[])[1]).toBe(-74);
  });

  it('desenha seleção para nó do tipo line com alças nas pontas e haste de rotação normal', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const fakeContext = {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      strokeRect: (...args: unknown[]) => calls.push({ name: 'strokeRect', args }),
      fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args }),
      beginPath: () => calls.push({ name: 'beginPath', args: [] }),
      moveTo: (...args: unknown[]) => calls.push({ name: 'moveTo', args }),
      lineTo: (...args: unknown[]) => calls.push({ name: 'lineTo', args }),
      arc: (...args: unknown[]) => calls.push({ name: 'arc', args }),
      stroke: () => calls.push({ name: 'stroke', args: [] }),
      fill: () => calls.push({ name: 'fill', args: [] }),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const lineNode: ShapeNode = {
      id: 'line-1',
      type: 'line',
      visible: true,
      locked: false,
      start: { x: 10, y: 10 },
      end: { x: 70, y: 10 },
      style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
    };

    paintOverlays(fakeContext, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodes: [lineNode],
      options: { showRotationHandle: true },
    });

    const fillRectCalls = calls.filter((c) => c.name === 'fillRect');
    expect(fillRectCalls.length).toBe(2); // Início e fim da linha

    const arcCall = calls.find((c) => c.name === 'arc');
    expect(arcCall).toBeDefined(); // Handle de rotação normal à linha
  });

  it('desenha guias efêmeras de snapping (INPUT-09) com coordenadas e estilo configurados', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const fakeContext = {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      beginPath: () => calls.push({ name: 'beginPath', args: [] }),
      moveTo: (...args: unknown[]) => calls.push({ name: 'moveTo', args }),
      lineTo: (...args: unknown[]) => calls.push({ name: 'lineTo', args }),
      stroke: () => calls.push({ name: 'stroke', args: [] }),
      setLineDash: (...args: unknown[]) => calls.push({ name: 'setLineDash', args }),
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    paintOverlays(fakeContext, {
      viewport: { x: 10, y: 20, zoom: 2 },
      guides: [
        { axis: 'x', coordinate: 100, min: 50, max: 200 },
        { axis: 'y', coordinate: 150 },
      ],
      options: { guideColor: '#ef4444', guideLineWidth: 2 },
    });

    const moveToCalls = calls.filter((c) => c.name === 'moveTo');
    expect(moveToCalls).toContainEqual({ name: 'moveTo', args: [210, 120] });
    const lineToCalls = calls.filter((c) => c.name === 'lineTo');
    expect(lineToCalls).toContainEqual({ name: 'lineTo', args: [210, 420] });

    expect(moveToCalls).toContainEqual({ name: 'moveTo', args: [-10000, 320] });
    expect(lineToCalls).toContainEqual({ name: 'lineTo', args: [10000, 320] });
  });
});

describe('overlay da curva Bézier (Tarefa 112)', () => {
  it('desenha a caixa exata com 8 alças, as linhas-guia e as alças das pontas e dos controles', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const fakeContext = {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      strokeRect: (...args: unknown[]) => calls.push({ name: 'strokeRect', args }),
      fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args }),
      beginPath: () => calls.push({ name: 'beginPath', args: [] }),
      moveTo: (...args: unknown[]) => calls.push({ name: 'moveTo', args }),
      lineTo: (...args: unknown[]) => calls.push({ name: 'lineTo', args }),
      arc: (...args: unknown[]) => calls.push({ name: 'arc', args }),
      stroke: () => calls.push({ name: 'stroke', args: [] }),
      fill: () => calls.push({ name: 'fill', args: [] }),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const curve: ShapeNode = {
      id: 'bz',
      type: 'bezier',
      start: { x: 0, y: 0 },
      control1: { x: 0, y: -40 },
      control2: { x: 100, y: -40 },
      end: { x: 100, y: 0 },
      symmetric: true,
      visible: true,
      locked: false,
      style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
    };

    paintOverlays(fakeContext, {
      viewport: { x: 10, y: 50, zoom: 2 },
      selectedNodes: [curve],
      options: { showRotationHandle: true },
    });

    // Caixa exata (0, -30, 100, 30) em tela: x 10, y -10, 200 x 60
    expect(calls).toContainEqual({ name: 'strokeRect', args: [10, -10, 200, 60] });
    // 8 alças da caixa + início e fim
    expect(calls.filter((c) => c.name === 'fillRect')).toHaveLength(10);
    // Dois controles redondos + alça de rotação
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(3);
    // Linhas-guia início→control1 e fim→control2
    expect(calls).toContainEqual({ name: 'moveTo', args: [10, 50] });
    expect(calls).toContainEqual({ name: 'lineTo', args: [10, -30] });
    expect(calls).toContainEqual({ name: 'moveTo', args: [210, 50] });
    expect(calls).toContainEqual({ name: 'lineTo', args: [210, -30] });
  });
});

/** Contexto que registra toda atribuição a strokeStyle e fillStyle, na ordem em que ocorre. */
function recordStyles(): {
  readonly context: CanvasRenderingContext2D;
  readonly strokes: string[];
  readonly fills: string[];
} {
  const strokes: string[] = [];
  const fills: string[] = [];
  const noop = (): void => {};
  const context = {
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    arc: noop,
    setLineDash: noop,
    strokeRect: noop,
    fillRect: noop,
    set strokeStyle(value: string) {
      strokes.push(value);
    },
    set fillStyle(value: string) {
      fills.push(value);
    },
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
  return { context, strokes, fills };
}

describe('acento padrão de seleção (#6d5df6)', () => {
  it('pinta contorno e borda dos handles em violeta, com o preenchimento dos handles branco', () => {
    const { context, strokes, fills } = recordStyles();

    paintOverlays(context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectionBounds: { x: 10, y: 20, width: 100, height: 60 },
    });

    expect(strokes.length).toBeGreaterThan(0);
    expect(new Set(strokes)).toEqual(new Set(['#6d5df6']));
    expect(new Set(fills)).toEqual(new Set(['#ffffff']));
  });

  it('pinta o marquee com preenchimento translúcido violeta e contorno violeta', () => {
    const { context, strokes, fills } = recordStyles();

    paintOverlays(context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      marquee: { x: 10, y: 20, width: 100, height: 80 },
    });

    expect(fills).toEqual(['rgba(109, 93, 246, 0.08)']);
    expect(strokes).toEqual(['#6d5df6']);
  });

  it('mantém as guias de snap em magenta, distintas da seleção', () => {
    const { context, strokes } = recordStyles();

    paintOverlays(context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      guides: [{ axis: 'x', coordinate: 100 }],
    });

    expect(strokes).toEqual(['#ec4899']);
  });

  it('as opções explícitas continuam sobrepondo o acento padrão', () => {
    const { context, strokes, fills } = recordStyles();

    paintOverlays(context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectionBounds: { x: 10, y: 20, width: 100, height: 60 },
      marquee: { x: 0, y: 0, width: 10, height: 10 },
      options: {
        selectionColor: '#00ff00',
        handleStroke: '#0000ff',
        handleFill: '#eeeeee',
        marqueeFill: 'rgba(1, 2, 3, 0.5)',
        marqueeStroke: '#123456',
      },
    });

    expect(strokes).toContain('#00ff00');
    expect(strokes).toContain('#0000ff');
    expect(strokes).toContain('#123456');
    expect(strokes).not.toContain('#6d5df6');
    expect(fills).toContain('#eeeeee');
    expect(fills).toContain('rgba(1, 2, 3, 0.5)');
  });
});

describe('overlay do board (spec boards, §5.5)', () => {
  function recording() {
    const calls: { name: string; args: unknown[] }[] = [];
    const context = {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      translate: (...args: unknown[]) => calls.push({ name: 'translate', args }),
      rotate: (...args: unknown[]) => calls.push({ name: 'rotate', args }),
      strokeRect: (...args: unknown[]) => calls.push({ name: 'strokeRect', args }),
      fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args }),
      beginPath: () => calls.push({ name: 'beginPath', args: [] }),
      moveTo: (...args: unknown[]) => calls.push({ name: 'moveTo', args }),
      lineTo: (...args: unknown[]) => calls.push({ name: 'lineTo', args }),
      arc: (...args: unknown[]) => calls.push({ name: 'arc', args }),
      stroke: () => calls.push({ name: 'stroke', args: [] }),
      fill: () => calls.push({ name: 'fill', args: [] }),
      setLineDash: () => undefined,
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    return { calls, context };
  }

  const BOARD: BoardNode = {
    id: 'b',
    type: 'board',
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    title: 'Planejamento',
    style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
    childIds: [],
    visible: true,
    locked: false,
  };
  const OTHER: ShapeNode = {
    id: 'r',
    type: 'rectangle',
    x: 500,
    y: 200,
    width: 50,
    height: 50,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  it('US-BD.5: o contorno e as 8 alças ficam no retângulo sem a faixa do título, sem rotação', () => {
    const { calls, context } = recording();

    paintOverlays(context, {
      viewport: { x: 10, y: 20, zoom: 2 },
      selectedNodes: [BOARD],
      selectionBounds: { x: 99, y: 175, width: 302, height: 176 },
      options: { showRotationHandle: true, handleSize: 8 },
    });

    // Em tela: x = 100·2 + 10 = 210; y = 200·2 + 20 = 420; 600 × 300.
    const outline = calls.filter((c) => c.name === 'strokeRect')[0]!;
    expect(outline.args).toEqual([210, 420, 600, 300]);
    const handleCenters = calls
      .filter((c) => c.name === 'fillRect')
      .map((c) => [(c.args[0] as number) + 4, (c.args[1] as number) + 4]);
    expect(handleCenters).toHaveLength(8);
    expect(handleCenters).toEqual(
      expect.arrayContaining([
        [210, 420],
        [510, 420],
        [810, 420],
        [810, 570],
        [810, 720],
        [510, 720],
        [210, 720],
        [210, 570],
      ]),
    );
    expect(calls.filter((c) => c.name === 'arc')).toEqual([]);
    expect(calls.filter((c) => c.name === 'rotate')).toEqual([]);
  });

  it('numa seleção múltipla com board, só o contorno: nada de alças nem de rotação', () => {
    const { calls, context } = recording();

    paintOverlays(context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodes: [BOARD, OTHER],
      selectionBounds: { x: 99, y: 175, width: 460, height: 176 },
      options: { showRotationHandle: true },
    });

    expect(calls.filter((c) => c.name === 'strokeRect').length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((c) => c.name === 'fillRect')).toEqual([]);
    expect(calls.filter((c) => c.name === 'arc')).toEqual([]);
  });

  it('um grupo ou formas sem board seguem com alças e rotação', () => {
    const { calls, context } = recording();

    paintOverlays(context, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodes: [OTHER, { ...OTHER, id: 's' }],
      selectionBounds: { x: 500, y: 200, width: 50, height: 50 },
      options: { showRotationHandle: true },
    });

    expect(calls.filter((c) => c.name === 'fillRect')).toHaveLength(8);
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(1);
  });
});

describe('contorno do board de destino (spec boards, §5.2)', () => {
  function recording() {
    const calls: { name: string; args: unknown[]; lineWidth?: number; strokeStyle?: unknown }[] =
      [];
    const state = { lineWidth: 0, strokeStyle: '' as unknown, fillStyle: '' as unknown };
    const context = {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      strokeRect: (...args: unknown[]) =>
        calls.push({
          name: 'strokeRect',
          args,
          lineWidth: state.lineWidth,
          strokeStyle: state.strokeStyle,
        }),
      fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args }),
      setLineDash: () => undefined,
      get strokeStyle() {
        return state.strokeStyle;
      },
      set strokeStyle(value: unknown) {
        state.strokeStyle = value;
      },
      get lineWidth() {
        return state.lineWidth;
      },
      set lineWidth(value: number) {
        state.lineWidth = value;
      },
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    return { calls, context };
  }

  it('contorna o retângulo do board com 2 px na cor de destaque, mesmo sem seleção', () => {
    const { calls, context } = recording();

    paintOverlays(context, {
      viewport: { x: 10, y: 20, zoom: 2 },
      dropTarget: { x: 100, y: 200, width: 300, height: 150 },
      options: { selectionColor: '#123456' },
    });

    const outline = calls.find((call) => call.name === 'strokeRect');
    expect(outline).toMatchObject({
      args: [210, 420, 600, 300],
      lineWidth: 2,
      strokeStyle: '#123456',
    });
  });

  it('sem alvo, não pinta nada', () => {
    const { calls, context } = recording();

    paintOverlays(context, { viewport: { x: 0, y: 0, zoom: 1 }, dropTarget: null });

    expect(calls).toEqual([]);
  });
});
