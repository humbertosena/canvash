import { beforeEach, describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi, type RectangleNode } from '@canvash/core';
import {
  buildMoveCommands,
  buildMovePreviews,
  computeMoveDelta,
  executeMove,
  getMovableNodes,
} from './move.js';

describe('move tool', () => {
  let section: CanvasSectionApi;

  beforeEach(() => {
    section = createCanvasSection();

    // Cria r1
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'r1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 60,
        rotation: 0,
      },
    });

    // Cria r2
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'r2',
        type: 'rectangle',
        x: 150,
        y: 20,
        width: 80,
        height: 60,
        rotation: 0,
      },
    });

    // Cria l1
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'l1',
        type: 'line',
        start: { x: 50, y: 150 },
        end: { x: 200, y: 150 },
      },
    });

    // Cria r-locked (bloqueado diretamente)
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'r-locked',
        type: 'rectangle',
        x: 300,
        y: 20,
        width: 50,
        height: 50,
        rotation: 0,
        locked: true,
      },
    });
  });

  describe('computeMoveDelta', () => {
    it('calcula deslocamento relativo positivo e negativo', () => {
      expect(computeMoveDelta({ x: 10, y: 20 }, { x: 35, y: 5 })).toEqual({
        x: 25,
        y: -15,
      });
    });
  });

  describe('getMovableNodes', () => {
    it('filtra apenas nós desbloqueados', () => {
      const movable = getMovableNodes(section, ['r1', 'r-locked', 'inexistente']);
      expect(movable.map((n) => n.id)).toEqual(['r1']);
    });

    it('ignora nós pertencentes a camadas bloqueadas', () => {
      // Cria nova camada
      section.dispatch({
        type: 'layer.create',
        layer: { id: 'layer-lock', name: 'Bloqueada' },
      });

      // Cria shape na nova camada
      section.dispatch({
        type: 'shape.create',
        layerId: 'layer-lock',
        shape: {
          id: 'r-in-locked-layer',
          type: 'rectangle',
          x: 400,
          y: 20,
          width: 50,
          height: 50,
          rotation: 0,
        },
      });

      // Bloqueia a camada
      section.dispatch({
        type: 'layer.update',
        id: 'layer-lock',
        patch: { locked: true },
      });

      const movable = getMovableNodes(section, ['r1', 'r-in-locked-layer']);
      expect(movable.map((n) => n.id)).toEqual(['r1']);
    });
  });

  describe('buildMovePreviews e buildMoveCommands', () => {
    it('gera previews e comandos de translação corretos', () => {
      const nodes = getMovableNodes(section, ['r1', 'l1']);
      const delta = { x: 20, y: 30 };

      const previews = buildMovePreviews(nodes, delta);
      expect(previews).toHaveLength(2);
      expect(previews[0]).toMatchObject({ id: 'r1', x: 30, y: 50 });
      expect(previews[1]).toMatchObject({
        id: 'l1',
        start: { x: 70, y: 180 },
        end: { x: 220, y: 180 },
      });

      const commands = buildMoveCommands(nodes, delta);
      expect(commands).toEqual([
        { type: 'shape.update', id: 'r1', patch: { x: 30, y: 50 } },
        {
          type: 'shape.update',
          id: 'l1',
          patch: { start: { x: 70, y: 180 }, end: { x: 220, y: 180 } },
        },
      ]);
    });
  });

  describe('executeMove', () => {
    it('move múltiplos nós com um único commit atômico e permite restauração completa via undo (INPUT-02, INPUT-04)', () => {
      const nodes = getMovableNodes(section, ['r1', 'r2', 'l1']);
      const revBefore = section.getSnapshot().revision;

      executeMove(section, nodes, { x: 40, y: -10 });

      // Avança exatamente 1 revisão
      expect(section.getSnapshot().revision).toBe(revBefore + 1);

      // Posições relativas preservadas
      const r1After = section.getSnapshot().document.nodes['r1'] as RectangleNode;
      const r2After = section.getSnapshot().document.nodes['r2'] as RectangleNode;
      expect(r1After.x).toBe(50);
      expect(r1After.y).toBe(10);
      expect(r2After.x).toBe(190);
      expect(r2After.y).toBe(10);
      // Distância horizontal inicial era 150 - 10 = 140; permanece 190 - 50 = 140
      expect(r2After.x - r1After.x).toBe(140);

      // Undo restaura tudo exatamente ao estado inicial
      const undoRes = section.undo();
      expect(undoRes.ok).toBe(true);
      const r1Restored = section.getSnapshot().document.nodes['r1'] as RectangleNode;
      const r2Restored = section.getSnapshot().document.nodes['r2'] as RectangleNode;
      expect(r1Restored.x).toBe(10);
      expect(r1Restored.y).toBe(20);
      expect(r2Restored.x).toBe(150);
      expect(r2Restored.y).toBe(20);
    });

    it('delta (0, 0) é no-op e não avança a revisão', () => {
      const nodes = getMovableNodes(section, ['r1']);
      const revBefore = section.getSnapshot().revision;

      executeMove(section, nodes, { x: 0, y: 0 });

      expect(section.getSnapshot().revision).toBe(revBefore);
    });
  });
});
