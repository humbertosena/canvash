import {
  createCanvasSection,
  type BezierNode,
  type CircleNode,
  type LineNode,
  type RectangleNode,
  type ShapeNode,
  type TextNode,
} from '@canvash/core';
import { describe, expect, it } from 'vitest';
import type { ResizeHandleId } from './resize.js';
import {
  computeAggregateBounds,
  computeUniformScaleFactor,
  executeMultiResize,
  findMultiResizeHandleAtPoint,
  getMultiResizeHandles,
  getMultiResizeOppositeAnchor,
  scaleMultipleShapes,
  scaleShapeUniform,
} from './resize-multiple.js';

describe('resize-multiple.ts - Escala uniforme de seleção múltipla (Tarefa 35, INPUT-04)', () => {
  const rect1: RectangleNode = {
    id: 'r1',
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#2563eb', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  const rectRotated: RectangleNode = {
    id: 'r2',
    type: 'rectangle',
    x: 300,
    y: 100,
    width: 100,
    height: 100,
    rotation: Math.PI / 4, // 45 graus
    visible: true,
    locked: false,
    style: { fill: '#16a34a', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  const line: LineNode = {
    id: 'l1',
    type: 'line',
    start: { x: 50, y: 50 },
    end: { x: 150, y: 50 },
    visible: true,
    locked: false,
    style: { stroke: '#dc2626', strokeWidth: 2, opacity: 1 },
  };

  it('calcula bounding box agregada corretamente e lida com lista vazia', () => {
    expect(computeAggregateBounds([])).toBeNull();

    const bounds = computeAggregateBounds([rect1]);
    expect(bounds).toEqual({ x: 100, y: 100, width: 100, height: 100 });

    const multiBounds = computeAggregateBounds([rect1, line]);
    expect(multiBounds).not.toBeNull();
    expect(multiBounds?.x).toBe(50);
    expect(multiBounds?.y).toBe(50);
    expect(multiBounds?.width).toBe(150); // 200 - 50
    expect(multiBounds?.height).toBe(150); // 200 - 50
  });

  it('fornece e localiza os 8 handles ao redor da bounding box agregada', () => {
    const bounds = { x: 100, y: 100, width: 200, height: 100 };
    const handles = getMultiResizeHandles(bounds);
    expect(handles).toHaveLength(8);

    expect(findMultiResizeHandleAtPoint(bounds, { x: 102, y: 98 }, 5)).toBe('nw');
    expect(findMultiResizeHandleAtPoint(bounds, { x: 300, y: 200 }, 5)).toBe('se');
    expect(findMultiResizeHandleAtPoint(bounds, { x: 200, y: 150 }, 5)).toBeNull();
  });

  it('determina âncora oposta fixa para cada handle', () => {
    const bounds = { x: 100, y: 100, width: 200, height: 100 };
    expect(getMultiResizeOppositeAnchor(bounds, 'se')).toEqual({ x: 100, y: 100 });
    expect(getMultiResizeOppositeAnchor(bounds, 'nw')).toEqual({ x: 300, y: 200 });
    expect(getMultiResizeOppositeAnchor(bounds, 'ne')).toEqual({ x: 100, y: 200 });
    expect(getMultiResizeOppositeAnchor(bounds, 'sw')).toEqual({ x: 300, y: 100 });
    expect(getMultiResizeOppositeAnchor(bounds, 'e')).toEqual({ x: 100, y: 150 });
    expect(getMultiResizeOppositeAnchor(bounds, 'w')).toEqual({ x: 300, y: 150 });
    expect(getMultiResizeOppositeAnchor(bounds, 's')).toEqual({ x: 200, y: 100 });
    expect(getMultiResizeOppositeAnchor(bounds, 'n')).toEqual({ x: 200, y: 200 });
  });

  it('calcula fator de escala uniforme sem flip', () => {
    const bounds = { x: 100, y: 100, width: 200, height: 100 };
    // Arrasta se para (500, 300) -> sx = 400/200 = 2, sy = 200/100 = 2
    const scale = computeUniformScaleFactor(bounds, 'se', { x: 500, y: 300 }, [rect1]);
    expect(scale).toBe(2);

    // Arrasta para trás além da âncora: respeita limite mínimo sem flip
    const flippedScale = computeUniformScaleFactor(bounds, 'se', { x: 50, y: 50 }, [rect1]);
    expect(flippedScale).toBeGreaterThanOrEqual(1 / 100);
  });

  it('escala forma individual mantendo rotação nativa sem introduzir skew', () => {
    const anchor = { x: 0, y: 0 };
    const scaledRot = scaleShapeUniform(rectRotated, anchor, 2) as RectangleNode;

    // Rotação estritamente preservada
    expect(scaledRot.rotation).toBe(Math.PI / 4);
    expect(scaledRot.width).toBe(200);
    expect(scaledRot.height).toBe(200);

    // Centro original era (350, 150) -> com escala 2 em torno de (0,0), novo centro é (700, 300)
    const newCenterX = scaledRot.x + scaledRot.width / 2;
    const newCenterY = scaledRot.y + scaledRot.height / 2;
    expect(newCenterX).toBeCloseTo(700, 4);
    expect(newCenterY).toBeCloseTo(300, 4);
  });

  it('escala seleção múltipla preservando distâncias relativas entre os nós (INPUT-04)', () => {
    const rA: RectangleNode = {
      ...rect1,
      id: 'a',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
    };
    const rB: RectangleNode = {
      ...rect1,
      id: 'b',
      x: 250,
      y: 100,
      width: 50,
      height: 50,
    };

    const initialDistance = rB.x - rA.x; // 150
    const bounds = computeAggregateBounds([rA, rB])!;

    // Escala por 2x usando handle se
    const anchor = getMultiResizeOppositeAnchor(bounds, 'se'); // (100, 100)
    expect(anchor).toEqual({ x: 100, y: 100 });
    const scaled = scaleMultipleShapes([rA, rB], bounds, 'se', {
      x: bounds.x + bounds.width * 2,
      y: bounds.y + bounds.height * 2,
    });

    const sA = scaled[0] as RectangleNode;
    const sB = scaled[1] as RectangleNode;

    const newDistance = sB.x - sA.x;
    expect(newDistance).toBeCloseTo(initialDistance * 2, 4); // 300
    expect(sA.width).toBe(100);
    expect(sB.width).toBe(100);
  });

  it('executa transação atômica no canvas com commit único e suporta undo completo (INPUT-04)', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'box-a',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'box-b',
        type: 'rectangle',
        x: 300,
        y: 100,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });

    const revBefore = section.getSnapshot().revision;
    const nodeA = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
    const nodeB = section.getSnapshot().document.nodes['box-b'] as RectangleNode;

    const bounds = computeAggregateBounds([nodeA, nodeB])!;
    const scaledNodes = scaleMultipleShapes([nodeA, nodeB], bounds, 'se', {
      x: bounds.x + bounds.width * 1.5,
      y: bounds.y + bounds.height * 1.5,
    });

    executeMultiResize(section, scaledNodes);

    // Exatamente 1 commit
    expect(section.getSnapshot().revision).toBe(revBefore + 1);
    const updatedA = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
    const updatedB = section.getSnapshot().document.nodes['box-b'] as RectangleNode;
    expect(updatedA.width).toBeCloseTo(150, 4);
    expect(updatedB.width).toBeCloseTo(150, 4);

    // Desfaz via undo em 1 único passo
    const undoRes = section.undo();
    expect(undoRes.ok).toBe(true);

    const restoredA = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
    const restoredB = section.getSnapshot().document.nodes['box-b'] as RectangleNode;
    expect(restoredA.width).toBe(100);
    expect(restoredB.width).toBe(100);
    expect(restoredA.x).toBe(100);
    expect(restoredB.x).toBe(300);
  });

  it('redimensiona linha junto com retângulo preservando proporções', () => {
    const rect: RectangleNode = {
      id: 'rect',
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#123456', stroke: null, strokeWidth: 0, opacity: 1 },
    };
    const line: LineNode = {
      id: 'line',
      type: 'line',
      start: { x: 250, y: 150 },
      end: { x: 350, y: 150 },
      visible: true,
      locked: false,
      style: { stroke: '#654321', strokeWidth: 2, opacity: 1 },
    };

    const bounds = computeAggregateBounds([rect, line])!;
    expect(bounds).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 100,
    });

    const scaled = scaleMultipleShapes([rect, line], bounds, 'se', {
      x: bounds.x + bounds.width * 2,
      y: bounds.y + bounds.height * 2,
    });

    const scaledLine = scaled[1] as LineNode;
    expect(scaledLine.start.x).toBeGreaterThan(250);
    expect(scaledLine.end.x - scaledLine.start.x).toBeCloseTo(200, 4); // 100 * 2
  });

  it('suporta todas as direções de handles (nw, ne, sw, n, s, e, w) e trava no mínimo sem flip', () => {
    const r1: RectangleNode = {
      id: 'r1',
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#111111', stroke: null, strokeWidth: 0, opacity: 1 },
    };
    const r2: RectangleNode = {
      id: 'r2',
      type: 'rectangle',
      x: 250,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#222222', stroke: null, strokeWidth: 0, opacity: 1 },
    };

    const bounds = computeAggregateBounds([r1, r2])!;
    const handles = getMultiResizeHandles(bounds);
    expect(handles.length).toBe(8);

    // Hit test em cada handle
    for (const h of handles) {
      const hit = findMultiResizeHandleAtPoint(bounds, { x: h.x, y: h.y }, 4);
      expect(hit).toBe(h.id);
    }
    // Fora de qualquer handle
    expect(findMultiResizeHandleAtPoint(bounds, { x: 999, y: 999 }, 4)).toBeNull();

    // Testa cada direção de handle
    const directions: ResizeHandleId[] = ['nw', 'ne', 'sw', 'n', 's', 'e', 'w'];
    for (const dir of directions) {
      const anchor = getMultiResizeOppositeAnchor(bounds, dir);
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.y)).toBe(true);

      const scaled = scaleMultipleShapes([r1, r2], bounds, dir, {
        x: bounds.x + 50,
        y: bounds.y + 50,
      });
      expect(scaled.length).toBe(2);
    }

    // Cruza a âncora para tentar flip negativo: deve travar em minSafeScale sem inverter
    const flipped = scaleMultipleShapes([r1, r2], bounds, 'se', {
      x: bounds.x - 500,
      y: bounds.y - 500,
    });
    const s1 = flipped[0] as RectangleNode;
    expect(s1.width).toBeGreaterThanOrEqual(1);
    expect(s1.height).toBeGreaterThanOrEqual(1);
  });

  it('retorna null para bounds de lista vazia', () => {
    expect(computeAggregateBounds([])).toBeNull();
  });

  it('escala uniforme de seleção múltipla contendo texto ajusta a caixa e o tamanho da fonte (Tarefa 44)', () => {
    const textNode: TextNode = {
      id: 'txt-multi',
      type: 'text',
      x: 100,
      y: 100,
      width: 200,
      height: 50,
      rotation: 0,
      text: 'Texto em seleção múltipla',
      fontSize: 20,
      fontSizeMode: 'auto',
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      textAlign: 'left',
      lineHeight: 1.25,
      visible: true,
      locked: false,
      style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
    };

    const otherRect: RectangleNode = {
      id: 'rect-other',
      type: 'rectangle',
      x: 350,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
    };

    const bounds = computeAggregateBounds([textNode, otherRect])!;
    expect(bounds).toEqual({ x: 100, y: 100, width: 350, height: 100 });

    // Escala dobrando via handle 'se' (de x=450, y=200 para x=800, y=300)
    const scaled = scaleMultipleShapes([textNode, otherRect], bounds, 'se', {
      x: 800,
      y: 300,
    });

    const scaledText = scaled.find((n) => n.id === 'txt-multi') as TextNode;
    expect(scaledText).toBeDefined();
    expect(scaledText.fontSize).toBe(40); // 20 * 2
    expect(scaledText.width).toBe(400); // 200 * 2
    expect(scaledText.height).toBe(100); // 50 * 2
  });
});

describe('seleção múltipla com as figuras do Épico 01', () => {
  const style = { fill: '#2563eb', stroke: '#1e40af', strokeWidth: 2, opacity: 1 };
  const base = { rotation: 0, visible: true, locked: false, style };
  const height = (60 * Math.sqrt(3)) / 2;
  const figures: readonly ShapeNode[] = [
    { ...base, id: 'sq', type: 'square', x: 0, y: 0, width: 40, height: 40 },
    { ...base, id: 'ci', type: 'circle', x: 60, y: 0, width: 40, height: 40 },
    { ...base, id: 'di', type: 'diamond', x: 120, y: 0, width: 60, height: 40 },
    {
      ...base,
      id: 'tr',
      type: 'triangle',
      variant: 'equilateral',
      apex: 0.5,
      x: 200,
      y: 0,
      width: 60,
      height,
    },
    { ...base, id: 'pg', type: 'polygon', sides: 6, x: 280, y: 0, width: 50, height: 50 },
  ];

  it('computeAggregateBounds envolve quadrado, círculo, losango, triângulo e polígono', () => {
    expect(computeAggregateBounds(figures)).toEqual({
      x: 0,
      y: 0,
      width: 330,
      height: expect.closeTo(height, 9),
    });
    expect(
      computeAggregateBounds([
        figures[0]!,
        { ...(figures[1] as CircleNode), rotation: Math.PI / 4 },
      ]),
    ).toEqual({
      x: 0,
      y: expect.closeTo(20 - 20 * Math.SQRT2, 9),
      width: expect.closeTo(80 + 20 * Math.SQRT2, 9),
      height: expect.closeTo(40 * Math.SQRT2, 9),
    });
  });

  it('escala as figuras uniformemente mantendo a proporção travada de cada uma', () => {
    const bounds = computeAggregateBounds(figures)!;
    const scaled = scaleMultipleShapes(figures, bounds, 'se', { x: 660, y: 2 * height });
    for (const [index, node] of scaled.entries()) {
      const before = figures[index]!;
      if (!('width' in node)) continue;
      if (!('width' in before)) continue;
      expect(node.width).toBeCloseTo(before.width * 2, 9);
      expect(node.height).toBeCloseTo(before.height * 2, 9);
      expect(node.x).toBeCloseTo(before.x * 2, 9);
    }
  });

  it('executeMultiResize grava o novo tamanho no canvas sem violar as invariantes', () => {
    const section = createCanvasSection();
    for (const figure of figures) section.dispatch({ type: 'shape.create', shape: figure });
    const bounds = computeAggregateBounds(figures)!;

    executeMultiResize(
      section,
      scaleMultipleShapes(figures, bounds, 'se', { x: 495, y: 1.5 * height }),
    );

    const nodes = section.getSnapshot().document.nodes;
    expect(nodes['sq']).toMatchObject({ width: 60, height: 60 });
    expect(nodes['ci']).toMatchObject({ width: 60, height: 60 });
    expect(nodes['di']).toMatchObject({ width: 90, height: 60 });
    expect(nodes['tr']).toMatchObject({ variant: 'equilateral', width: 90 });
    expect(nodes['pg']).toMatchObject({ sides: 6, width: 75, height: 75 });
  });
});

describe('seleção múltipla com curva Bézier (Tarefa 112)', () => {
  const curve: BezierNode = {
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

  it('usa a caixa exata da curva e escala os quatro pontos', () => {
    expect(computeAggregateBounds([curve])).toEqual({ x: 0, y: -30, width: 100, height: 30 });
    expect(scaleShapeUniform(curve, { x: 0, y: 0 }, 2)).toMatchObject({
      start: { x: 0, y: 0 },
      control1: { x: 0, y: -80 },
      control2: { x: 200, y: -80 },
      end: { x: 200, y: 0 },
    });
  });

  it('não deixa a corda encolher abaixo de uma unidade', () => {
    const bounds = computeAggregateBounds([curve])!;
    expect(computeUniformScaleFactor(bounds, 'e', { x: -500, y: 0 }, [curve])).toBeCloseTo(0.01, 9);
  });
});
