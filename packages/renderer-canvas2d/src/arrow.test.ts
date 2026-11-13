import type { CanvasDocument, CanvasPreview, RectangleNode } from '@canvash/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArrowDotRadius, getArrowHeadLength, paintArrow, paintMarker } from './arrow.js';
import { paintItem } from './painter.js';
import { projectScene, type RenderableArrow } from './scene.js';

describe('arrow.ts - Renderização de Setas e Marcadores (Tarefa 46 - INPUT-07)', () => {
  let ctx: CanvasRenderingContext2D;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    ctx = {
      beginPath: vi.fn(() => calls.push('beginPath')),
      moveTo: vi.fn((x: number, y: number) => calls.push(`moveTo(${x},${y})`)),
      lineTo: vi.fn((x: number, y: number) => calls.push(`lineTo(${x},${y})`)),
      arc: vi.fn((x: number, y: number, r: number) => calls.push(`arc(${x},${y},${r})`)),
      closePath: vi.fn(() => calls.push('closePath')),
      stroke: vi.fn(() => calls.push('stroke')),
      fill: vi.fn(() => calls.push('fill')),
      save: vi.fn(() => calls.push('save')),
      restore: vi.fn(() => calls.push('restore')),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
  });

  describe('Cálculo de dimensões dos marcadores', () => {
    it('calcula comprimento da cabeça respeitando o limite mínimo', () => {
      expect(getArrowHeadLength(1)).toBe(10);
      expect(getArrowHeadLength(2)).toBe(10);
      expect(getArrowHeadLength(4)).toBe(14); // 4 * 3.5 = 14
    });

    it('calcula raio do marcador circular respeitando o limite mínimo', () => {
      expect(getArrowDotRadius(1)).toBe(4);
      expect(getArrowDotRadius(2)).toBe(4);
      expect(getArrowDotRadius(4)).toBe(7.2); // 4 * 1.8 = 7.2
    });
  });

  describe('paintMarker', () => {
    it('não desenha quando marker é none', () => {
      paintMarker(ctx, { x: 10, y: 10 }, 0, 'none', '#000000', 2);
      expect(calls).toHaveLength(0);
    });

    it('pinta marcador circular dot preenchido', () => {
      paintMarker(ctx, { x: 10, y: 20 }, 0, 'dot', '#ff0000', 2);
      expect(ctx.fillStyle).toBe('#ff0000');
      expect(ctx.arc).toHaveBeenCalledWith(10, 20, 4, 0, Math.PI * 2);
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('pinta marcador arrow com triângulo preenchido e contornado', () => {
      paintMarker(ctx, { x: 50, y: 50 }, 0, 'arrow', '#0000ff', 2);
      expect(ctx.fillStyle).toBe('#0000ff');
      expect(ctx.strokeStyle).toBe('#0000ff');
      expect(ctx.lineWidth).toBe(2);
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledWith(50, 50);
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });
  });

  describe('paintArrow', () => {
    const baseArrow: RenderableArrow = {
      type: 'arrow',
      id: 'arrow-1',
      layerId: 'layer-1',
      start: { x: 10, y: 10 },
      end: { x: 110, y: 10 },
      startMarker: 'none',
      endMarker: 'arrow',
      style: {
        fill: null,
        stroke: '#112233',
        strokeWidth: 2,
        opacity: 1,
      },
    };

    it('ignora desenho se stroke for nulo ou strokeWidth for 0', () => {
      paintArrow(ctx, {
        ...baseArrow,
        style: { ...baseArrow.style, stroke: null },
      });
      paintArrow(ctx, {
        ...baseArrow,
        style: { ...baseArrow.style, strokeWidth: 0 },
      });
      expect(calls).toHaveLength(0);
    });

    it('ignora desenho se segmento tiver comprimento zero', () => {
      paintArrow(ctx, {
        ...baseArrow,
        start: { x: 10, y: 10 },
        end: { x: 10, y: 10 },
      });
      expect(calls).toHaveLength(0);
    });

    it('desenha linha reta e marcador final arrow', () => {
      paintArrow(ctx, baseArrow);
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(110, 10);
      expect(ctx.strokeStyle).toBe('#112233');
      expect(ctx.lineWidth).toBe(2);
      expect(ctx.stroke).toHaveBeenCalled();
      // Marcador final 'arrow' também executou fill e stroke
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('desenha marcadores em ambas as pontas (start: dot, end: arrow)', () => {
      paintArrow(ctx, {
        ...baseArrow,
        startMarker: 'dot',
        endMarker: 'arrow',
      });
      expect(ctx.arc).toHaveBeenCalledWith(10, 10, 4, 0, Math.PI * 2);
      expect(ctx.fill).toHaveBeenCalledTimes(2); // 1 para dot, 1 para arrow
    });

    it('desenha através de paintItem', () => {
      paintItem(ctx, baseArrow);
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
    });
  });

  describe('Projeção de cena e derivação dinâmica de âncoras (projectScene)', () => {
    const doc: CanvasDocument = {
      id: 'doc-1',
      schemaVersion: 1,
      layers: [
        {
          id: 'l1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          childIds: ['box-1', 'arrow-1'],
        },
      ],
      nodes: {
        'box-1': {
          id: 'box-1',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 200,
          height: 100,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#fff', stroke: '#000', strokeWidth: 1, opacity: 1 },
        },
        'arrow-1': {
          id: 'arrow-1',
          type: 'arrow',
          start: { targetId: 'box-1', anchor: { x: 0.5, y: 0.5 } }, // centro de box-1: (200, 150)
          end: { x: 400, y: 300 }, // endpoint livre
          startMarker: 'none',
          endMarker: 'arrow',
          visible: true,
          locked: false,
          style: { stroke: '#000', strokeWidth: 2, opacity: 1 },
        },
      },
    };

    it('projeta nó arrow resolvendo endpoint vinculado a partir do documento', () => {
      const scene = projectScene(doc);
      expect(scene.items).toHaveLength(2);
      const arrowItem = scene.items[1] as RenderableArrow;
      expect(arrowItem.type).toBe('arrow');
      expect(arrowItem.start).toEqual({ x: 200, y: 150 }); // Centro de (100, 100) 200x100
      expect(arrowItem.end).toEqual({ x: 400, y: 300 });
      expect(arrowItem.startMarker).toBe('none');
      expect(arrowItem.endMarker).toBe('arrow');
    });

    it('projeta nó arrow resolvendo endpoint vinculado em tempo real durante preview do alvo', () => {
      // Simula alvo sendo arrastado para (150, 120) no preview
      const preview: CanvasPreview = {
        updates: {
          'box-1': {
            ...(doc.nodes['box-1'] as RectangleNode),
            x: 150,
            y: 120,
          },
        },
        additions: [],
        marquee: null,
      };

      const scene = projectScene(doc, { preview });
      const arrowItem = scene.items[1] as RenderableArrow;
      // Novo centro de box-1: 150 + 100 = 250, 120 + 50 = 170
      expect(arrowItem.start).toEqual({ x: 250, y: 170 });
      expect(arrowItem.end).toEqual({ x: 400, y: 300 });
    });

    it('cai para { x: 0, y: 0 } se o nó alvo vinculado não existir no documento', () => {
      const brokenDoc: CanvasDocument = {
        ...doc,
        nodes: {
          'arrow-broken': {
            id: 'arrow-broken',
            type: 'arrow',
            start: { targetId: 'ghost-node', anchor: { x: 0.5, y: 0.5 } },
            end: { x: 200, y: 200 },
            startMarker: 'none',
            endMarker: 'arrow',
            visible: true,
            locked: false,
            style: { stroke: '#000', strokeWidth: 1, opacity: 1 },
          },
        },
        layers: [
          {
            id: 'l1',
            name: 'Layer 1',
            visible: true,
            locked: false,
            childIds: ['arrow-broken'],
          },
        ],
      };

      const scene = projectScene(brokenDoc);
      const arrowItem = scene.items[0] as RenderableArrow;
      expect(arrowItem.start).toEqual({ x: 0, y: 0 });
      expect(arrowItem.end).toEqual({ x: 200, y: 200 });
    });
  });
});
