import type {
  ArrowNode,
  BezierNode,
  BoardNode,
  CircleNode,
  EllipseNode,
  LineNode,
  PolygonNode,
  RectangleNode,
  ShapeNode,
  SquareNode,
  TextNode,
  TriangleNode,
} from '@canvash/core';
import { describe, expect, it } from 'vitest';
import {
  buildResizePatch,
  buildResizePreview,
  findResizeHandleAtPoint,
  getLockedAspectRatio,
  getResizeCursor,
  getShapeResizeHandles,
  isAspectRatioLocked,
  normalizeHandleId,
  resizeShape,
  type ResizeHandleId,
} from './resize.js';

describe('resize.ts - Redimensionamento de Shape Única (Tarefa 34)', () => {
  const baseRect: RectangleNode = {
    id: 'rect-1',
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  const baseLine: LineNode = {
    id: 'line-1',
    type: 'line',
    start: { x: 50, y: 50 },
    end: { x: 250, y: 50 },
    visible: true,
    locked: false,
    style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
  };

  it('normaliza sinônimos de identificadores de handles', () => {
    expect(normalizeHandleId('tl')).toBe('nw');
    expect(normalizeHandleId('br')).toBe('se');
    expect(normalizeHandleId('tr')).toBe('ne');
    expect(normalizeHandleId('bl')).toBe('sw');
    expect(normalizeHandleId('tc')).toBe('n');
    expect(normalizeHandleId('bc')).toBe('s');
    expect(normalizeHandleId('rc')).toBe('e');
    expect(normalizeHandleId('lc')).toBe('w');
    expect(normalizeHandleId('start')).toBe('start');
  });

  it('calcula posições dos 8 handles de retângulo sem rotação', () => {
    const handles = getShapeResizeHandles(baseRect);
    expect(handles).toHaveLength(8);

    const map = Object.fromEntries(handles.map((h) => [h.id, { x: h.x, y: h.y }]));
    expect(map['nw']).toEqual({ x: 100, y: 100 });
    expect(map['n']).toEqual({ x: 200, y: 100 });
    expect(map['ne']).toEqual({ x: 300, y: 100 });
    expect(map['e']).toEqual({ x: 300, y: 150 });
    expect(map['se']).toEqual({ x: 300, y: 200 });
    expect(map['s']).toEqual({ x: 200, y: 200 });
    expect(map['sw']).toEqual({ x: 100, y: 200 });
    expect(map['w']).toEqual({ x: 100, y: 150 });
  });

  it('calcula posições dos handles de linha', () => {
    const handles = getShapeResizeHandles(baseLine);
    expect(handles).toHaveLength(2);
    expect(handles[0]).toEqual({ id: 'start', x: 50, y: 50 });
    expect(handles[1]).toEqual({ id: 'end', x: 250, y: 50 });
  });

  it('detecta handle sob o cursor com tolerância', () => {
    expect(findResizeHandleAtPoint(baseRect, { x: 102, y: 98 }, 5)).toBe('nw');
    expect(findResizeHandleAtPoint(baseRect, { x: 304, y: 203 }, 6)).toBe('se');
    expect(findResizeHandleAtPoint(baseRect, { x: 200, y: 150 }, 5)).toBeNull(); // centro
  });

  describe('redimensionamento de retângulo (eixos locais e âncora fixa)', () => {
    it('redimensiona handle se (bottom-right) mantendo nw (top-left) fixo', () => {
      // nw original está em (100, 100). Novo ponto para se: (350, 250)
      const resized = resizeShape(baseRect, 'se', { x: 350, y: 250 }) as RectangleNode;

      expect(resized.x).toBe(100);
      expect(resized.y).toBe(100);
      expect(resized.width).toBe(250);
      expect(resized.height).toBe(150);
    });

    it('redimensiona handle nw (top-left) mantendo se (bottom-right) fixo', () => {
      // se original está em (300, 200). Novo ponto para nw: (50, 80)
      const resized = resizeShape(baseRect, 'nw', { x: 50, y: 80 }) as RectangleNode;

      // O canto se resultante deve continuar em (300, 200)
      expect(resized.x).toBe(50);
      expect(resized.y).toBe(80);
      expect(resized.width).toBe(250); // 300 - 50
      expect(resized.height).toBe(120); // 200 - 80
      expect(resized.x + resized.width).toBe(300);
      expect(resized.y + resized.height).toBe(200);
    });

    it('redimensiona borda direita (e) mantendo altura e borda esquerda fixa', () => {
      const resized = resizeShape(baseRect, 'e', { x: 450, y: 160 }) as RectangleNode;

      expect(resized.x).toBe(100);
      expect(resized.y).toBe(100);
      expect(resized.width).toBe(350);
      expect(resized.height).toBe(100); // inalterada
    });

    it('redimensiona com rotação mantendo a âncora fixa no mundo', () => {
      const rotatedRect: RectangleNode = {
        ...baseRect,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: Math.PI / 4, // 45 graus
      };

      // Handle se
      const handles = getShapeResizeHandles(rotatedRect);
      const nwHandle = handles.find((h) => h.id === 'nw')!;

      // Redimensiona arrastando se
      const resized = resizeShape(rotatedRect, 'se', { x: 200, y: 200 }) as RectangleNode;

      // As posições dos handles do nó redimensionado devem manter nw exatamente no mesmo lugar
      const newHandles = getShapeResizeHandles(resized);
      const newNw = newHandles.find((h) => h.id === 'nw')!;

      expect(newNw.x).toBeCloseTo(nwHandle.x, 5);
      expect(newNw.y).toBeCloseTo(nwHandle.y, 5);
      expect(resized.rotation).toBe(Math.PI / 4);
    });

    it('impede flip ao cruzar a âncora, limitando no mínimo de 1 unidade', () => {
      // Tenta arrastar se para a esquerda de nw (ex: x: -50, y: -50 onde nw está em 100, 100)
      const resized = resizeShape(baseRect, 'se', { x: -50, y: -50 }) as RectangleNode;

      expect(resized.width).toBe(1);
      expect(resized.height).toBe(1);
      expect(resized.x).toBe(100);
      expect(resized.y).toBe(100);
    });

    it('preserva proporção ao redimensionar com Shift ativo', () => {
      // Retângulo original: 200x100 (proporção 2:1)
      const resized = resizeShape(
        baseRect,
        'se',
        { x: 300, y: 300 }, // dx=200, dy=200
        { preserveAspectRatio: true },
      ) as RectangleNode;

      // Deve manter proporção 2:1 -> width: 400, height: 200
      expect(resized.width).toBe(400);
      expect(resized.height).toBe(200);
      expect(resized.width / resized.height).toBe(2);
      expect(resized.x).toBe(100);
      expect(resized.y).toBe(100);
    });
  });

  describe('redimensionamento de linha', () => {
    it('move endpoint start mantendo end fixo', () => {
      const resized = resizeShape(baseLine, 'start', { x: 10, y: 20 }) as LineNode;

      expect(resized.start).toEqual({ x: 10, y: 20 });
      expect(resized.end).toEqual({ x: 250, y: 50 });
    });

    it('move endpoint end mantendo start fixo', () => {
      const resized = resizeShape(baseLine, 'end', { x: 300, y: 120 }) as LineNode;

      expect(resized.start).toEqual({ x: 50, y: 50 });
      expect(resized.end).toEqual({ x: 300, y: 120 });
    });

    it('aplica comprimento mínimo de 1 se os pontos colidirem', () => {
      const resized = resizeShape(baseLine, 'end', { x: 50, y: 50 }) as LineNode;

      expect(
        Math.hypot(resized.end.x - resized.start.x, resized.end.y - resized.start.y),
      ).toBeGreaterThanOrEqual(1);
    });

    it('faz snap em 45° quando Shift estiver ativo', () => {
      const resized = resizeShape(
        baseLine,
        'end',
        { x: 150, y: 140 }, // próximo de 45° a partir de (50, 50)
        { preserveAspectRatio: true },
      ) as LineNode;

      const angle = Math.atan2(resized.end.y - resized.start.y, resized.end.x - resized.start.x);
      // Deve ser exatamente PI/4 (45°)
      expect(angle).toBeCloseTo(Math.PI / 4, 4);
    });
  });

  describe('cursores CSS de redimensionamento', () => {
    it('fornece cursor correto para cada handle sem rotação', () => {
      expect(getResizeCursor('n')).toBe('ns-resize');
      expect(getResizeCursor('s')).toBe('ns-resize');
      expect(getResizeCursor('e')).toBe('ew-resize');
      expect(getResizeCursor('w')).toBe('ew-resize');
      expect(getResizeCursor('nw')).toBe('nwse-resize');
      expect(getResizeCursor('se')).toBe('nwse-resize');
      expect(getResizeCursor('ne')).toBe('nesw-resize');
      expect(getResizeCursor('sw')).toBe('nesw-resize');
      expect(getResizeCursor('start')).toBe('crosshair');
      expect(getResizeCursor('end')).toBe('crosshair');
    });

    it('adapta cursor considerando rotação de 90 graus', () => {
      // n rotacionado em 90° vira leste -> ew-resize
      expect(getResizeCursor('n', Math.PI / 2)).toBe('ew-resize');
      // e rotacionado em 90° vira sul -> ns-resize
      expect(getResizeCursor('e', Math.PI / 2)).toBe('ns-resize');
      expect(getResizeCursor('w', -Math.PI / 2)).toBe('ns-resize');
      expect(getResizeCursor('unknown' as unknown as ResizeHandleId)).toBe('pointer');
    });
  });

  describe('cobertura exaustiva de branches em handles e formas', () => {
    it('redimensiona handles ne, sw, w, s, n', () => {
      // ne (canto superior direito)
      const rNe = resizeShape(baseRect, 'ne', { x: 350, y: 50 }) as RectangleNode;
      expect(rNe.width).toBe(250);
      expect(rNe.height).toBe(150);

      // sw (canto inferior esquerdo)
      const rSw = resizeShape(baseRect, 'sw', { x: 50, y: 250 }) as RectangleNode;
      expect(rSw.width).toBe(250);
      expect(rSw.height).toBe(150);

      // w (borda esquerda)
      const rW = resizeShape(baseRect, 'w', { x: 50, y: 150 }) as RectangleNode;
      expect(rW.width).toBe(250);
      expect(rW.height).toBe(100);

      // s (borda inferior)
      const rS = resizeShape(baseRect, 's', { x: 200, y: 250 }) as RectangleNode;
      expect(rS.width).toBe(200);
      expect(rS.height).toBe(150);

      // n (borda superior)
      const rN = resizeShape(baseRect, 'n', { x: 200, y: 50 }) as RectangleNode;
      expect(rN.width).toBe(200);
      expect(rN.height).toBe(150);
    });

    it('redimensiona com Shift em bordas horizontal e vertical', () => {
      // Borda horizontal e com Shift
      const rE = resizeShape(
        baseRect,
        'e',
        { x: 500, y: 150 },
        {
          preserveAspectRatio: true,
        },
      ) as RectangleNode;
      expect(rE.width).toBe(400); // dobrou largura -> altura dobra de 100 para 200
      expect(rE.height).toBe(200);

      // Borda vertical s com Shift
      const rS = resizeShape(
        baseRect,
        's',
        { x: 200, y: 300 },
        {
          preserveAspectRatio: true,
        },
      ) as RectangleNode;
      expect(rS.height).toBe(200); // dobrou altura -> largura dobra de 200 para 400
      expect(rS.width).toBe(400);
    });

    it('ignora handle de linha em forma com caixa', () => {
      const ignored = resizeShape(baseRect, 'start', { x: 0, y: 0 });
      expect(ignored).toBe(baseRect);
    });

    it('redimensiona elipses com suporte a patches e previews', () => {
      const ellipse: EllipseNode = {
        ...baseRect,
        type: 'ellipse',
      };

      const resized = resizeShape(ellipse, 'se', { x: 350, y: 250 }) as EllipseNode;
      expect(resized.type).toBe('ellipse');
      expect(resized.width).toBe(250);

      const patch = buildResizePatch(resized);
      expect(patch).toEqual({ x: 100, y: 100, width: 250, height: 150 });

      const preview = buildResizePreview(resized);
      expect(preview.type).toBe('ellipse');
      expect(preview.id).toBe('rect-1');
    });

    it('buildResizePatch e buildResizePreview para linha e tipo desconhecido', () => {
      const linePatch = buildResizePatch(baseLine);
      expect(linePatch).toEqual({ start: baseLine.start, end: baseLine.end });

      const linePreview = buildResizePreview(baseLine);
      expect(linePreview.type).toBe('line');
      expect(linePreview.id).toBe('line-1');

      const unknownPatch = buildResizePatch({ type: 'unknown' } as unknown as ShapeNode);
      expect(unknownPatch).toEqual({});
    });

    describe('Redimensionamento de nó de texto (Tarefa 44 - INPUT-06)', () => {
      const baseText: TextNode = {
        id: 'text-resize-1',
        type: 'text',
        x: 100,
        y: 100,
        width: 200,
        height: 40,
        rotation: 0,
        text: 'Linha longa de texto para teste de reflow automático ao redimensionar',
        fontSize: 16,
        fontSizeMode: 'auto',
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
        textAlign: 'left',
        lineHeight: 1.25,
        visible: true,
        locked: false,
        style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
      };

      it('getShapeResizeHandles para texto devolve 6 handles omitindo verticais n e s', () => {
        const handles = getShapeResizeHandles(baseText);
        expect(handles).toHaveLength(6);
        const ids = handles.map((h) => h.id);
        expect(ids).toContain('nw');
        expect(ids).toContain('ne');
        expect(ids).toContain('e');
        expect(ids).toContain('se');
        expect(ids).toContain('sw');
        expect(ids).toContain('w');
        expect(ids).not.toContain('n');
        expect(ids).not.toContain('s');
      });

      it('resize horizontal com handle e refaz o layout recalculando a altura e mantendo fontSize', () => {
        // Reduz a largura para 80px (forçando quebra em mais linhas)
        const resized = resizeShape(baseText, 'e', { x: 180, y: 120 }) as TextNode;
        expect(resized.type).toBe('text');
        expect(resized.width).toBe(80);
        expect(resized.height).toBeGreaterThan(baseText.height);
        expect(resized.fontSize).toBe(16);
        expect(resized.x).toBe(100); // âncora esquerda mantida
      });

      it('resize horizontal com handle w refaz o layout com âncora direita fixa', () => {
        // Ponto x=220 (largura fica 300 - 220 = 80px)
        const resized = resizeShape(baseText, 'w', { x: 220, y: 120 }) as TextNode;
        expect(resized.type).toBe('text');
        expect(resized.width).toBe(80);
        expect(resized.height).toBeGreaterThan(baseText.height);
        expect(resized.fontSize).toBe(16);
        expect(resized.x + resized.width).toBe(baseText.x + baseText.width); // lado direito fixo em 300
      });

      it('resize vertical direto com n ou s não é oferecido e retorna forma inalterada', () => {
        const ignoredN = resizeShape(baseText, 'n', { x: 200, y: 50 });
        expect(ignoredN).toBe(baseText);

        const ignoredS = resizeShape(baseText, 's', { x: 200, y: 300 });
        expect(ignoredS).toBe(baseText);
      });

      it('escala uniforme de canto ajusta caixa e fontSize proporcionalmente', () => {
        // Dobra o tamanho via handle 'se' (de x=300, y=140 para x=500, y=180 -> scale = 2)
        const resized = resizeShape(baseText, 'se', { x: 500, y: 180 }) as TextNode;
        expect(resized.type).toBe('text');
        expect(resized.width).toBe(400); // 200 * 2
        expect(resized.height).toBe(80); // 40 * 2
        expect(resized.fontSize).toBe(32); // 16 * 2
        expect(resized.x).toBe(100);
        expect(resized.y).toBe(100);

        const patch = buildResizePatch(resized);
        expect(patch).toEqual({
          x: 100,
          y: 100,
          width: 400,
          height: 80,
          fontSize: 32,
        });

        const preview = buildResizePreview(resized);
        expect(preview.type).toBe('text');
        expect((preview as unknown as TextNode).fontSize).toBe(32);
      });
    });

    describe('Redimensionamento de Seta (ArrowNode)', () => {
      const arrowFree: ArrowNode = {
        id: 'arrow-1',
        type: 'arrow',
        start: { x: 50, y: 50 },
        end: { x: 200, y: 150 },
        startMarker: 'none',
        endMarker: 'arrow',
        visible: true,
        locked: false,
        style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
      };

      const arrowBound: ArrowNode = {
        id: 'arrow-2',
        type: 'arrow',
        start: { targetId: 'box-1', anchor: { x: 0.5, y: 0.5 } },
        end: { targetId: 'box-2', anchor: { x: 1, y: 0.5 } },
        startMarker: 'dot',
        endMarker: 'arrow',
        visible: true,
        locked: false,
        style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
      };

      it('calcula posições dos handles start e end para setas livres e vinculadas', () => {
        const freeHandles = getShapeResizeHandles(arrowFree);
        expect(freeHandles).toEqual([
          { id: 'start', x: 50, y: 50 },
          { id: 'end', x: 200, y: 150 },
        ]);

        const boundHandles = getShapeResizeHandles(arrowBound);
        expect(boundHandles).toEqual([
          { id: 'start', x: 0, y: 0 },
          { id: 'end', x: 0, y: 0 },
        ]);
      });

      it('redimensiona endpoint start e end de seta', () => {
        const resizedStart = resizeShape(arrowFree, 'start', { x: 30, y: 40 }) as ArrowNode;
        expect(resizedStart.start).toEqual({ x: 30, y: 40 });
        expect(resizedStart.end).toEqual(arrowFree.end);

        const resizedEnd = resizeShape(arrowFree, 'end', { x: 250, y: 180 }) as ArrowNode;
        expect(resizedEnd.start).toEqual(arrowFree.start);
        expect(resizedEnd.end).toEqual({ x: 250, y: 180 });

        const ignored = resizeShape(arrowFree, 'nw', { x: 10, y: 10 }) as ArrowNode;
        expect(ignored).toBe(arrowFree);
      });

      it('gera preview e patch para ArrowNode', () => {
        const preview = buildResizePreview(arrowFree);
        expect(preview).toEqual({
          id: arrowFree.id,
          type: 'arrow',
          start: arrowFree.start,
          end: arrowFree.end,
          startMarker: arrowFree.startMarker,
          endMarker: arrowFree.endMarker,
          style: arrowFree.style,
          visible: true,
          locked: false,
        });

        const patch = buildResizePatch(arrowFree);
        expect(patch).toEqual({
          start: arrowFree.start,
          end: arrowFree.end,
        });
      });
    });

    describe('Redimensionamento proporcional compulsório de Quadrado (SquareNode - Tarefa 93)', () => {
      const baseSquare: SquareNode = {
        id: 'sq-1',
        type: 'square',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#2563eb', stroke: '#1e40af', strokeWidth: 2, opacity: 1 },
      };

      it('isAspectRatioLocked retorna true para square e false para rectangle/ellipse/line/text/arrow', () => {
        expect(isAspectRatioLocked('square')).toBe(true);
        expect(isAspectRatioLocked('rectangle')).toBe(false);
        expect(isAspectRatioLocked('ellipse')).toBe(false);
        expect(isAspectRatioLocked('line')).toBe(false);
        expect(isAspectRatioLocked('text')).toBe(false);
        expect(isAspectRatioLocked('arrow')).toBe(false);
      });

      it('redimensiona em todas as 8 alças mantendo estritamente width === height mesmo com preserveAspectRatio: false', () => {
        const handles: ResizeHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        const targetPoints: Record<string, { x: number; y: number }> = {
          se: { x: 280, y: 230 }, // dx=180, dy=130 -> 180x180
          nw: { x: 20, y: 60 }, // dx=180, dy=140 -> 180x180
          ne: { x: 260, y: 50 }, // dx=160, dy=150 -> 160x160
          sw: { x: 50, y: 270 }, // dx=150, dy=170 -> 170x170
          e: { x: 290, y: 150 }, // w=190 -> 190x190
          w: { x: 10, y: 150 }, // w=190 -> 190x190
          s: { x: 150, y: 275 }, // h=175 -> 175x175
          n: { x: 150, y: 25 }, // h=175 -> 175x175
        };

        for (const handle of handles) {
          const withoutShift = resizeShape(baseSquare, handle, targetPoints[handle]!, {
            preserveAspectRatio: false,
          }) as SquareNode;
          expect(withoutShift.type).toBe('square');
          expect(withoutShift.width).toBe(withoutShift.height);
          expect(withoutShift.width).toBeGreaterThan(100);

          const withShift = resizeShape(baseSquare, handle, targetPoints[handle]!, {
            preserveAspectRatio: true,
          }) as SquareNode;
          expect(withShift).toEqual(withoutShift);
        }

        const resizedSe = resizeShape(baseSquare, 'se', { x: 280, y: 230 }) as SquareNode;
        expect(resizedSe.width).toBe(180);
        expect(resizedSe.height).toBe(180);
        expect(buildResizePatch(resizedSe)).toEqual({
          x: 100,
          y: 100,
          width: 180,
          height: 180,
        });
        expect(buildResizePreview(resizedSe).type).toBe('square');
      });
    });

    describe('Redimensionamento proporcional compulsório de Círculo (CircleNode - Tarefa 99)', () => {
      const baseCircle: CircleNode = {
        id: 'c-1',
        type: 'circle',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#10b981', stroke: '#047857', strokeWidth: 2, opacity: 1 },
      };

      it('isAspectRatioLocked retorna true para circle', () => {
        expect(isAspectRatioLocked('circle')).toBe(true);
      });

      it('redimensiona em todas as 8 alças mantendo estritamente width === height mesmo sem Shift', () => {
        const handles: ResizeHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        const targetPoints: Record<string, { x: number; y: number }> = {
          se: { x: 280, y: 230 },
          nw: { x: 20, y: 60 },
          ne: { x: 260, y: 50 },
          sw: { x: 50, y: 270 },
          e: { x: 290, y: 150 },
          w: { x: 10, y: 150 },
          s: { x: 150, y: 275 },
          n: { x: 150, y: 25 },
        };

        for (const handle of handles) {
          const withoutShift = resizeShape(baseCircle, handle, targetPoints[handle]!, {
            preserveAspectRatio: false,
          }) as CircleNode;
          expect(withoutShift.type).toBe('circle');
          expect(withoutShift.width).toBe(withoutShift.height);
          expect(withoutShift.width).toBeGreaterThan(100);
        }
      });
    });

    describe('Redimensionamento de Triângulo (TriangleNode - Tarefa 105)', () => {
      const isoTriangle: TriangleNode = {
        id: 'tr-iso',
        type: 'triangle',
        x: 100,
        y: 100,
        width: 120,
        height: 80,
        rotation: 0,
        variant: 'isosceles',
        apex: 0.5,
        visible: true,
        locked: false,
        style: { fill: '#8b5cf6', stroke: '#5b21b6', strokeWidth: 2, opacity: 1 },
      };

      const eqTriangle: TriangleNode = {
        id: 'tr-eq',
        type: 'triangle',
        x: 100,
        y: 100,
        width: 100,
        height: (100 * Math.sqrt(3)) / 2,
        rotation: 0,
        variant: 'equilateral',
        apex: 0.5,
        visible: true,
        locked: false,
        style: { fill: '#8b5cf6', stroke: '#5b21b6', strokeWidth: 2, opacity: 1 },
      };

      it('getLockedAspectRatio retorna undefined para isosceles/right/scalene e 2/sqrt(3) para equilateral', () => {
        expect(getLockedAspectRatio(isoTriangle)).toBeUndefined();
        expect(getLockedAspectRatio(eqTriangle)).toBeCloseTo(2 / Math.sqrt(3), 6);
        expect(isAspectRatioLocked(isoTriangle)).toBe(false);
        expect(isAspectRatioLocked(eqTriangle)).toBe(true);
      });

      it('redimensiona triângulo isósceles com proporção livre sem Shift', () => {
        const resized = resizeShape(
          isoTriangle,
          'se',
          { x: 300, y: 250 },
          { preserveAspectRatio: false },
        ) as TriangleNode;
        expect(resized.width).toBe(200);
        expect(resized.height).toBe(150);
      });

      it('redimensiona triângulo equilátero em todas as 8 alças mantendo a razão 2/sqrt(3) mesmo sem Shift', () => {
        const handles: ResizeHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        const targetPoints: Record<string, { x: number; y: number }> = {
          se: { x: 280, y: 230 },
          nw: { x: 20, y: 60 },
          ne: { x: 260, y: 50 },
          sw: { x: 50, y: 270 },
          e: { x: 290, y: 150 },
          w: { x: 10, y: 150 },
          s: { x: 150, y: 275 },
          n: { x: 150, y: 25 },
        };

        for (const handle of handles) {
          const resized = resizeShape(eqTriangle, handle, targetPoints[handle]!, {
            preserveAspectRatio: false,
          }) as TriangleNode;
          expect(resized.type).toBe('triangle');
          expect(resized.variant).toBe('equilateral');
          expect(resized.width / resized.height).toBeCloseTo(2 / Math.sqrt(3), 5);
        }

        const preview = buildResizePreview(eqTriangle);
        expect(preview.type).toBe('triangle');
        if (preview.type === 'triangle') {
          expect(preview.variant).toBe('equilateral');
          expect(preview.apex).toBe(0.5);
        }
      });
    });
  });
});

describe('Redimensionamento de Polígono (PolygonNode - Tarefa 108)', () => {
  const polygon: PolygonNode = {
    id: 'pg',
    type: 'polygon',
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    rotation: 0,
    sides: 6,
    visible: true,
    locked: false,
    style: { fill: '#14b8a6', stroke: '#0f766e', strokeWidth: 2, opacity: 1 },
  };

  it('getLockedAspectRatio trava o polígono em 1:1', () => {
    expect(getLockedAspectRatio(polygon)).toBe(1);
    expect(getLockedAspectRatio('polygon')).toBe(1);
    expect(isAspectRatioLocked(polygon)).toBe(true);
  });

  it('mantém 1:1 e o número de lados nas 8 alças, com ou sem Shift', () => {
    const targets: Record<
      'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
      { x: number; y: number }
    > = {
      nw: { x: 60, y: 80 },
      n: { x: 150, y: 40 },
      ne: { x: 260, y: 90 },
      e: { x: 250, y: 150 },
      se: { x: 240, y: 260 },
      s: { x: 150, y: 230 },
      sw: { x: 70, y: 220 },
      w: { x: 30, y: 150 },
    };
    for (const preserveAspectRatio of [false, true]) {
      for (const [handle, point] of Object.entries(targets)) {
        const resized = resizeShape(polygon, handle as ResizeHandleId, point, {
          preserveAspectRatio,
        }) as PolygonNode;
        expect(resized.type).toBe('polygon');
        expect(resized.sides).toBe(6);
        expect(resized.width).toBeCloseTo(resized.height, 9);
        expect(resized.width).not.toBeCloseTo(100, 1);
      }
    }
  });

  it('buildResizePreview leva o número de lados', () => {
    expect(buildResizePreview({ ...polygon, width: 140, height: 140 })).toMatchObject({
      id: 'pg',
      type: 'polygon',
      sides: 6,
      width: 140,
      height: 140,
    });
  });
});

describe('curva Bézier pelas alças das pontas (Tarefa 110)', () => {
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

  it('expõe as alças de início e fim primeiro', () => {
    expect(getShapeResizeHandles(curve).slice(0, 2)).toEqual([
      { id: 'start', x: 0, y: 0 },
      { id: 'end', x: 100, y: 0 },
    ]);
  });

  it('move a ponta e, na curva simétrica, re-espelha control2 na corda nova', () => {
    const resized = resizeShape(curve, 'end', { x: 200, y: 0 }) as BezierNode;
    expect(resized).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 200, y: 0 },
      control1: { x: 0, y: -40 },
      control2: { x: 200, y: -40 },
    });
    expect(buildResizePatch(resized)).toEqual({
      start: { x: 0, y: 0 },
      control1: { x: 0, y: -40 },
      control2: { x: 200, y: -40 },
      end: { x: 200, y: 0 },
    });
    expect(buildResizePreview(resized)).toMatchObject({
      type: 'bezier',
      end: { x: 200, y: 0 },
      control2: { x: 200, y: -40 },
    });

    const free = resizeShape({ ...curve, symmetric: false }, 'start', { x: -10, y: 5 });
    expect(free).toMatchObject({ start: { x: -10, y: 5 }, control2: { x: 100, y: -40 } });
  });

  it('ignora alça desconhecida', () => {
    expect(resizeShape(curve, 'rot' as ResizeHandleId, { x: 300, y: 300 })).toBe(curve);
  });
});

describe('curva Bézier: alças de pontas, controles e caixa (Tarefa 112)', () => {
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

  it('expõe as quatro alças da curva antes das 8 da caixa exata', () => {
    expect(getShapeResizeHandles(curve)).toEqual([
      { id: 'start', x: 0, y: 0 },
      { id: 'end', x: 100, y: 0 },
      { id: 'control1', x: 0, y: -40 },
      { id: 'control2', x: 100, y: -40 },
      { id: 'nw', x: 0, y: -30 },
      { id: 'n', x: 50, y: -30 },
      { id: 'ne', x: 100, y: -30 },
      { id: 'e', x: 100, y: -15 },
      { id: 'se', x: 100, y: 0 },
      { id: 's', x: 50, y: 0 },
      { id: 'sw', x: 0, y: 0 },
      { id: 'w', x: 0, y: -15 },
    ]);
    // A ponta coincide com o canto sw: a alça da curva vem antes e ganha
    expect(findResizeHandleAtPoint(curve, { x: 0, y: 0 }, 5)).toBe('start');
    expect(getResizeCursor('control1')).toBe('crosshair');
  });

  it('trava a proporção na razão atual da caixa', () => {
    expect(getLockedAspectRatio(curve)).toBeCloseTo(100 / 30, 12);
    expect(getLockedAspectRatio('bezier')).toBeUndefined();
  });

  it('arrastar um controle da curva simétrica espelha o outro', () => {
    expect(resizeShape(curve, 'control1', { x: 20, y: -60 })).toMatchObject({
      control1: { x: 20, y: -60 },
      control2: { x: 80, y: -60 },
    });
    expect(resizeShape(curve, 'control2', { x: 70, y: 10 })).toMatchObject({
      control1: { x: 30, y: 10 },
      control2: { x: 70, y: 10 },
    });
    expect(resizeShape({ ...curve, symmetric: false }, 'control1', { x: 5, y: 5 })).toMatchObject({
      control1: { x: 5, y: 5 },
      control2: { x: 100, y: -40 },
    });
    expect(resizeShape({ ...curve, symmetric: false }, 'control2', { x: 70, y: 10 })).toMatchObject(
      {
        control1: { x: 0, y: -40 },
        control2: { x: 70, y: 10 },
      },
    );
  });

  it('as alças da caixa escalam os quatro pontos em torno da âncora oposta', () => {
    const resized = resizeShape(curve, 'se', { x: 200, y: 30 }) as BezierNode;
    const expected = [
      [resized.start, { x: 0, y: 30 }],
      [resized.control1, { x: 0, y: -50 }],
      [resized.control2, { x: 200, y: -50 }],
      [resized.end, { x: 200, y: 30 }],
    ] as const;
    for (const [actual, wanted] of expected) {
      expect(actual.x).toBeCloseTo(wanted.x, 9);
      expect(actual.y).toBeCloseTo(wanted.y, 9);
    }
    expect(buildResizePatch(resized)).toEqual({
      start: resized.start,
      control1: resized.control1,
      control2: resized.control2,
      end: resized.end,
    });
  });

  it('escala a curva reta, de caixa sem altura, sem sair da reta', () => {
    const straight: BezierNode = {
      ...curve,
      control1: { x: 30, y: 0 },
      control2: { x: 70, y: 0 },
    };
    const resized = resizeShape(straight, 'e', { x: 200, y: 0 }) as BezierNode;
    expect(resized.end.x).toBeCloseTo(200, 9);
    expect(resized.start).toEqual({ x: 0, y: 0 });
    for (const point of [resized.start, resized.control1, resized.control2, resized.end]) {
      expect(point.y).toBeCloseTo(0, 9);
    }
  });
});

describe('buildResizePreview e o texto da forma (US-SL.7)', () => {
  it('mantém o label da forma redimensionada ou girada na prévia', () => {
    const shape = {
      id: 'r',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      rotation: 0.5,
      visible: true,
      locked: false,
      style: { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 },
      label: {
        text: 'Olá',
        fontSize: 16,
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
        color: null,
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    } as const;

    expect(buildResizePreview(shape)).toMatchObject({ type: 'rectangle', label: shape.label });
    expect('label' in buildResizePreview({ ...shape, label: undefined } as never)).toBe(false);
  });
});

describe('resize.ts com board (spec boards, §5.3)', () => {
  const board: BoardNode = {
    id: 'b',
    type: 'board',
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    title: 'Planejamento',
    style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
    childIds: ['c1'],
    visible: true,
    locked: false,
  };

  it('as 8 alças ficam no retângulo do board (sem a faixa do título), sem rotação', () => {
    const handles = getShapeResizeHandles(board);

    expect(handles.map((handle) => handle.id)).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ]);
    expect(handles.find((handle) => handle.id === 'nw')).toMatchObject({ x: 100, y: 200 });
    expect(handles.find((handle) => handle.id === 'se')).toMatchObject({ x: 400, y: 350 });
    expect(handles.find((handle) => handle.id === 'n')).toMatchObject({ x: 250, y: 200 });
  });

  it('acha a alça sob o ponto, com tolerância', () => {
    expect(findResizeHandleAtPoint(board, { x: 402, y: 348 }, 5)).toBe('se');
    expect(findResizeHandleAtPoint(board, { x: 250, y: 276 }, 5)).toBeNull();
  });

  it.each([
    ['se', { x: 450, y: 400 }, { x: 100, y: 200, width: 350, height: 200 }],
    ['nw', { x: 50, y: 150 }, { x: 50, y: 150, width: 350, height: 200 }],
    ['e', { x: 500, y: 999 }, { x: 100, y: 200, width: 400, height: 150 }],
    ['s', { x: 999, y: 380 }, { x: 100, y: 200, width: 300, height: 180 }],
    ['w', { x: 120, y: 0 }, { x: 120, y: 200, width: 280, height: 150 }],
    ['n', { x: 0, y: 230 }, { x: 100, y: 230, width: 300, height: 120 }],
    ['ne', { x: 420, y: 180 }, { x: 100, y: 180, width: 320, height: 170 }],
    ['sw', { x: 80, y: 400 }, { x: 80, y: 200, width: 320, height: 200 }],
  ] as const)('arrastar a alça %s mantém a oposta fixa', (handle, point, expected) => {
    const resized = resizeShape(board, handle, point);

    expect(resized).toMatchObject(expected);
    expect(resized.childIds).toEqual(['c1']);
  });

  it('o tamanho mínimo é 1 × 1, sem inverter', () => {
    expect(resizeShape(board, 'se', { x: 0, y: 0 })).toMatchObject({
      x: 100,
      y: 200,
      width: 1,
      height: 1,
    });
    expect(resizeShape(board, 'nw', { x: 900, y: 900 })).toMatchObject({
      x: 399,
      y: 349,
      width: 1,
      height: 1,
    });
  });

  it('o Shift não trava a proporção do board', () => {
    expect(
      resizeShape(board, 'se', { x: 500, y: 250 }, { preserveAspectRatio: true }),
    ).toMatchObject({
      width: 400,
      height: 50,
    });
  });

  it('o patch traz só x, y, width e height', () => {
    expect(buildResizePatch(resizeShape(board, 'se', { x: 450, y: 400 }))).toEqual({
      x: 100,
      y: 200,
      width: 350,
      height: 200,
    });
  });

  it('a prévia é um board sem filhos, com o título e o estilo', () => {
    const preview = buildResizePreview(resizeShape(board, 'se', { x: 450, y: 400 }));

    expect(preview).toMatchObject({
      id: 'b',
      type: 'board',
      x: 100,
      y: 200,
      width: 350,
      height: 200,
      title: 'Planejamento',
      style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
    });
    expect('childIds' in preview).toBe(false);
  });

  it('o cursor da alça não depende de rotação', () => {
    expect(getResizeCursor('se')).toBe(getResizeCursor('se', 0));
  });
});
