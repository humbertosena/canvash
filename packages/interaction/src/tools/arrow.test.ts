import {
  createCanvasSection,
  type BezierNode,
  type CanvasSectionApi,
  type LineNode,
  type RectangleNode,
} from '@canvash/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractionStateMachine } from '../state-machine.js';
import {
  buildArrowCreateInput,
  buildArrowPreviewShape,
  computeArrowCreation,
  computeNormalizedAnchor,
  findAnchorTargetAtPoint,
  isArrowCreationValid,
} from './arrow.js';

describe('arrow.ts - Ferramenta de Criação de Setas e Âncoras Dinâmicas (Tarefa 47 - INPUT-07)', () => {
  const rectNode: RectangleNode = {
    id: 'box-1',
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

  const lineNode: LineNode = {
    id: 'line-1',
    type: 'line',
    start: { x: 50, y: 50 },
    end: { x: 250, y: 50 },
    visible: true,
    locked: false,
    style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
  };

  describe('computeNormalizedAnchor', () => {
    it('calcula âncora no centro de um retângulo sem rotação', () => {
      const anchor = computeNormalizedAnchor(rectNode, { x: 200, y: 150 });
      expect(anchor).toEqual({ x: 0.5, y: 0.5 });
    });

    it('calcula âncora nas bordas (topo, direita, baixo, esquerda)', () => {
      expect(computeNormalizedAnchor(rectNode, { x: 200, y: 100 })).toEqual({ x: 0.5, y: 0 }); // Topo
      expect(computeNormalizedAnchor(rectNode, { x: 300, y: 150 })).toEqual({ x: 1, y: 0.5 }); // Direita
      expect(computeNormalizedAnchor(rectNode, { x: 200, y: 200 })).toEqual({ x: 0.5, y: 1 }); // Baixo
      expect(computeNormalizedAnchor(rectNode, { x: 100, y: 150 })).toEqual({ x: 0, y: 0.5 }); // Esquerda
    });

    it('calcula âncora considerando a rotação da caixa', () => {
      const rotatedRect: RectangleNode = {
        ...rectNode,
        rotation: Math.PI / 2, // 90 graus
      };
      // Centro está em (200, 150). O centro continua no mesmo lugar.
      const centerAnchor = computeNormalizedAnchor(rotatedRect, { x: 200, y: 150 });
      expect(centerAnchor).toEqual({ x: 0.5, y: 0.5 });
    });

    it('faz clamp em [0, 1] se o ponto estiver fora da caixa', () => {
      const outsideAnchor = computeNormalizedAnchor(rectNode, { x: 500, y: 500 });
      expect(outsideAnchor).toEqual({ x: 1, y: 1 });
    });

    it('projeta âncora proporcionalmente em linha', () => {
      const mid = computeNormalizedAnchor(lineNode, { x: 150, y: 50 });
      expect(mid.x).toBeCloseTo(0.5);
      expect(mid.y).toBeCloseTo(0.5);
    });
  });

  describe('findAnchorTargetAtPoint', () => {
    const document = {
      id: 'doc-1',
      schemaVersion: 1,
      layers: [{ id: 'l1', name: 'Layer 1', visible: true, locked: false, childIds: ['box-1'] }],
      nodes: { 'box-1': rectNode },
    };

    it('encontra nó e deriva âncora quando cursor está sobre o alvo', () => {
      const hitTest = vi.fn().mockReturnValue('box-1');
      const target = findAnchorTargetAtPoint({ x: 200, y: 150 }, document, hitTest);

      expect(target).toBeDefined();
      expect(target?.targetId).toBe('box-1');
      expect(target?.anchor).toEqual({ x: 0.5, y: 0.5 });
      expect(target?.resolvedPoint).toEqual({ x: 200, y: 150 });
    });

    it('ignora o nó se for passado como excludeId (prevenção de auto-vínculo)', () => {
      const hitTest = vi.fn().mockReturnValue('box-1');
      const target = findAnchorTargetAtPoint({ x: 200, y: 150 }, document, hitTest, 'box-1');

      expect(target).toBeUndefined();
    });

    it('ignora o board como alvo de vínculo: a seta não se liga a ele (spec boards, premissa 10)', () => {
      const withBoard = {
        ...document,
        layers: [{ id: 'l1', name: 'Layer 1', visible: true, locked: false, childIds: ['b'] }],
        nodes: {
          b: {
            id: 'b',
            type: 'board' as const,
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            title: 'Board',
            style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
            childIds: [],
            visible: true,
            locked: false,
          },
        },
      };
      const hitBoard = vi.fn().mockReturnValue('b');

      expect(findAnchorTargetAtPoint({ x: 200, y: 150 }, withBoard, hitBoard)).toBeUndefined();
    });

    it('retorna undefined se hitTest não encontrar nada ou nó estiver bloqueado', () => {
      const hitEmpty = vi.fn().mockReturnValue(undefined);
      expect(findAnchorTargetAtPoint({ x: 0, y: 0 }, document, hitEmpty)).toBeUndefined();

      const docLocked = {
        ...document,
        nodes: { 'box-1': { ...rectNode, locked: true } },
      };
      const hitLocked = vi.fn().mockReturnValue('box-1');
      expect(findAnchorTargetAtPoint({ x: 200, y: 150 }, docLocked, hitLocked)).toBeUndefined();
    });
  });

  describe('computeArrowCreation e validação', () => {
    it('cria endpoints livres quando nenhum alvo é atingido', () => {
      const res = computeArrowCreation({
        startWorld: { x: 10, y: 20 },
        currentWorld: { x: 110, y: 120 },
      });

      expect(res.start).toEqual({ x: 10, y: 20 });
      expect(res.end).toEqual({ x: 110, y: 120 });
      expect(res.length).toBeCloseTo(Math.hypot(100, 100));
      expect(isArrowCreationValid(res.length)).toBe(true);
    });

    it('vincula endpoints a nós alvo quando alvos estão presentes', () => {
      const res = computeArrowCreation({
        startWorld: { x: 10, y: 20 },
        currentWorld: { x: 110, y: 120 },
        startTarget: {
          targetId: 'box-1',
          anchor: { x: 0.5, y: 0.5 },
          resolvedPoint: { x: 200, y: 150 },
        },
        endTarget: {
          targetId: 'box-2',
          anchor: { x: 0, y: 0.5 },
          resolvedPoint: { x: 400, y: 150 },
        },
      });

      expect(res.start).toEqual({ targetId: 'box-1', anchor: { x: 0.5, y: 0.5 } });
      expect(res.end).toEqual({ targetId: 'box-2', anchor: { x: 0, y: 0.5 } });
      expect(res.resolvedStart).toEqual({ x: 200, y: 150 });
      expect(res.resolvedEnd).toEqual({ x: 400, y: 150 });
      expect(res.length).toBe(200);
    });

    it('aplica snap em 45 graus quando shiftKey é ativo e endpoint final é livre', () => {
      const res = computeArrowCreation({
        startWorld: { x: 0, y: 0 },
        currentWorld: { x: 100, y: 20 }, // Ângulo próximo de 0 radianos
        shiftKey: true,
      });

      expect(res.resolvedEnd.y).toBeCloseTo(0);
      expect(res.resolvedEnd.x).toBeCloseTo(Math.hypot(100, 20));
    });

    it('rejeita criação com comprimento inferior ao mínimo', () => {
      expect(isArrowCreationValid(1.5, 2)).toBe(false);
      expect(isArrowCreationValid(2.0, 2)).toBe(true);
    });

    it('monta preview e payload de criação com marcadores corretos', () => {
      const preview = buildArrowPreviewShape({
        start: { x: 10, y: 10 },
        end: { x: 100, y: 100 },
      });
      expect(preview.type).toBe('arrow');
      if (preview.type === 'arrow') {
        expect(preview.startMarker).toBe('none');
        expect(preview.endMarker).toBe('arrow');
      }

      const input = buildArrowCreateInput({
        start: { x: 10, y: 10 },
        end: { x: 100, y: 100 },
      });
      expect(input.type).toBe('arrow');
      expect(input.startMarker).toBe('none');
      expect(input.endMarker).toBe('arrow');
      expect(input.style?.stroke).toBe('#111827');
    });
  });

  describe('Integração com InteractionStateMachine', () => {
    let section: CanvasSectionApi;
    let machine: InteractionStateMachine;

    beforeEach(() => {
      section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: rectNode,
      });

      section.setTool('arrow');
      machine = new InteractionStateMachine(section);
    });

    it('indica cursor crosshair quando a ferramenta ativa é arrow', () => {
      expect(machine.getIdleCursor()).toBe('crosshair');
    });

    it('inicia criação de seta no pointerdown e atualiza preview no pointermove', () => {
      // Clica em (10, 10) no vazio
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 10, y: 10 },
        button: 0,
        buttons: 1,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        spaceKey: false,
      });

      expect(machine.getState()).toBe('creating');
      const data = machine.getData();
      expect(data.name).toBe('creating');
      if (data.name === 'creating') {
        expect(data.tool).toBe('arrow');
      }

      // Move para (100, 100)
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 100, y: 100 },
        buttons: 1,
      });

      const preview = section.getPreview();
      expect(preview?.additions).toHaveLength(1);
      expect(preview?.additions?.[0]?.type).toBe('arrow');
    });

    it('cria seta livre no pointerup e seleciona a nova seta', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 10, y: 10 },
        button: 0,
        buttons: 1,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        spaceKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 150, y: 150 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 1,
        point: { x: 150, y: 150 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();

      const snapshot = section.getSnapshot();
      const nodeIds = Object.keys(snapshot.document.nodes);
      expect(nodeIds).toHaveLength(2); // 'box-1' e a nova seta
      const createdArrowId = nodeIds.find((id) => id !== 'box-1')!;
      const arrowNode = snapshot.document.nodes[createdArrowId];
      expect(arrowNode).toBeDefined();
      expect(arrowNode?.type).toBe('arrow');
      expect(snapshot.session.selectedIds).toEqual([createdArrowId]);
    });

    it('vincula início e fim de seta a caixas de nós alvos', () => {
      // Adiciona box-2 ao canvas
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-2',
          type: 'rectangle',
          x: 400,
          y: 100,
          width: 200,
          height: 100,
          rotation: 0,
          style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
      expect(res.ok).toBe(true);

      // Inicia sobre box-1 (200, 150 = centro)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 150 },
        button: 0,
        buttons: 1,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        spaceKey: false,
      });

      // Solta sobre box-2 (500, 150 = centro de box-2)
      machine.process({
        type: 'POINTER_UP',
        pointerId: 1,
        point: { x: 500, y: 150 },
        button: 0,
      });

      const snapshot = section.getSnapshot();
      const arrowNode = Object.values(snapshot.document.nodes).find(
        (n) => n.type === 'arrow',
      ) as unknown as { start: { targetId: string }; end: { targetId: string } };

      expect(arrowNode).toBeDefined();
      expect(arrowNode.start.targetId).toBe('box-1');
      expect(arrowNode.end.targetId).toBe('box-2');
    });

    it('cancela criação se o arrasto tiver comprimento inferior a 2px', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 50, y: 50 },
        button: 0,
        buttons: 1,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        spaceKey: false,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 1,
        point: { x: 50.5, y: 50.5 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      const nodeCount = Object.keys(section.getSnapshot().document.nodes).length;
      expect(nodeCount).toBe(1); // Nenhuma seta criada
    });
  });
});

describe('âncora normalizada em curva Bézier (Tarefa 110)', () => {
  it('projeta o ponto na corda, como na linha', () => {
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
    expect(computeNormalizedAnchor(curve, { x: 30, y: -50 })).toEqual({ x: 0.3, y: 0.3 });
  });
});

describe('seta não se vincula à curva Bézier (Tarefa 112)', () => {
  it('findAnchorTargetAtPoint ignora a curva', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'bz', type: 'bezier', start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
    });
    const document = section.getSnapshot().document;
    expect(findAnchorTargetAtPoint({ x: 60, y: -22.5 }, document, () => 'bz')).toBeUndefined();
  });
});
