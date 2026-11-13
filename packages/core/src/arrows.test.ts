import { describe, expect, it } from 'vitest';
import {
  isBindingEndpoint,
  isFreeEndpoint,
  isZeroLengthArrow,
  resolveAnchorPosition,
  resolveArrowEndpoints,
  resolveEndpoint,
} from './arrows.js';
import { createCanvasSection } from './canvas-section.js';
import { shapeBounds } from './geometry/bounds.js';
import { pointInShape } from './geometry/shapes.js';
import type { ArrowNode, RectangleNode } from './shapes.js';
import { validateDocument } from './validate.js';

describe('Setas e Âncoras Dinâmicas no Core (Tarefa 45 - INPUT-07)', () => {
  const sampleRect: RectangleNode = {
    id: 'rect-1',
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
  };

  describe('resolveAnchorPosition e resolveEndpoint', () => {
    it('resolve âncoras normalizadas em retângulo sem rotação', () => {
      // Centro (0.5, 0.5)
      expect(resolveAnchorPosition(sampleRect, { x: 0.5, y: 0.5 })).toEqual({ x: 200, y: 150 });
      // Topo esquerdo (0, 0)
      expect(resolveAnchorPosition(sampleRect, { x: 0, y: 0 })).toEqual({ x: 100, y: 100 });
      // Canto inferior direito (1, 1)
      expect(resolveAnchorPosition(sampleRect, { x: 1, y: 1 })).toEqual({ x: 300, y: 200 });
      // Meio da borda direita (1, 0.5)
      expect(resolveAnchorPosition(sampleRect, { x: 1, y: 0.5 })).toEqual({ x: 300, y: 150 });
    });

    it('resolve âncoras normalizadas considerando a rotação do nó alvo', () => {
      const rotatedRect: RectangleNode = {
        ...sampleRect,
        rotation: Math.PI / 2, // 90 graus ao redor do centro (200, 150)
      };
      // O meio da borda direita (1, 0.5) no espaço local deve ir para baixo no mundo
      const pRight = resolveAnchorPosition(rotatedRect, { x: 1, y: 0.5 });
      expect(pRight.x).toBeCloseTo(200);
      expect(pRight.y).toBeCloseTo(250);

      // O topo meio (0.5, 0) no espaço local deve ir para a direita no mundo
      const pTop = resolveAnchorPosition(rotatedRect, { x: 0.5, y: 0 });
      expect(pTop.x).toBeCloseTo(250);
      expect(pTop.y).toBeCloseTo(150);
    });

    it('resolve endpoints livres e vinculados', () => {
      const free = { x: 10, y: 20 };
      expect(isFreeEndpoint(free)).toBe(true);
      expect(isBindingEndpoint(free)).toBe(false);
      expect(resolveEndpoint(free, () => undefined)).toEqual({ x: 10, y: 20 });

      const bound = { targetId: 'rect-1', anchor: { x: 0.5, y: 0.5 } };
      expect(isBindingEndpoint(bound)).toBe(true);
      expect(isFreeEndpoint(bound)).toBe(false);
      expect(resolveEndpoint(bound, (id) => (id === 'rect-1' ? sampleRect : undefined))).toEqual({
        x: 200,
        y: 150,
      });

      // Alvo inexistente faz fallback limpo
      expect(resolveEndpoint(bound, () => undefined)).toEqual({ x: 0, y: 0 });
    });

    it('resolveArrowEndpoints calcula os dois extremos no mundo', () => {
      const arrow: ArrowNode = {
        id: 'arrow-1',
        type: 'arrow',
        start: { targetId: 'rect-1', anchor: { x: 0, y: 0.5 } },
        end: { x: 50, y: 150 },
        startMarker: 'none',
        endMarker: 'arrow',
        visible: true,
        locked: false,
        style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
      };

      const resolved = resolveArrowEndpoints(arrow, (id) =>
        id === 'rect-1' ? sampleRect : undefined,
      );
      expect(resolved.start).toEqual({ x: 100, y: 150 });
      expect(resolved.end).toEqual({ x: 50, y: 150 });
    });
  });

  describe('isZeroLengthArrow', () => {
    it('detecta segmento de comprimento zero entre endpoints livres', () => {
      expect(isZeroLengthArrow({ start: { x: 5, y: 10 }, end: { x: 5, y: 10 } })).toBe(true);
      expect(isZeroLengthArrow({ start: { x: 5, y: 10 }, end: { x: 6, y: 10 } })).toBe(false);
    });

    it('detecta segmento de comprimento zero em vinculações idênticas ao mesmo nó', () => {
      expect(
        isZeroLengthArrow({
          start: { targetId: 't1', anchor: { x: 0.5, y: 0.5 } },
          end: { targetId: 't1', anchor: { x: 0.5, y: 0.5 } },
        }),
      ).toBe(true);

      expect(
        isZeroLengthArrow({
          start: { targetId: 't1', anchor: { x: 0.5, y: 0.5 } },
          end: { targetId: 't1', anchor: { x: 1, y: 0.5 } },
        }),
      ).toBe(false);
    });

    it('detecta comprimento zero quando resolvido no mundo via getNode', () => {
      const rectA = { ...sampleRect, id: 'a', x: 0, y: 0, width: 100, height: 100 };
      const rectB = { ...sampleRect, id: 'b', x: 100, y: 0, width: 100, height: 100 };
      const getNode = (id: string) => (id === 'a' ? rectA : id === 'b' ? rectB : undefined);

      // Canto direito de A é (100, 50). Canto esquerdo de B é (100, 50)
      const touchingEndpoints = {
        start: { targetId: 'a', anchor: { x: 1, y: 0.5 } },
        end: { targetId: 'b', anchor: { x: 0, y: 0.5 } },
      };
      expect(isZeroLengthArrow(touchingEndpoints, getNode)).toBe(true);
    });
  });

  describe('CanvasSectionApi: Criação, atualização e validação de setas', () => {
    it('cria uma seta com endpoints livres e marcadores padrão', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'arrow-free',
          type: 'arrow',
          start: { x: 10, y: 20 },
          end: { x: 100, y: 150 },
        },
      });
      expect(res.ok).toBe(true);

      const snapshot = section.getSnapshot();
      const node = snapshot.document.nodes['arrow-free'] as ArrowNode;
      expect(node).toBeDefined();
      expect(node.type).toBe('arrow');
      expect(node.start).toEqual({ x: 10, y: 20 });
      expect(node.end).toEqual({ x: 100, y: 150 });
      expect(node.startMarker).toBe('none');
      expect(node.endMarker).toBe('arrow');
      expect(node.style.stroke).toBe('#000000');
    });

    it('cria uma seta com marcadores customizados', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'arrow-custom',
          type: 'arrow',
          start: { x: 0, y: 0 },
          end: { x: 50, y: 50 },
          startMarker: 'dot',
          endMarker: 'none',
        },
      });
      expect(res.ok).toBe(true);

      const node = section.getSnapshot().document.nodes['arrow-custom'] as ArrowNode;
      expect(node.startMarker).toBe('dot');
      expect(node.endMarker).toBe('none');
    });

    it('cria seta vinculada a um retângulo existente', () => {
      const section = createCanvasSection();
      const rectRes = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'target-rect',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });
      expect(rectRes.ok).toBe(true);

      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'arrow-bound',
          type: 'arrow',
          start: { targetId: 'target-rect', anchor: { x: 1, y: 0.5 } },
          end: { x: 300, y: 100 },
        },
      });
      expect(res.ok).toBe(true);

      const node = section.getSnapshot().document.nodes['arrow-bound'] as ArrowNode;
      expect(isBindingEndpoint(node.start)).toBe(true);
      if (isBindingEndpoint(node.start)) {
        expect(node.start.targetId).toBe('target-rect');
        expect(node.start.anchor).toEqual({ x: 1, y: 0.5 });
      }
    });

    it('rejeita criação de seta com alvo inexistente', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'arrow-broken',
          type: 'arrow',
          start: { targetId: 'missing-node', anchor: { x: 0.5, y: 0.5 } },
          end: { x: 100, y: 100 },
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('NOT_FOUND');
      }
    });

    it('rejeita auto-vínculo na criação ou atualização', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'self-arrow',
          type: 'arrow',
          start: { targetId: 'self-arrow', anchor: { x: 0, y: 0 } },
          end: { x: 50, y: 50 },
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejeita seta de comprimento zero na criação', () => {
      const section = createCanvasSection();
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'arrow',
          start: { x: 42, y: 42 },
          end: { x: 42, y: 42 },
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('permite atualizar marcadores e endpoints via shape.update', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'a1',
          type: 'arrow',
          start: { x: 10, y: 10 },
          end: { x: 100, y: 100 },
        },
      });

      const updateRes = section.dispatch({
        type: 'shape.update',
        id: 'a1',
        patch: {
          startMarker: 'dot',
          endMarker: 'dot',
          end: { x: 200, y: 200 },
        },
      });
      expect(updateRes.ok).toBe(true);

      const node = section.getSnapshot().document.nodes['a1'] as ArrowNode;
      expect(node.startMarker).toBe('dot');
      expect(node.endMarker).toBe('dot');
      expect(node.end).toEqual({ x: 200, y: 200 });
    });
  });

  describe('Ciclo de vida do vínculo: Exclusão do alvo e Undo/Redo (INPUT-07)', () => {
    it('excluir o alvo converte o vínculo em endpoint livre na última posição derivada na mesma transação; undo restaura o vínculo', () => {
      const section = createCanvasSection();

      // 1. Cria retângulo em (100, 100) com dimensões 200x100
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-target',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 200,
          height: 100,
          rotation: 0,
        },
      });

      // 2. Cria seta vinculada à borda direita do retângulo: anchor (1, 0.5) -> mundo (300, 150)
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'arrow-link',
          type: 'arrow',
          start: { targetId: 'box-target', anchor: { x: 1, y: 0.5 } },
          end: { x: 500, y: 150 },
        },
      });

      const beforeDelete = section.getSnapshot().document.nodes['arrow-link'] as ArrowNode;
      expect(isBindingEndpoint(beforeDelete.start)).toBe(true);

      // 3. Exclui o retângulo alvo
      const removeRes = section.dispatch({
        type: 'shape.remove',
        id: 'box-target',
      });
      expect(removeRes.ok).toBe(true);

      // O alvo não existe mais
      expect(section.getSnapshot().document.nodes['box-target']).toBeUndefined();

      // A seta agora possui endpoint livre na última coordenada calculada (300, 150)
      const afterDelete = section.getSnapshot().document.nodes['arrow-link'] as ArrowNode;
      expect(isFreeEndpoint(afterDelete.start)).toBe(true);
      if (isFreeEndpoint(afterDelete.start)) {
        expect(afterDelete.start.x).toBeCloseTo(300);
        expect(afterDelete.start.y).toBeCloseTo(150);
      }

      // 4. Desfazer (undo) restaura o nó excluído e o vínculo da seta intacto (INPUT-07)
      const undoRes = section.undo();
      expect(undoRes.ok).toBe(true);

      expect(section.getSnapshot().document.nodes['box-target']).toBeDefined();
      const restoredArrow = section.getSnapshot().document.nodes['arrow-link'] as ArrowNode;
      expect(isBindingEndpoint(restoredArrow.start)).toBe(true);
      if (isBindingEndpoint(restoredArrow.start)) {
        expect(restoredArrow.start.targetId).toBe('box-target');
        expect(restoredArrow.start.anchor).toEqual({ x: 1, y: 0.5 });
      }

      // 5. Refazer (redo) remove o alvo e converte novamente a seta em endpoint livre
      const redoRes = section.redo();
      expect(redoRes.ok).toBe(true);

      expect(section.getSnapshot().document.nodes['box-target']).toBeUndefined();
      const redoneArrow = section.getSnapshot().document.nodes['arrow-link'] as ArrowNode;
      expect(isFreeEndpoint(redoneArrow.start)).toBe(true);
      if (isFreeEndpoint(redoneArrow.start)) {
        expect(redoneArrow.start.x).toBeCloseTo(300);
        expect(redoneArrow.start.y).toBeCloseTo(150);
      }
    });

    it('converte ambos os endpoints se ambos estavam vinculados ao mesmo nó excluído', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'single-box',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });

      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'loop-arrow',
          type: 'arrow',
          start: { targetId: 'single-box', anchor: { x: 0, y: 0.5 } },
          end: { targetId: 'single-box', anchor: { x: 1, y: 0.5 } },
        },
      });

      section.dispatch({
        type: 'shape.remove',
        id: 'single-box',
      });

      const arrow = section.getSnapshot().document.nodes['loop-arrow'] as ArrowNode;
      expect(isFreeEndpoint(arrow.start)).toBe(true);
      expect(isFreeEndpoint(arrow.end)).toBe(true);
      if (isFreeEndpoint(arrow.start) && isFreeEndpoint(arrow.end)) {
        expect(arrow.start.x).toBeCloseTo(0);
        expect(arrow.start.y).toBeCloseTo(50);
        expect(arrow.end.x).toBeCloseTo(100);
        expect(arrow.end.y).toBeCloseTo(50);
      }
    });
  });

  describe('shapeBounds e pointInShape com setas', () => {
    it('calcula bounds de seta com marcadores e stroke', () => {
      const arrow: ArrowNode = {
        id: 'a1',
        type: 'arrow',
        start: { x: 10, y: 10 },
        end: { x: 110, y: 10 },
        startMarker: 'arrow',
        endMarker: 'arrow',
        visible: true,
        locked: false,
        style: { stroke: '#000000', strokeWidth: 4, opacity: 1 },
      };

      const bounds = shapeBounds(arrow);
      expect(bounds.x).toBeLessThan(10);
      expect(bounds.width).toBeGreaterThan(100);
      expect(bounds.height).toBeGreaterThan(0);
    });

    it('testa pointInShape em seta', () => {
      const arrow: ArrowNode = {
        id: 'a1',
        type: 'arrow',
        start: { x: 0, y: 50 },
        end: { x: 100, y: 50 },
        startMarker: 'none',
        endMarker: 'arrow',
        visible: true,
        locked: false,
        style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
      };

      // Ponto sobre a seta
      expect(pointInShape(arrow, { x: 50, y: 50 }, 2)).toBe(true);
      // Ponto próximo com tolerância
      expect(pointInShape(arrow, { x: 50, y: 52 }, 2)).toBe(true);
      // Ponto longe
      expect(pointInShape(arrow, { x: 50, y: 70 }, 2)).toBe(false);
    });
  });

  describe('validateDocument com nós arrow', () => {
    it('valida documento válido contendo seta', () => {
      const validDoc = {
        schemaVersion: 1,
        id: 'doc-1',
        nodes: {
          box: {
            id: 'box',
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            rotation: 0,
            visible: true,
            locked: false,
            style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
          },
          arr: {
            id: 'arr',
            type: 'arrow',
            start: { targetId: 'box', anchor: { x: 0.5, y: 0.5 } },
            end: { x: 100, y: 100 },
            startMarker: 'none',
            endMarker: 'arrow',
            visible: true,
            locked: false,
            style: { stroke: '#000000', strokeWidth: 1, opacity: 1 },
          },
        },
        layers: [
          { id: 'l1', name: 'Layer 1', visible: true, locked: false, childIds: ['box', 'arr'] },
        ],
      };

      const res = validateDocument(validDoc);
      expect(res.ok).toBe(true);
    });

    it('recusa documento com seta apontando para nó inexistente', () => {
      const invalidDoc = {
        schemaVersion: 1,
        id: 'doc-1',
        nodes: {
          arr: {
            id: 'arr',
            type: 'arrow',
            start: { targetId: 'non-existent', anchor: { x: 0.5, y: 0.5 } },
            end: { x: 100, y: 100 },
            startMarker: 'none',
            endMarker: 'arrow',
            visible: true,
            locked: false,
            style: { stroke: '#000000', strokeWidth: 1, opacity: 1 },
          },
        },
        layers: [{ id: 'l1', name: 'Layer 1', visible: true, locked: false, childIds: ['arr'] }],
      };

      const res = validateDocument(invalidDoc);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        const issues = (res.error.details as { issues: readonly { rule: string }[] }).issues;
        expect(issues[0]?.rule).toBe('broken-reference');
      }
    });
  });
});

describe('âncora em curva Bézier', () => {
  it('corre pela corda, como na linha', () => {
    const curve = { type: 'bezier' as const, start: { x: 10, y: 20 }, end: { x: 110, y: 70 } };
    expect(resolveAnchorPosition(curve, { x: 0.25, y: 0.9 })).toEqual({ x: 35, y: 32.5 });
  });
});
