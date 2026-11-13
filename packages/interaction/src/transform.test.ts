import { describe, expect, it } from 'vitest';
import type {
  ArrowNode,
  BezierNode,
  EllipseNode,
  LineNode,
  PolygonNode,
  RectangleNode,
  ShapeNode,
} from '@canvash/core';
import { buildMovePatch, toPreviewShape, translateShape } from './transform.js';

describe('transform module', () => {
  const rect: RectangleNode = {
    id: 'r1',
    type: 'rectangle',
    x: 50,
    y: 60,
    width: 100,
    height: 80,
    rotation: 0.5,
    visible: true,
    locked: false,
    style: {
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 2,
      opacity: 1,
    },
  };

  const ellipse: EllipseNode = {
    id: 'e1',
    type: 'ellipse',
    x: 200,
    y: 150,
    width: 60,
    height: 40,
    rotation: 0,
    visible: true,
    locked: false,
    style: {
      fill: '#00ff00',
      stroke: null,
      strokeWidth: 0,
      opacity: 0.8,
    },
  };

  const line: LineNode = {
    id: 'l1',
    type: 'line',
    start: { x: 10, y: 20 },
    end: { x: 110, y: 120 },
    visible: true,
    locked: false,
    style: {
      stroke: '#0000ff',
      strokeWidth: 4,
      opacity: 1,
    },
  };

  const arrowFree: ArrowNode = {
    id: 'a1',
    type: 'arrow',
    start: { x: 10, y: 20 },
    end: { x: 110, y: 120 },
    startMarker: 'none',
    endMarker: 'arrow',
    visible: true,
    locked: false,
    style: {
      stroke: '#ff00ff',
      strokeWidth: 2,
      opacity: 1,
    },
  };

  const arrowBound: ArrowNode = {
    id: 'a2',
    type: 'arrow',
    start: { targetId: 'box-1', anchor: { x: 0.5, y: 0.5 } },
    end: { x: 110, y: 120 },
    startMarker: 'dot',
    endMarker: 'arrow',
    visible: true,
    locked: false,
    style: {
      stroke: '#00ffff',
      strokeWidth: 2,
      opacity: 1,
    },
  };

  describe('translateShape', () => {
    it('translada retângulo preservando estilo, dimensões e rotação', () => {
      const moved = translateShape(rect, { x: 15, y: -20 });
      expect(moved).toEqual({
        ...rect,
        x: 65,
        y: 40,
      });
    });

    it('translada elipse preservando dimensões e rotação', () => {
      const moved = translateShape(ellipse, { x: -30, y: 50 });
      expect(moved).toEqual({
        ...ellipse,
        x: 170,
        y: 200,
      });
    });

    it('translada linha movendo início e fim com o mesmo delta', () => {
      const moved = translateShape(line, { x: 25, y: 35 });
      expect(moved).toEqual({
        ...line,
        start: { x: 35, y: 55 },
        end: { x: 135, y: 155 },
      });
    });

    it('translada seta movendo endpoints livres e preservando vinculados', () => {
      const movedFree = translateShape(arrowFree, { x: 10, y: 10 });
      expect(movedFree).toEqual({
        ...arrowFree,
        start: { x: 20, y: 30 },
        end: { x: 120, y: 130 },
      });

      const movedBound = translateShape(arrowBound, { x: 10, y: 10 });
      expect(movedBound).toEqual({
        ...arrowBound,
        start: { targetId: 'box-1', anchor: { x: 0.5, y: 0.5 } },
        end: { x: 120, y: 130 },
      });
    });
  });

  describe('toPreviewShape', () => {
    it('converte retângulo para PreviewShape', () => {
      const preview = toPreviewShape(rect);
      expect(preview).toEqual({
        id: 'r1',
        type: 'rectangle',
        x: 50,
        y: 60,
        width: 100,
        height: 80,
        rotation: 0.5,
        style: rect.style,
        visible: true,
        locked: false,
      });
    });

    it('converte linha para PreviewShape', () => {
      const preview = toPreviewShape(line);
      expect(preview).toEqual({
        id: 'l1',
        type: 'line',
        start: { x: 10, y: 20 },
        end: { x: 110, y: 120 },
        style: line.style,
        visible: true,
        locked: false,
      });
    });

    it('converte seta para PreviewShape', () => {
      const preview = toPreviewShape(arrowBound);
      expect(preview).toEqual({
        id: 'a2',
        type: 'arrow',
        start: { targetId: 'box-1', anchor: { x: 0.5, y: 0.5 } },
        end: { x: 110, y: 120 },
        startMarker: 'dot',
        endMarker: 'arrow',
        style: arrowBound.style,
        visible: true,
        locked: false,
      });
    });
  });

  describe('buildMovePatch', () => {
    it('cria patch com x e y para retângulo e elipse', () => {
      expect(buildMovePatch(rect, { x: 10, y: 20 })).toEqual({
        x: 60,
        y: 80,
      });
      expect(buildMovePatch(ellipse, { x: -5, y: 15 })).toEqual({
        x: 195,
        y: 165,
      });
    });

    it('cria patch com start e end para linha', () => {
      expect(buildMovePatch(line, { x: 10, y: -10 })).toEqual({
        start: { x: 20, y: 10 },
        end: { x: 120, y: 110 },
      });
    });

    it('cria patch com start e end para seta com endpoints livres ou vinculados', () => {
      expect(buildMovePatch(arrowFree, { x: 10, y: -10 })).toEqual({
        start: { x: 20, y: 10 },
        end: { x: 120, y: 110 },
      });

      expect(buildMovePatch(arrowBound, { x: 10, y: -10 })).toEqual({
        start: { targetId: 'box-1', anchor: { x: 0.5, y: 0.5 } },
        end: { x: 120, y: 110 },
      });
    });
  });
});

describe('toPreviewShape de polígono (Tarefa 108)', () => {
  it('leva o número de lados para o preview', () => {
    const polygon: PolygonNode = {
      id: 'pg',
      type: 'polygon',
      x: 10,
      y: 20,
      width: 50,
      height: 50,
      rotation: 0.1,
      sides: 7,
      visible: true,
      locked: false,
      style: { fill: '#14b8a6', stroke: '#0f766e', strokeWidth: 2, opacity: 1 },
    };
    expect(toPreviewShape(polygon)).toEqual({
      id: 'pg',
      type: 'polygon',
      x: 10,
      y: 20,
      width: 50,
      height: 50,
      rotation: 0.1,
      sides: 7,
      style: polygon.style,
      visible: true,
      locked: false,
    });
  });
});

describe('curva Bézier ao mover (Tarefa 110)', () => {
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

  it('translada os quatro pontos e mantém a simetria', () => {
    const moved = translateShape(curve, { x: 5, y: -3 }) as BezierNode;
    expect(moved).toMatchObject({
      start: { x: 5, y: -3 },
      control1: { x: 5, y: -43 },
      control2: { x: 105, y: -43 },
      end: { x: 105, y: -3 },
      symmetric: true,
    });
    expect(buildMovePatch(curve, { x: 5, y: -3 })).toEqual({
      start: { x: 5, y: -3 },
      control1: { x: 5, y: -43 },
      control2: { x: 105, y: -43 },
      end: { x: 105, y: -3 },
    });
  });

  it('leva a curva inteira para o preview', () => {
    expect(toPreviewShape(curve)).toEqual({
      id: 'bz',
      type: 'bezier',
      start: curve.start,
      control1: curve.control1,
      control2: curve.control2,
      end: curve.end,
      symmetric: true,
      style: curve.style,
      visible: true,
      locked: false,
    });
  });
});

describe('toPreviewShape e o texto da forma (US-SL.7)', () => {
  const LABEL = {
    text: 'Olá',
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    color: null,
    textAlign: 'center',
    verticalAlign: 'middle',
  } as const;
  const BASE = {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 },
  };
  const NINE = [
    { type: 'rectangle' },
    { type: 'square' },
    { type: 'ellipse' },
    { type: 'circle' },
    { type: 'diamond' },
    { type: 'triangle', variant: 'isosceles', apex: 0.5 },
    { type: 'polygon', sides: 6 },
    { type: 'cross', armRatio: 1 / 3 },
    { type: 'chevron', direction: 'right', notchDepth: 0.25 },
  ] as const;

  it.each(NINE)('$type mantém o label na prévia', (shape) => {
    const node = { id: 'n', ...shape, ...BASE, label: LABEL } as unknown as ShapeNode;

    expect(toPreviewShape(node)).toMatchObject({ type: shape.type, label: LABEL });
  });

  it.each(NINE)('$type sem label não ganha a chave', (shape) => {
    const node = { id: 'n', ...shape, ...BASE } as unknown as ShapeNode;

    expect('label' in toPreviewShape(node)).toBe(false);
  });

  it('as demais formas não levam label', () => {
    const brace = {
      id: 'b',
      type: 'brace',
      orientation: 'right',
      tipPosition: 0.5,
      curvature: 0.5,
      ...BASE,
    } as unknown as ShapeNode;

    expect('label' in toPreviewShape(brace)).toBe(false);
  });
});
