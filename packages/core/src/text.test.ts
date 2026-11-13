import { describe, expect, it } from 'vitest';
import { createCanvasSection } from './canvas-section.js';
import { shapeBounds } from './geometry/bounds.js';
import { shapeInsideRect, shapeIntersectsRect } from './geometry/intersect.js';
import { pointInShape } from './geometry/shapes.js';
import type { FontWeight, ShapeNode, TextAlign, TextNode } from './shapes.js';
import {
  containsHtmlTags,
  defaultTextMetricsAdapter,
  layoutText,
  type TextMetricsAdapter,
} from './text.js';
import { validateDocument } from './validate.js';

describe('Text Node and Metrics (Tarefa 41 - INPUT-06)', () => {
  describe('containsHtmlTags', () => {
    it('detecta tags HTML padrão e com atributos', () => {
      expect(containsHtmlTags('<script>alert("xss")</script>')).toBe(true);
      expect(containsHtmlTags('Hello <br/> world')).toBe(true);
      expect(containsHtmlTags('<p class="foo">paragraph</p>')).toBe(true);
      expect(containsHtmlTags('<div>test</div>')).toBe(true);
      expect(containsHtmlTags('<span style="color:red">span</span>')).toBe(true);
    });

    it('permite desigualdades matemáticas e texto comum', () => {
      expect(containsHtmlTags('x < 5 and y > 10')).toBe(false);
      expect(containsHtmlTags('2 < 3')).toBe(false);
      expect(containsHtmlTags('A simple text without brackets')).toBe(false);
      expect(containsHtmlTags('Just < and > alone')).toBe(false);
    });
  });

  describe('layoutText e defaultTextMetricsAdapter', () => {
    it('divide texto multilinha e calcula dimensões sem DOM via defaultTextMetricsAdapter', () => {
      const metrics = defaultTextMetricsAdapter.measureText('Linha 1\nLinha 2\nLinha 3', {
        fontSize: 20,
        fontFamily: 'sans-serif',
        lineHeight: 1.5,
      });

      expect(metrics.lines).toEqual(['Linha 1', 'Linha 2', 'Linha 3']);
      expect(metrics.height).toBe(3 * (20 * 1.5));
      expect(metrics.width).toBeGreaterThan(0);
    });

    it('quebra palavras quando excede maxWidth', () => {
      const longText = 'Esta é uma frase razoavelmente longa que deve quebrar em várias linhas';
      const metrics = layoutText(longText, {
        fontSize: 16,
        fontFamily: 'sans-serif',
        maxWidth: 100,
      });

      expect(metrics.lines.length).toBeGreaterThan(1);
      expect(metrics.width).toBe(100);
      expect(metrics.height).toBe(metrics.lines.length * (16 * 1.25));
    });

    it('suporta adaptador customizado de métricas injetável', () => {
      const mockAdapter: TextMetricsAdapter = {
        measureText: () => ({
          width: 350,
          height: 120,
          lines: ['Linha customizada A', 'Linha customizada B'],
        }),
      };

      const metrics = layoutText(
        'qualquer texto',
        { fontSize: 16, fontFamily: 'sans-serif' },
        mockAdapter,
      );
      expect(metrics.width).toBe(350);
      expect(metrics.height).toBe(120);
      expect(metrics.lines).toHaveLength(2);
    });
  });

  describe('Criação de nó de texto via canvas', () => {
    it('cria TextNode com valores padrão', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'text',
          x: 50,
          y: 100,
          width: 300,
          text: 'Canvash Architecture',
        },
      });

      expect(res.ok).toBe(true);
      const snapshot = section.getSnapshot();
      const nodes = Object.values(snapshot.document.nodes);
      expect(nodes).toHaveLength(1);

      const textNode = nodes[0]!;
      expect(textNode.type).toBe('text');
      if (textNode.type === 'text') {
        expect(textNode.text).toBe('Canvash Architecture');
        expect(textNode.x).toBe(50);
        expect(textNode.y).toBe(100);
        expect(textNode.width).toBe(300);
        expect(textNode.height).toBeGreaterThan(0);
        expect(textNode.rotation).toBe(0);
        expect(textNode.fontSize).toBe(16);
        expect(textNode.fontFamily).toBe('sans-serif');
        expect(textNode.fontWeight).toBe('normal');
        expect(textNode.textAlign).toBe('left');
        expect(textNode.lineHeight).toBe(1.25);
        expect(textNode.style).toEqual({
          fill: '#000000',
          stroke: null,
          strokeWidth: 0,
          opacity: 1,
        });
      }
    });

    it('cria TextNode com propriedades personalizadas', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'text',
          x: 10,
          y: 20,
          width: 250,
          height: 75,
          rotation: Math.PI / 4,
          text: 'Custom Title',
          fontSize: 24,
          fontFamily: 'Inter',
          fontWeight: 'bold',
          textAlign: 'center',
          lineHeight: 1.5,
          style: {
            fill: '#ff0000',
            stroke: '#000000',
            strokeWidth: 2,
            opacity: 0.9,
          },
        },
      });

      expect(res.ok).toBe(true);
      const snapshot = section.getSnapshot();
      const textNode = Object.values(snapshot.document.nodes)[0]!;
      expect(textNode.type).toBe('text');
      if (textNode.type === 'text') {
        expect(textNode.height).toBe(75);
        expect(textNode.fontSize).toBe(24);
        expect(textNode.fontFamily).toBe('Inter');
        expect(textNode.fontWeight).toBe('bold');
        expect(textNode.textAlign).toBe('center');
        expect(textNode.lineHeight).toBe(1.5);
        expect(textNode.style.fill).toBe('#ff0000');
        expect(textNode.style.stroke).toBe('#000000');
        expect(textNode.style.strokeWidth).toBe(2);
        expect(textNode.style.opacity).toBe(0.9);
      }
    });

    it('aceita fontWeight numérico válido (ex: 600)', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          text: 'Semibold text',
          fontWeight: 600,
        },
      });
      expect(res.ok).toBe(true);
      const textNode = Object.values(section.getSnapshot().document.nodes)[0]!;
      if (textNode.type === 'text') {
        expect(textNode.fontWeight).toBe(600);
      }
    });

    it('rejeita tags HTML no texto', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          text: '<script>evil()</script>',
        },
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('VALIDATION_ERROR');
        expect(res.error.message).toContain('must not contain HTML tags');
      }
    });

    it('rejeita fontWeight ou textAlign inválido', () => {
      const section = createCanvasSection();
      const resWeight = section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          text: 'Test',
          fontWeight: 'extra-heavy' as unknown as FontWeight,
        },
      });
      expect(resWeight.ok).toBe(false);

      const resAlign = section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          text: 'Test',
          textAlign: 'justify' as unknown as TextAlign,
        },
      });
      expect(resAlign.ok).toBe(false);
    });
  });

  describe('Limite de 1M caracteres (LIMIT_EXCEEDED)', () => {
    it('rejeita texto com mais de 1.000.000 de caracteres na criação', () => {
      const section = createCanvasSection();
      const overflowText = 'a'.repeat(1_000_001);

      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'text',
          x: 0,
          y: 0,
          width: 200,
          text: overflowText,
        },
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('LIMIT_EXCEEDED');
        if (res.error.code === 'LIMIT_EXCEEDED') {
          expect(res.error.details.limit).toBe('text');
          expect(res.error.details.max).toBe(1_000_000);
          expect(res.error.details.actual).toBe(1_000_001);
        }
      }
    });

    it('rejeita texto com mais de 1.000.000 de caracteres no update', () => {
      const section = createCanvasSection();
      const createRes = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'text-1',
          type: 'text',
          x: 0,
          y: 0,
          width: 200,
          text: 'Initial short text',
        },
      });
      expect(createRes.ok).toBe(true);

      const overflowText = 'b'.repeat(1_000_001);
      const updateRes = section.dispatch({
        type: 'shape.update',
        id: 'text-1',
        patch: {
          text: overflowText,
        },
      });

      expect(updateRes.ok).toBe(false);
      if (!updateRes.ok) {
        expect(updateRes.error.code).toBe('LIMIT_EXCEEDED');
        if (updateRes.error.code === 'LIMIT_EXCEEDED') {
          expect(updateRes.error.details.limit).toBe('text');
        }
      }
    });

    it('rejeita documento com nó de texto excedendo maxTextLength na validação', () => {
      const validDoc = createCanvasSection().getSnapshot().document;
      const invalidDoc = {
        ...validDoc,
        nodes: {
          'text-1': {
            id: 'text-1',
            type: 'text',
            x: 0,
            y: 0,
            width: 100,
            height: 20,
            rotation: 0,
            text: 'x'.repeat(101),
            fontSize: 16,
            fontFamily: 'sans-serif',
            fontWeight: 'normal',
            textAlign: 'left',
            lineHeight: 1.25,
            visible: true,
            locked: false,
            style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
          },
        },
        layers: [
          {
            ...validDoc.layers[0]!,
            childIds: ['text-1'],
          },
        ],
      };

      const res = validateDocument(invalidDoc, {
        limits: { maxTextLength: 100 },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('LIMIT_EXCEEDED');
        if (res.error.code === 'LIMIT_EXCEEDED') {
          expect(res.error.details.limit).toBe('text');
          expect(res.error.details.max).toBe(100);
          expect(res.error.details.actual).toBe(101);
        }
      }
    });
  });

  describe('shape.update e recálculo automático de altura', () => {
    it('recalcula altura automaticamente ao alterar texto sem especificar height', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'text-node',
          type: 'text',
          x: 0,
          y: 0,
          width: 200,
          text: 'Linha única',
        },
      });

      const initialNode = section.getSnapshot().document.nodes['text-node'] as TextNode;
      const initialHeight = initialNode.height;

      // Adiciona mais linhas via \n
      section.dispatch({
        type: 'shape.update',
        id: 'text-node',
        patch: {
          text: 'Linha única\nLinha 2\nLinha 3\nLinha 4',
        },
      });

      const updatedNode = section.getSnapshot().document.nodes['text-node'] as TextNode;
      expect(updatedNode.height).toBeGreaterThan(initialHeight);
      expect(updatedNode.height).toBeCloseTo(4 * (16 * 1.25));
    });

    it('mantém height explícito se fornecido no patch', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'text-node',
          type: 'text',
          x: 0,
          y: 0,
          width: 200,
          text: 'Linha única',
        },
      });

      section.dispatch({
        type: 'shape.update',
        id: 'text-node',
        patch: {
          text: 'Nova linha 1\nNova linha 2',
          height: 150,
        },
      });

      const node = section.getSnapshot().document.nodes['text-node'] as TextNode;
      expect(node.height).toBe(150);
    });
  });

  describe('Geometria, Bounds e Hit-Test', () => {
    it('calcula shapeBounds com e sem rotação', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'text-1',
          type: 'text',
          x: 100,
          y: 200,
          width: 300,
          height: 50,
          rotation: 0,
          text: 'Canvash Geometry',
        },
      });

      const node = section.getSnapshot().document.nodes['text-1'] as ShapeNode;
      const bounds = shapeBounds(node);
      expect(bounds.x).toBe(100);
      expect(bounds.y).toBe(200);
      expect(bounds.width).toBe(300);
      expect(bounds.height).toBe(50);
    });

    it('realiza hit-test via pointInShape no TextNode', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'text-1',
          type: 'text',
          x: 100,
          y: 200,
          width: 300,
          height: 50,
          text: 'Hit Testing',
        },
      });

      const node = section.getSnapshot().document.nodes['text-1'] as ShapeNode;
      expect(pointInShape(node, { x: 150, y: 220 }, 0)).toBe(true);
      expect(pointInShape(node, { x: 50, y: 50 }, 0)).toBe(false);
    });

    it('suporta interseção por marquee com shapeIntersectsRect e shapeInsideRect', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'text-1',
          type: 'text',
          x: 100,
          y: 100,
          width: 100,
          height: 50,
          text: 'Marquee Target',
        },
      });

      const node = section.getSnapshot().document.nodes['text-1'] as ShapeNode;
      // Marquee que cobre parcialmente
      expect(shapeIntersectsRect(node, { x: 50, y: 50, width: 60, height: 60 })).toBe(true);
      expect(shapeInsideRect(node, { x: 50, y: 50, width: 60, height: 60 })).toBe(false);

      // Marquee que contém totalmente
      expect(shapeInsideRect(node, { x: 50, y: 50, width: 200, height: 200 })).toBe(true);
    });
  });
});
