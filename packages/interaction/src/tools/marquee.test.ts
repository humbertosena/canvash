import { describe, expect, it } from 'vitest';
import { createCanvasSection } from '@canvash/core';
import {
  computeMarqueeBounds,
  computeMarqueeMode,
  computeMarqueeSelection,
  executeMarqueeSelection,
  resolveMarqueeGroupIds,
} from './marquee.js';

describe('marquee tool', () => {
  describe('computeMarqueeBounds', () => {
    it('calcula bounds corretos para arrasto de topo-esquerda para baixo-direita', () => {
      const bounds = computeMarqueeBounds({ x: 10, y: 20 }, { x: 50, y: 80 });
      expect(bounds).toEqual({ x: 10, y: 20, width: 40, height: 60 });
    });

    it('calcula bounds corretos para arrasto de baixo-direita para topo-esquerda', () => {
      const bounds = computeMarqueeBounds({ x: 50, y: 80 }, { x: 10, y: 20 });
      expect(bounds).toEqual({ x: 10, y: 20, width: 40, height: 60 });
    });

    it('calcula bounds corretos para arrasto de baixo-esquerda para topo-direita', () => {
      const bounds = computeMarqueeBounds({ x: 10, y: 80 }, { x: 50, y: 20 });
      expect(bounds).toEqual({ x: 10, y: 20, width: 40, height: 60 });
    });

    it('retorna dimensões zero quando os pontos são coincidentes', () => {
      const bounds = computeMarqueeBounds({ x: 15, y: 25 }, { x: 15, y: 25 });
      expect(bounds).toEqual({ x: 15, y: 25, width: 0, height: 0 });
    });
  });

  describe('computeMarqueeMode', () => {
    it('retorna contain quando o arrasto é da esquerda para a direita (Window)', () => {
      expect(computeMarqueeMode({ x: 10, y: 20 }, { x: 50, y: 20 })).toBe('contain');
    });

    it('retorna contain quando x inicial e final são iguais', () => {
      expect(computeMarqueeMode({ x: 30, y: 10 }, { x: 30, y: 50 })).toBe('contain');
    });

    it('retorna intersect quando o arrasto é da direita para a esquerda (Crossing)', () => {
      expect(computeMarqueeMode({ x: 50, y: 20 }, { x: 10, y: 20 })).toBe('intersect');
    });
  });

  describe('computeMarqueeSelection', () => {
    it('substitui a seleção existente pelos nós atingidos quando shiftKey = false', () => {
      const initial = ['s1', 's2'];
      const queried = ['s3', 's4'];
      expect(computeMarqueeSelection(initial, queried, false)).toEqual(['s3', 's4']);
    });

    it('limpa a seleção quando shiftKey = false e nenhum nó é atingido', () => {
      const initial = ['s1'];
      expect(computeMarqueeSelection(initial, [], false)).toEqual([]);
    });

    it('adiciona novos nós à seleção existente preservando unicidade quando shiftKey = true', () => {
      const initial = ['s1', 's2'];
      const queried = ['s2', 's3'];
      expect(computeMarqueeSelection(initial, queried, true)).toEqual(['s1', 's2', 's3']);
    });

    it('preserva a seleção inicial quando shiftKey = true e nenhum nó é atingido', () => {
      const initial = ['s1', 's2'];
      expect(computeMarqueeSelection(initial, [], true)).toEqual(['s1', 's2']);
    });
  });

  describe('executeMarqueeSelection', () => {
    it('seleciona com contenção (Window) e interseção (Crossing) respeitando visibilidade e bloqueio', () => {
      const section = createCanvasSection();

      // Shape 1: retângulo em (10, 10, 40, 40)
      const res1 = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'rect-1',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          rotation: 0,
        },
      });
      expect(res1.ok).toBe(true);
      const id1 = 'rect-1';

      // Shape 2: retângulo em (60, 10, 40, 40)
      const res2 = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'rect-2',
          type: 'rectangle',
          x: 60,
          y: 10,
          width: 40,
          height: 40,
          rotation: 0,
        },
      });
      expect(res2.ok).toBe(true);
      const id2 = 'rect-2';

      // 1. Marquee Window da esquerda para a direita cobrindo id1 completamente e tocando id2
      // Bounds: (0, 0, 80, 60) -> id1 está 100% contido (10..50 <= 80), id2 está em 60..100 (parcialmente dentro de 60..80)
      const windowBounds = { x: 0, y: 0, width: 80, height: 60 };
      executeMarqueeSelection(section, windowBounds, 'contain', false, []);
      expect(section.getSnapshot().session.selectedIds).toEqual([id1]);

      // 2. Marquee Crossing da direita para a esquerda cobrindo a mesma área
      // Deve selecionar id1 E id2 pois ambos intersectam o retângulo
      executeMarqueeSelection(section, windowBounds, 'intersect', false, []);
      expect(section.getSnapshot().session.selectedIds).toEqual([id1, id2]);

      // 3. Seleção incremental com Shift
      section.setSelection([id1]);
      // Marquee cobrindo apenas id2 em Window
      const boxId2 = { x: 55, y: 5, width: 50, height: 50 };
      executeMarqueeSelection(section, boxId2, 'contain', true, [id1]);
      expect(section.getSnapshot().session.selectedIds).toEqual([id1, id2]);
    });

    it('ignora shapes em camadas bloqueadas ou invisíveis', () => {
      const section = createCanvasSection();

      // Cria camada
      section.dispatch({
        type: 'layer.create',
        layer: { id: 'layer-locked', name: 'Bloqueada' },
      });

      // Cria shape na camada
      section.dispatch({
        type: 'shape.create',
        layerId: 'layer-locked',
        shape: {
          id: 'rect-locked',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          rotation: 0,
        },
      });

      // Trava a camada após criar o shape
      section.dispatch({
        type: 'layer.update',
        id: 'layer-locked',
        patch: { locked: true },
      });

      // Shape normal na camada padrão (desbloqueada)
      const defaultLayerId = section.getSnapshot().document.layers[0]!.id;
      const resNorm = section.dispatch({
        type: 'shape.create',
        layerId: defaultLayerId,
        shape: {
          id: 'rect-norm',
          type: 'rectangle',
          x: 60,
          y: 10,
          width: 40,
          height: 40,
          rotation: 0,
        },
      });
      expect(resNorm.ok).toBe(true);

      // Marquee cobrindo ambos
      const bounds = { x: 0, y: 0, width: 200, height: 200 };
      executeMarqueeSelection(section, bounds, 'contain', false, []);
      // Somente o shape desbloqueado deve ser selecionado
      expect(section.getSnapshot().session.selectedIds).toEqual(['rect-norm']);
    });

    it('respeita rotação geométrica no modo contain', () => {
      const section = createCanvasSection();

      // Shape rotacionado a 45 graus (pi/4) com centro em (50, 50) e dimensões 40x40
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'rect-rot',
          type: 'rectangle',
          x: 30,
          y: 30,
          width: 40,
          height: 40,
          rotation: Math.PI / 4,
        },
      });

      // Uma caixa que conteria o retângulo se rotation = 0 (30, 30, 40, 40)
      // MAS como está a 45 graus, seus vértices ultrapassam essa caixa!
      const unrotatedBounds = { x: 30, y: 30, width: 40, height: 40 };
      executeMarqueeSelection(section, unrotatedBounds, 'contain', false, []);
      expect(section.getSnapshot().session.selectedIds).toEqual([]);

      // Já no modo intersect, toca a caixa
      executeMarqueeSelection(section, unrotatedBounds, 'intersect', false, []);
      expect(section.getSnapshot().session.selectedIds).toEqual(['rect-rot']);

      // E com uma caixa grande o suficiente para conter o retângulo rotacionado
      const largeBounds = { x: 15, y: 15, width: 70, height: 70 };
      executeMarqueeSelection(section, largeBounds, 'contain', false, []);
      expect(section.getSnapshot().session.selectedIds).toEqual(['rect-rot']);
    });

    it('no modo intersect, seleciona o grupo quando qualquer membro toca o marquee (INPUT-08)', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'm1', type: 'rectangle', x: 10, y: 10, width: 50, height: 50, rotation: 0 },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'm2',
          type: 'rectangle',
          x: 100,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
        },
      });
      section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['m1', 'm2'] });

      // Marquee que toca apenas m1 (15, 15, 20, 20) no modo intersect
      executeMarqueeSelection(
        section,
        { x: 15, y: 15, width: 20, height: 20 },
        'intersect',
        false,
        [],
      );
      expect(section.getSnapshot().session.selectedIds).toEqual(['grp-1']);
    });

    it('no modo contain, só seleciona o grupo se TODOS os membros estiverem totalmente contidos (INPUT-08)', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'm1', type: 'rectangle', x: 10, y: 10, width: 50, height: 50, rotation: 0 },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'm2',
          type: 'rectangle',
          x: 100,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
        },
      });
      section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['m1', 'm2'] });

      // Marquee que cobre apenas m1 no modo contain -> não deve selecionar grp-1
      executeMarqueeSelection(section, { x: 0, y: 0, width: 70, height: 70 }, 'contain', false, []);
      expect(section.getSnapshot().session.selectedIds).toEqual([]);

      // Marquee que cobre ambos m1 e m2 no modo contain -> seleciona grp-1
      executeMarqueeSelection(
        section,
        { x: 0, y: 0, width: 200, height: 70 },
        'contain',
        false,
        [],
      );
      expect(section.getSnapshot().session.selectedIds).toEqual(['grp-1']);
    });
  });

  describe('resolveMarqueeGroupIds', () => {
    it('devolve IDs não agrupados inalterados', () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });
      const resolved = resolveMarqueeGroupIds(section.getSnapshot().document, ['s1'], 'intersect');
      expect(resolved).toEqual(['s1']);
    });
  });
});
