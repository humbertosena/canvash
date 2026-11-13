import {
  createCanvasSection,
  type BezierNode,
  type EllipseNode,
  type LineNode,
  type PolygonNode,
  type RectangleNode,
  type ShapeNode,
} from '@canvash/core';
import { describe, expect, it } from 'vitest';
import {
  calculateRotationAngle,
  executeRotation,
  getRotationCenter,
  getRotationHandlePoint,
  isRotationHandleHit,
  rotateShapes,
} from './rotate.js';

describe('rotate.ts - Rotação de seleção única e múltipla (Tarefa 36 - INPUT-04)', () => {
  const rectA: RectangleNode = {
    id: 'rect-a',
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#123456', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  const rectB: RectangleNode = {
    id: 'rect-b',
    type: 'rectangle',
    x: 400,
    y: 100,
    width: 100,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#654321', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  const lineA: LineNode = {
    id: 'line-a',
    type: 'line',
    start: { x: 100, y: 100 },
    end: { x: 300, y: 100 },
    visible: true,
    locked: false,
    style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
  };

  describe('getRotationCenter', () => {
    it('calcula o centro de retângulo único', () => {
      const center = getRotationCenter([rectA]);
      expect(center).toEqual({ x: 200, y: 150 });
    });

    it('calcula o ponto médio de linha única', () => {
      const center = getRotationCenter([lineA]);
      expect(center).toEqual({ x: 200, y: 100 });
    });

    it('calcula o centro da bounding box agregada para múltiplos nós', () => {
      const center = getRotationCenter([rectA, rectB]);
      // bounds: x: 100..500 (w: 400), y: 100..200 (h: 100) -> center: (300, 150)
      expect(center).toEqual({ x: 300, y: 150 });
    });

    it('retorna null para lista vazia', () => {
      expect(getRotationCenter([])).toBeNull();
    });
  });

  describe('getRotationHandlePoint', () => {
    it('retorna ponto acima do topo para retângulo não rotacionado', () => {
      const handle = getRotationHandlePoint([rectA], 1);
      // center: (200, 150), top: 100, handle: 100 - 24 = 76
      expect(handle).toEqual({ x: 200, y: 76 });
    });

    it('considera zoom do viewport no cálculo da distância no mundo', () => {
      const handle = getRotationHandlePoint([rectA], 2);
      // offsetWorld = 24 / 2 = 12 -> 100 - 12 = 88
      expect(handle).toEqual({ x: 200, y: 88 });
    });

    it('rotaciona a posição do handle junto com a forma rotacionada', () => {
      const turnedRect: RectangleNode = {
        ...rectA,
        rotation: Math.PI / 2, // 90 graus no sentido horário
      };
      const handle = getRotationHandlePoint([turnedRect], 1)!;
      // Original: (200, 76), Center: (200, 150) -> vetor (0, -74) rotacionado 90° -> (74, 0)
      // New pos: (274, 150)
      expect(handle.x).toBeCloseTo(274, 4);
      expect(handle.y).toBeCloseTo(150, 4);
    });

    it('calcula handle perpendicular ao ponto médio para linha única', () => {
      const handle = getRotationHandlePoint([lineA], 1);
      expect(handle).not.toBeNull();
      expect(handle!.x).toBeCloseTo(200, 4);
      expect(handle!.y).toBeCloseTo(100 - 24, 4);
    });

    it('retorna null para lista vazia', () => {
      expect(getRotationHandlePoint([], 1)).toBeNull();
    });
  });

  describe('isRotationHandleHit', () => {
    it('detecta colisão dentro da tolerância e rejeita fora dela', () => {
      const handle = { x: 200, y: 76 };
      expect(isRotationHandleHit(handle, { x: 202, y: 75 }, 8)).toBe(true);
      expect(isRotationHandleHit(handle, { x: 215, y: 76 }, 8)).toBe(false);
    });
  });

  describe('calculateRotationAngle com e sem Shift', () => {
    const center = { x: 200, y: 150 };
    const startPoint = { x: 200, y: 50 }; // diretamente acima do centro (-90 graus = -pi/2)

    it('calcula rotação suave quando shiftKey é false', () => {
      // Move 45 graus para a direita
      const currentPoint = { x: 300, y: 50 };
      const delta = calculateRotationAngle(center, startPoint, currentPoint, false);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeCloseTo(Math.PI / 4, 1);
    });

    it('limita a rotação a passos de 15° (π/12 rad) quando Shift está ativo', () => {
      const STEP_15_DEG = Math.PI / 12;

      // Ângulo de ~22 graus -> deve quantizar para 15 graus
      const currentPoint1 = {
        x: center.x + 100 * Math.sin((22 * Math.PI) / 180),
        y: center.y - 100 * Math.cos((22 * Math.PI) / 180),
      };
      const delta1 = calculateRotationAngle(center, startPoint, currentPoint1, true);
      expect(delta1).toBeCloseTo(STEP_15_DEG, 5); // 15°

      // Ângulo de ~24 graus -> deve quantizar para 30 graus (2 * 15°)
      const currentPoint2 = {
        x: center.x + 100 * Math.sin((24 * Math.PI) / 180),
        y: center.y - 100 * Math.cos((24 * Math.PI) / 180),
      };
      const delta2 = calculateRotationAngle(center, startPoint, currentPoint2, true);
      expect(delta2).toBeCloseTo(2 * STEP_15_DEG, 5); // 30°
    });
  });

  describe('rotateShapes', () => {
    it('rotaciona forma única ao redor de seu próprio centro mantendo dimensões e posição', () => {
      const center = getRotationCenter([rectA])!;
      const rotated = rotateShapes([rectA], center, Math.PI / 4);

      expect(rotated).toHaveLength(1);
      const res = rotated[0] as RectangleNode;
      expect(res.x).toBe(100);
      expect(res.y).toBe(100);
      expect(res.width).toBe(200);
      expect(res.height).toBe(100);
      expect(res.rotation).toBeCloseTo(Math.PI / 4, 5);
    });

    it('rotaciona linha ao redor do seu centro', () => {
      const center = getRotationCenter([lineA])!;
      const rotated = rotateShapes([lineA], center, Math.PI / 2);

      const res = rotated[0] as LineNode;
      // Linha horizontal de (100, 100) a (300, 100) vira vertical de (200, 0) a (200, 200)
      expect(res.start.x).toBeCloseTo(200, 4);
      expect(res.start.y).toBeCloseTo(0, 4);
      expect(res.end.x).toBeCloseTo(200, 4);
      expect(res.end.y).toBeCloseTo(200, 4);
    });

    it('rotação múltipla preserva posições relativas e distâncias entre centros (INPUT-04)', () => {
      const center = getRotationCenter([rectA, rectB])!; // (300, 150)
      const distBefore = Math.hypot(
        rectB.x + rectB.width / 2 - (rectA.x + rectA.width / 2),
        rectB.y + rectB.height / 2 - (rectA.y + rectA.height / 2),
      ); // 450 - 200 = 250

      const rotated = rotateShapes([rectA, rectB], center, Math.PI / 2); // 90°
      expect(rotated).toHaveLength(2);

      const rA = rotated[0] as RectangleNode;
      const rB = rotated[1] as RectangleNode;

      const distAfter = Math.hypot(
        rB.x + rB.width / 2 - (rA.x + rA.width / 2),
        rB.y + rB.height / 2 - (rA.y + rA.height / 2),
      );

      // Distância relativa entre formas rigorosamente preservada
      expect(distAfter).toBeCloseTo(distBefore, 5);
      // Ambas as formas ganham 90 graus na rotação própria
      expect(rA.rotation).toBeCloseTo(Math.PI / 2, 5);
      expect(rB.rotation).toBeCloseTo(Math.PI / 2, 5);
    });

    it('rotaciona elipse corretamente', () => {
      const ellipse: EllipseNode = {
        id: 'el',
        type: 'ellipse',
        x: 50,
        y: 50,
        width: 100,
        height: 60,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#111111', stroke: null, strokeWidth: 0, opacity: 1 },
      };
      const center = getRotationCenter([ellipse])!;
      const rotated = rotateShapes([ellipse], center, 0.5);
      const res = rotated[0] as EllipseNode;
      expect(res.rotation).toBeCloseTo(0.5, 5);
    });
  });

  describe('executeRotation', () => {
    it('comita em 1 transação atômica única no canvas e desfaz via undo em 1 passo (INPUT-04)', () => {
      const section = createCanvasSection();
      section.dispatch({ type: 'shape.create', shape: rectA });
      section.dispatch({ type: 'shape.create', shape: rectB });

      const revBefore = section.getSnapshot().revision;
      const nodes = [
        section.getSnapshot().document.nodes['rect-a'] as ShapeNode,
        section.getSnapshot().document.nodes['rect-b'] as ShapeNode,
      ];

      const center = getRotationCenter(nodes)!;
      const rotated = rotateShapes(nodes, center, Math.PI / 2);

      executeRotation(section, rotated);

      // Exatamente 1 commit
      expect(section.getSnapshot().revision).toBe(revBefore + 1);

      const updatedA = section.getSnapshot().document.nodes['rect-a'] as RectangleNode;
      const updatedB = section.getSnapshot().document.nodes['rect-b'] as RectangleNode;
      expect(updatedA.rotation).toBeCloseTo(Math.PI / 2, 5);
      expect(updatedB.rotation).toBeCloseTo(Math.PI / 2, 5);

      // Desfaz em 1 passo único via undo (INPUT-04)
      const undoRes = section.undo();
      expect(undoRes.ok).toBe(true);

      const restoredA = section.getSnapshot().document.nodes['rect-a'] as RectangleNode;
      const restoredB = section.getSnapshot().document.nodes['rect-b'] as RectangleNode;
      expect(restoredA.rotation).toBe(0);
      expect(restoredB.rotation).toBe(0);
      expect(restoredA.x).toBe(100);
      expect(restoredB.x).toBe(400);
    });
  });
});

describe('rotação de polígono (Tarefa 108)', () => {
  const polygon: PolygonNode = {
    id: 'pg',
    type: 'polygon',
    x: 100,
    y: 100,
    width: 80,
    height: 80,
    rotation: 0,
    sides: 5,
    visible: true,
    locked: false,
    style: { fill: '#14b8a6', stroke: '#0f766e', strokeWidth: 2, opacity: 1 },
  };

  it('gira o polígono em torno do centro da caixa, sem mover a caixa', () => {
    const center = getRotationCenter([polygon]);
    expect(center).toEqual({ x: 140, y: 140 });
    expect(getRotationHandlePoint([{ ...polygon, rotation: Math.PI / 2 }], 1)).toMatchObject({
      x: expect.closeTo(140 + 40 + 24, 6),
      y: expect.closeTo(140, 6),
    });

    const [rotated] = rotateShapes([polygon], center!, Math.PI / 6);
    expect(rotated).toMatchObject({ x: 100, y: 100, width: 80, height: 80, sides: 5 });
    expect((rotated as PolygonNode).rotation).toBeCloseTo(Math.PI / 6, 9);
  });

  it('em seleção múltipla, gira o polígono em torno do centro comum', () => {
    const other: PolygonNode = { ...polygon, id: 'pg-2', x: 300 };
    const center = getRotationCenter([polygon, other])!;
    const rotated = rotateShapes([polygon, other], center, Math.PI);
    expect(rotated[0]).toMatchObject({ x: expect.closeTo(300, 6), y: expect.closeTo(100, 6) });
    expect(rotated[1]).toMatchObject({ x: expect.closeTo(100, 6), y: expect.closeTo(100, 6) });
  });

  it('executeRotation grava a rotação do polígono no canvas', () => {
    const section = createCanvasSection();
    section.dispatch({ type: 'shape.create', shape: polygon });
    executeRotation(section, rotateShapes([polygon], { x: 140, y: 140 }, Math.PI / 4));
    const node = section.getSnapshot().document.nodes['pg'];
    expect(node).toMatchObject({ type: 'polygon', sides: 5, x: 100, y: 100 });
    expect((node as PolygonNode).rotation).toBeCloseTo(Math.PI / 4, 9);
  });
});

describe('rotação de curva Bézier (Tarefa 112)', () => {
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
  const rect: RectangleNode = {
    id: 'r',
    type: 'rectangle',
    x: 200,
    y: -30,
    width: 50,
    height: 30,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
  };

  function expectPoint(actual: { x: number; y: number }, x: number, y: number) {
    expect(actual.x).toBeCloseTo(x, 9);
    expect(actual.y).toBeCloseTo(y, 9);
  }

  it('gira os quatro pontos em torno do centro da caixa exata', () => {
    const center = getRotationCenter([curve])!;
    expect(center).toEqual({ x: 50, y: -15 });
    expect(getRotationHandlePoint([curve], 1)).toEqual({ x: 50, y: -30 - 24 });

    const [rotated] = rotateShapes([curve], center, Math.PI) as BezierNode[];
    expectPoint(rotated!.start, 100, -30);
    expectPoint(rotated!.control1, 100, 10);
    expectPoint(rotated!.control2, 0, 10);
    expectPoint(rotated!.end, 0, -30);
    expect(rotated!.symmetric).toBe(true);
  });

  it('em seleção múltipla gira a curva em torno do centro comum e grava os quatro pontos', () => {
    const center = getRotationCenter([curve, rect])!;
    expect(center).toEqual({ x: 125, y: -15 });
    const rotated = rotateShapes([curve, rect], center, Math.PI);
    expectPoint((rotated[0] as BezierNode).start, 250, -30);

    const section = createCanvasSection();
    section.dispatch({ type: 'shape.create', shape: curve });
    executeRotation(section, rotateShapes([curve], getRotationCenter([curve])!, Math.PI / 2));
    const node = section.getSnapshot().document.nodes['bz'] as BezierNode;
    // +90° em torno de (50, -15): (dx, dy) vira (-dy, dx)
    expectPoint(node.start, 35, -65);
    expectPoint(node.end, 35, 35);
    expect(section.undo().ok).toBe(true);
    expect(section.getSnapshot().document.nodes['bz']).toMatchObject({ start: { x: 0, y: 0 } });
  });
});
