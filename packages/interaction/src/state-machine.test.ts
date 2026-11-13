import {
  createCanvasSection,
  type CanvasSectionApi,
  type RectangleNode,
  type ShapeNode,
  type Viewport,
} from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteractionStateMachine, type InteractionAction } from './state-machine.js';
import type { SnapGuide } from './snapping.js';
import { computeAggregateBounds, getMultiResizeHandles } from './tools/resize-multiple.js';
import { getRotationHandlePoint } from './tools/rotate.js';

describe('InteractionStateMachine - Pan por ponteiro', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;
  let actions: InteractionAction[];

  beforeEach(() => {
    section = createCanvasSection();
    section.setViewport({ x: 100, y: 50, zoom: 1.5 });
    machine = new InteractionStateMachine(section);
    actions = [];
    machine.onAction((action) => actions.push(action));
  });

  it('começa no estado idle sem espaço pressionado', () => {
    expect(machine.getState()).toBe('idle');
    expect(machine.isSpacePressed()).toBe(false);
  });

  describe('ativação por ferramenta hand', () => {
    beforeEach(() => {
      section.setTool('hand');
    });

    it('inicia panning no pointerdown primário e emite CAPTURE_POINTER', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 200 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('panning');
      const data = machine.getData();
      expect(data.name).toBe('panning');
      if (data.name === 'panning') {
        expect(data.source).toBe('hand');
        expect(data.pointerId).toBe(1);
        expect(data.startPoint).toEqual({ x: 200, y: 200 });
        expect(data.startViewport).toEqual({ x: 100, y: 50, zoom: 1.5 });
      }

      expect(actions).toContainEqual({ type: 'CAPTURE_POINTER', pointerId: 1 });
      expect(actions).toContainEqual({ type: 'SET_CURSOR', cursor: 'grabbing' });
    });

    it('move o viewport com deslocamento relativo durante o pointermove', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 200 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 250, y: 180 },
        buttons: 1,
      });

      const expectedViewport: Viewport = { x: 150, y: 30, zoom: 1.5 };
      expect(section.getSnapshot().session.viewport).toEqual(expectedViewport);
      expect(actions).toContainEqual({ type: 'SET_VIEWPORT', viewport: expectedViewport });
    });

    it('ignora pointermove de outro pointerId', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 200 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 99,
        point: { x: 500, y: 500 },
        buttons: 1,
      });

      expect(section.getSnapshot().session.viewport).toEqual({ x: 100, y: 50, zoom: 1.5 });
    });

    it('finaliza o pan no pointerup e libera captura', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 200 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 250, y: 220 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 1,
        point: { x: 250, y: 220 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().session.viewport).toEqual({ x: 150, y: 70, zoom: 1.5 });
      expect(actions).toContainEqual({ type: 'RELEASE_POINTER', pointerId: 1 });
      expect(actions).toContainEqual({ type: 'SET_CURSOR', cursor: 'grab' });
    });

    it('com hand ativa, soltar o pan devolve o cursor grab e não default', () => {
      const cursors: string[] = [];
      machine.onAction((action) => {
        if (action.type === 'SET_CURSOR') cursors.push(action.cursor);
      });

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 200 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      machine.process({ type: 'POINTER_UP', pointerId: 1, point: { x: 200, y: 200 }, button: 0 });

      expect(cursors).toEqual(['grabbing', 'grab']);
    });

    it('com hand ativa, cancelar o pan devolve o cursor grab', () => {
      const cursors: string[] = [];
      machine.onAction((action) => {
        if (action.type === 'SET_CURSOR') cursors.push(action.cursor);
      });

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 200 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      machine.process({ type: 'POINTER_CANCEL', pointerId: 1 });

      expect(cursors).toEqual(['grabbing', 'grab']);
    });

    it('com hand ativa, soltar o Espaço em repouso mantém o cursor grab', () => {
      const cursors: string[] = [];
      machine.onAction((action) => {
        if (action.type === 'SET_CURSOR') cursors.push(action.cursor);
      });

      machine.process({ type: 'KEY_DOWN', key: ' ', code: 'Space' });
      machine.process({ type: 'KEY_UP', key: ' ', code: 'Space' });

      expect(cursors).toEqual(['grab', 'grab']);
    });

    it('restaura o viewport original ao cancelar por Escape ou POINTER_CANCEL', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 200 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 300, y: 300 },
        buttons: 1,
      });

      expect(section.getSnapshot().session.viewport).toEqual({ x: 200, y: 150, zoom: 1.5 });

      machine.process({
        type: 'KEY_DOWN',
        key: 'Escape',
        code: 'Escape',
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().session.viewport).toEqual({ x: 100, y: 50, zoom: 1.5 });
      expect(actions).toContainEqual({ type: 'RELEASE_POINTER', pointerId: 1 });
    });
  });

  describe('ativação por botão do meio (wheel click)', () => {
    it('faz pan mesmo com ferramenta select ativa', () => {
      section.setTool('select');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 2,
        pointerType: 'mouse',
        point: { x: 100, y: 100 },
        button: 1,
        buttons: 4,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('panning');
      const data = machine.getData();
      if (data.name === 'panning') {
        expect(data.source).toBe('middle');
      }

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 2,
        point: { x: 120, y: 80 },
        buttons: 4,
      });

      expect(section.getSnapshot().session.viewport).toEqual({ x: 120, y: 30, zoom: 1.5 });

      machine.process({
        type: 'POINTER_CANCEL',
        pointerId: 2,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().session.viewport).toEqual({ x: 100, y: 50, zoom: 1.5 });
    });
  });

  describe('ativação por tecla Space + arrastar', () => {
    it('muda cursor para grab ao pressionar Space e volta a default no keyup', () => {
      machine.process({ type: 'KEY_DOWN', key: ' ', code: 'Space' });
      expect(machine.isSpacePressed()).toBe(true);
      expect(actions).toContainEqual({ type: 'SET_CURSOR', cursor: 'grab' });

      machine.process({ type: 'KEY_UP', key: ' ', code: 'Space' });
      expect(machine.isSpacePressed()).toBe(false);
      expect(actions).toContainEqual({ type: 'SET_CURSOR', cursor: 'default' });
    });

    it('inicia pan com spaceKey ativo e botão primário', () => {
      section.setTool('rectangle');

      machine.process({ type: 'KEY_DOWN', key: ' ', code: 'Space' });

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 3,
        pointerType: 'mouse',
        point: { x: 300, y: 300 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('panning');
      const data = machine.getData();
      if (data.name === 'panning') {
        expect(data.source).toBe('space');
      }

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 3,
        point: { x: 320, y: 310 },
        buttons: 1,
      });

      expect(section.getSnapshot().session.viewport).toEqual({ x: 120, y: 60, zoom: 1.5 });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 3,
        point: { x: 320, y: 310 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(actions).toContainEqual({ type: 'SET_CURSOR', cursor: 'grab' });
    });
  });

  describe('comportamentos de segurança e ciclo de vida', () => {
    it('não inicia pan com botão secundário (botão direito)', () => {
      section.setTool('hand');
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 10, y: 10 },
        button: 2,
        buttons: 2,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('idle');
    });

    it('ignora pointermove e pointerup quando em idle', () => {
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 50, y: 50 },
        buttons: 0,
      });
      expect(machine.getState()).toBe('idle');

      machine.process({
        type: 'POINTER_UP',
        pointerId: 1,
        point: { x: 50, y: 50 },
        button: 0,
      });
      expect(machine.getState()).toBe('idle');
    });

    it('ignora pointerdown adicional se já estiver em panning', () => {
      section.setTool('hand');
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 10, y: 10 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      expect(machine.getState()).toBe('panning');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 2,
        pointerType: 'mouse',
        point: { x: 30, y: 30 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      expect(machine.getState()).toBe('panning');
      const data = machine.getData();
      if (data.name === 'panning') {
        expect(data.pointerId).toBe(1);
      }
    });

    it('ignora pointerup e pointercancel com pointerId diferente durante panning', () => {
      section.setTool('hand');
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 10, y: 10 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 99,
        point: { x: 20, y: 20 },
        button: 0,
      });
      expect(machine.getState()).toBe('panning');

      machine.process({
        type: 'POINTER_CANCEL',
        pointerId: 99,
      });
      expect(machine.getState()).toBe('panning');
    });

    it('trata tecla aleatória sem alterar estado nem cursor', () => {
      machine.process({ type: 'KEY_DOWN', key: 'Enter', code: 'Enter' });
      machine.process({ type: 'KEY_UP', key: 'Enter', code: 'Enter' });
      expect(machine.getState()).toBe('idle');
      expect(machine.isSpacePressed()).toBe(false);
    });

    it('soltar tecla Space durante panning mantém panning ativo sem alterar cursor para default', () => {
      section.setTool('select');
      machine.process({ type: 'KEY_DOWN', key: ' ', code: 'Space' });
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 20, y: 20 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('panning');

      machine.process({ type: 'KEY_UP', key: ' ', code: 'Space' });
      expect(machine.isSpacePressed()).toBe(false);
      expect(machine.getState()).toBe('panning');
      // Cursor deve permanecer grabbing
      const cursorActions = actions.filter((a) => a.type === 'SET_CURSOR');
      expect(cursorActions.at(-1)).toEqual({ type: 'SET_CURSOR', cursor: 'grabbing' });
    });

    it('process({ type: "CANCEL" }) executa o cancelamento', () => {
      section.setTool('hand');
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 10, y: 10 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({ type: 'CANCEL' });
      expect(machine.getState()).toBe('idle');
    });

    it('desinscrever listener de onAction funciona e é seguro desinscrever duas vezes', () => {
      const extraActions: InteractionAction[] = [];
      const unbind = machine.onAction((a) => extraActions.push(a));
      machine.process({ type: 'KEY_DOWN', key: ' ', code: 'Space' });
      expect(extraActions.length).toBe(1);

      unbind();
      unbind(); // Segunda chamada não deve quebrar
      machine.process({ type: 'KEY_UP', key: ' ', code: 'Space' });
      expect(extraActions.length).toBe(1);
    });

    it('cancel explícito em idle não gera efeitos colaterais', () => {
      machine.cancel();
      expect(machine.getState()).toBe('idle');
    });

    it('DESTROY cancela o gesto e desinscreve listeners', () => {
      section.setTool('hand');
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 10, y: 10 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({ type: 'DESTROY' });
      expect(machine.getState()).toBe('idle');

      // Tentar processar ação após destroy não notifica mais listeners
      const postDestroyActions: InteractionAction[] = [];
      machine.onAction((a) => postDestroyActions.push(a));
      // Listener antigo não deve receber nada novo
      const prevLength = actions.length;
      machine.process({ type: 'KEY_DOWN', key: ' ', code: 'Space' });
      expect(postDestroyActions.length).toBe(1);
      expect(actions.length).toBe(prevLength);
    });
  });

  describe('Criação de shapes por arrasto (INPUT-02)', () => {
    it('inicia criação de retângulo com botão primário', () => {
      section.setTool('rectangle');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 5,
        pointerType: 'mouse',
        point: { x: 100, y: 100 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('creating');
      const data = machine.getData();
      expect(data.name).toBe('creating');
      if (data.name === 'creating') {
        expect(data.tool).toBe('rectangle');
        expect(data.pointerId).toBe(5);
        expect(data.shiftKey).toBe(false);
      }
      expect(actions).toContainEqual({ type: 'CAPTURE_POINTER', pointerId: 5 });
      expect(actions).toContainEqual({ type: 'SET_CURSOR', cursor: 'crosshair' });
    });

    it('atualiza o preview a cada pointermove sem commitar no documento', () => {
      section.setTool('rectangle');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 5,
        pointerType: 'mouse',
        point: { x: 100, y: 100 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Simula 20 eventos de movimento
      for (let i = 1; i <= 20; i++) {
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 5,
          point: { x: 100 + i * 5, y: 100 + i * 4 },
          buttons: 1,
        });
      }

      // Nenhuma alteração persistida no documento ainda
      expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(0);
      expect(section.getSnapshot().revision).toBe(0);

      // Mas o preview existe
      const preview = section.getPreview();
      expect(preview).not.toBeNull();
      expect(preview?.additions.length).toBe(1);
      expect(preview?.additions[0]?.type).toBe('rectangle');
    });

    it('no pointerup com dimensões válidas comita exatamente 1 shape, limpa preview e seleciona o shape', () => {
      section.setTool('rectangle');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 5,
        pointerType: 'mouse',
        point: { x: 100, y: 100 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 5,
        point: { x: 200, y: 180 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 5,
        point: { x: 200, y: 180 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();

      const nodes = Object.values(section.getSnapshot().document.nodes);
      expect(nodes.length).toBe(1);
      const created = nodes[0]!;
      expect(created.type).toBe('rectangle');
      if (created.type === 'rectangle') {
        expect(created.width).toBeGreaterThan(0);
        expect(created.height).toBeGreaterThan(0);
      }

      // Seleção aponta para o shape criado
      expect(section.getSnapshot().session.selectedIds).toEqual([created.id]);
      expect(section.getSnapshot().history.canUndo).toBe(true);
    });

    it('no pointerup com arrasto menor que minDimension descarta sem comitar', () => {
      section.setTool('rectangle');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 5,
        pointerType: 'mouse',
        point: { x: 100, y: 100 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Apenas 1 pixel de movimento
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 5,
        point: { x: 101, y: 101 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 5,
        point: { x: 101, y: 101 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(0);
      expect(section.getSnapshot().history.canUndo).toBe(false);
    });

    it('cancela criação por Escape, limpando preview sem criar nó', () => {
      section.setTool('ellipse');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 6,
        pointerType: 'mouse',
        point: { x: 100, y: 100 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 6,
        point: { x: 250, y: 250 },
        buttons: 1,
      });

      expect(section.getPreview()).not.toBeNull();

      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(0);
      expect(actions).toContainEqual({ type: 'RELEASE_POINTER', pointerId: 6 });
    });

    it('cancela criação por POINTER_CANCEL, limpando preview sem criar nó', () => {
      section.setTool('line');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 7,
        pointerType: 'mouse',
        point: { x: 50, y: 50 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 7,
        point: { x: 150, y: 150 },
        buttons: 1,
      });

      machine.process({ type: 'POINTER_CANCEL', pointerId: 7 });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(0);
    });

    it('suporta toggle de Shift durante criação para travar proporções no preview', () => {
      section.setTool('rectangle');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 8,
        pointerType: 'mouse',
        point: { x: 0, y: 0 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 8,
        point: { x: 100, y: 50 },
        buttons: 1,
      });

      // Pressiona Shift
      machine.process({ type: 'KEY_DOWN', key: 'Shift', code: 'ShiftLeft' });
      let preview = section.getPreview();
      const rectPreview = preview?.additions[0];
      if (rectPreview && rectPreview.type === 'rectangle') {
        expect(rectPreview.width).toBe(rectPreview.height);
      }

      // Solta Shift
      machine.process({ type: 'KEY_UP', key: 'Shift', code: 'ShiftLeft' });
      preview = section.getPreview();
      const unconstrained = preview?.additions[0];
      if (unconstrained && unconstrained.type === 'rectangle') {
        expect(unconstrained.width).not.toBe(unconstrained.height);
      }
    });
  });

  describe('Seleção por click (Tarefa 31 - INPUT-03)', () => {
    beforeEach(() => {
      section.setTool('select');
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-1',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-2',
          type: 'rectangle',
          x: 200,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-locked',
          type: 'rectangle',
          x: 350,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
          locked: true,
        },
      });
    });

    it('inicia no estado selecting ao pressionar sobre o canvas', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 10,
        pointerType: 'mouse',
        point: { x: 60, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('selecting');
      expect(actions).toContainEqual({ type: 'CAPTURE_POINTER', pointerId: 10 });
    });

    it('click sobre box-1 seleciona box-1', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 10,
        pointerType: 'mouse',
        point: { x: 60, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 10,
        point: { x: 60, y: 60 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().session.selectedIds).toEqual(['box-1']);
    });

    it('click com Shift alterna e acumula seleção', () => {
      section.setSelection(['box-1']);

      // Click com Shift em box-2
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 11,
        pointerType: 'mouse',
        point: { x: 210, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: true,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 11,
        point: { x: 210, y: 60 },
        button: 0,
      });

      expect(section.getSnapshot().session.selectedIds).toEqual(['box-1', 'box-2']);

      // Click com Shift novamente em box-1 desmarca box-1
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 12,
        pointerType: 'mouse',
        point: { x: 60, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: true,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 12,
        point: { x: 60, y: 60 },
        button: 0,
      });

      expect(section.getSnapshot().session.selectedIds).toEqual(['box-2']);
    });

    it('click no vazio sem Shift limpa a seleção', () => {
      section.setSelection(['box-1']);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 13,
        pointerType: 'mouse',
        point: { x: 600, y: 600 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 13,
        point: { x: 600, y: 600 },
        button: 0,
      });

      expect(section.getSnapshot().session.selectedIds).toEqual([]);
    });

    it('movimento acima do threshold de 3 px não executa seleção por click', () => {
      section.setSelection(['box-1']);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 14,
        pointerType: 'mouse',
        point: { x: 210, y: 60 }, // sobre box-2
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Move 5 px (arrasto)
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 14,
        point: { x: 215, y: 60 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 14,
        point: { x: 215, y: 60 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      // Seleção NÃO deve mudar para box-2 porque foi arrasto, e não click puro
      expect(section.getSnapshot().session.selectedIds).toEqual(['box-1']);
    });

    it('cancelar com Escape descarta o gesto sem alterar a seleção', () => {
      section.setSelection(['box-1']);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 15,
        pointerType: 'mouse',
        point: { x: 210, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().session.selectedIds).toEqual(['box-1']);
      expect(actions).toContainEqual({ type: 'RELEASE_POINTER', pointerId: 15 });
    });

    it('click sobre shape bloqueado não é selecionável (INPUT-03)', () => {
      section.setSelection(['box-1']);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 16,
        pointerType: 'mouse',
        point: { x: 360, y: 60 }, // sobre box-locked
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 16,
        point: { x: 360, y: 60 },
        button: 0,
      });

      expect(section.getSnapshot().session.selectedIds).toEqual([]);
    });
  });

  describe('ferramenta select: marquee de seleção (INPUT-03)', () => {
    beforeEach(() => {
      section.setTool('select');
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-1',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-2',
          type: 'rectangle',
          x: 200,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-locked',
          type: 'rectangle',
          x: 350,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
          locked: true,
        },
      });
    });

    it('arrasto no vazio ultrapassando 3px transiciona para estado marquee e atualiza preview', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 20,
        pointerType: 'mouse',
        point: { x: 1, y: 1 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('selecting');
      expect(section.getPreview()).toBeNull();

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 20,
        point: { x: 50, y: 60 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('marquee');
      expect(section.getPreview()?.marquee).toEqual({
        x: 1,
        y: 1,
        width: 49,
        height: 59,
      });
    });

    it('arrasto da esquerda para a direita (Window) exige contenção estrita', () => {
      // Começa em (40, 40) e arrasta até (140, 140)
      // box-1 está em (50, 50, 80, 80) -> 50..130 está contido em 40..140
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 21,
        pointerType: 'mouse',
        point: { x: 40, y: 40 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 21,
        point: { x: 140, y: 140 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 21,
        point: { x: 140, y: 140 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().session.selectedIds).toEqual(['box-1']);
    });

    it('arrasto da direita para a esquerda (Crossing) aceita interseção geométrica', () => {
      // box-2 está em (200, 50, 80, 80) -> x: 200..280, y: 50..130
      // Começa em (250, 40) e arrasta para a esquerda até (180, 100)
      // Retângulo resultante: x: 180..250, y: 40..100
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 22,
        pointerType: 'mouse',
        point: { x: 250, y: 40 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 22,
        point: { x: 180, y: 100 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 22,
        point: { x: 180, y: 100 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      // Em modo Crossing (direita para esquerda), toca box-2 e portanto seleciona box-2
      expect(section.getSnapshot().session.selectedIds).toEqual(['box-2']);
    });

    it('com Shift, o marquee adiciona nós à seleção existente', () => {
      section.setSelection(['box-1']);

      // Arraste com Shift sobre box-2
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 23,
        pointerType: 'mouse',
        point: { x: 190, y: 40 },
        button: 0,
        buttons: 1,
        shiftKey: true,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 23,
        point: { x: 290, y: 140 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 23,
        point: { x: 290, y: 140 },
        button: 0,
      });

      expect(section.getSnapshot().session.selectedIds).toEqual(['box-1', 'box-2']);
    });

    it('cancelar marquee com Escape ou pointercancel limpa o preview sem mudar seleção', () => {
      section.setSelection(['box-1']);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 24,
        pointerType: 'mouse',
        point: { x: 190, y: 40 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 24,
        point: { x: 290, y: 140 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('marquee');
      expect(section.getPreview()?.marquee).toBeDefined();

      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().session.selectedIds).toEqual(['box-1']);
      expect(actions).toContainEqual({ type: 'RELEASE_POINTER', pointerId: 24 });
    });

    it('funciona com zoom 0.05 e zoom 16 convertendo corretamente para coordenadas de mundo', () => {
      // 1. Teste em zoom 0.05 (longe de shapes em coordenadas de mundo)
      section.setViewport({ x: 0, y: 0, zoom: 0.05 });

      // Em tela: (-100, -100) a (-50, -60) -> em mundo (-2000, -2000) a (-1000, -1200)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 25,
        pointerType: 'mouse',
        point: { x: -100, y: -100 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 25,
        point: { x: -50, y: -60 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('marquee');
      expect(section.getPreview()?.marquee).toEqual({
        x: -2000,
        y: -2000,
        width: 1000,
        height: 800,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 25,
        point: { x: -50, y: -60 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().session.selectedIds).toEqual([]);

      // 2. Teste em zoom 16 cobrindo box-1 (50, 50, 80, 80)
      // Com viewport.x = 0, y = 0, zoom = 16:
      // Ponto de mundo (40, 40) vira tela (640, 640)
      // Ponto de mundo (140, 140) vira tela (2240, 2240)
      section.setViewport({ x: 0, y: 0, zoom: 16 });

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 26,
        pointerType: 'mouse',
        point: { x: 640, y: 640 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 26,
        point: { x: 2240, y: 2240 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('marquee');
      expect(section.getPreview()?.marquee).toEqual({
        x: 40,
        y: 40,
        width: 100,
        height: 100,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 26,
        point: { x: 2240, y: 2240 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().session.selectedIds).toEqual(['box-1']);
    });
  });

  describe('ferramenta select: mover seleção (INPUT-02, INPUT-04)', () => {
    beforeEach(() => {
      section.setTool('select');
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-1',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-2',
          type: 'rectangle',
          x: 200,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-locked',
          type: 'rectangle',
          x: 350,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
          locked: true,
        },
      });
    });

    it('arrastar shape acima de 3px transiciona para moving e atualiza preview sem commitar (INPUT-02)', () => {
      section.setSelection(['box-1']);
      const revBefore = section.getSnapshot().revision;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 30,
        pointerType: 'mouse',
        point: { x: 60, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('selecting');
      expect(section.getPreview()).toBeNull();

      // Move 20px no x e 30px no y
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 30,
        point: { x: 80, y: 90 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('moving');
      expect(actions).toContainEqual({ type: 'SET_CURSOR', cursor: 'move' });

      // O preview contém a atualização com as novas coordenadas
      const preview = section.getPreview();
      expect(preview).not.toBeNull();
      expect(preview?.updates['box-1']).toMatchObject({
        x: 70,
        y: 80,
      });

      // O documento real NÃO foi alterado durante o arrasto (INPUT-02)
      expect(section.getSnapshot().revision).toBe(revBefore);
      expect((section.getSnapshot().document.nodes['box-1'] as { x: number }).x).toBe(50);
    });

    it('soltar pointerup comita a translação em commit único e limpa o preview (INPUT-02)', () => {
      section.setSelection(['box-1']);
      const revBefore = section.getSnapshot().revision;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 31,
        pointerType: 'mouse',
        point: { x: 60, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 31,
        point: { x: 80, y: 90 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 31,
        point: { x: 80, y: 90 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();

      // Commit único avançou a revisão em exatamente 1
      expect(section.getSnapshot().revision).toBe(revBefore + 1);
      const moved = section.getSnapshot().document.nodes['box-1'] as { x: number; y: number };
      expect(moved.x).toBe(70);
      expect(moved.y).toBe(80);
    });

    it('arrasto de seleção múltipla move todos os shapes preservando posições relativas (INPUT-04)', () => {
      section.setSelection(['box-1', 'box-2']);
      const revBefore = section.getSnapshot().revision;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 32,
        pointerType: 'mouse',
        point: { x: 60, y: 60 }, // sobre box-1
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Move 40px no x e -20px no y
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 32,
        point: { x: 100, y: 40 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('moving');
      const preview = section.getPreview();
      expect(preview?.updates['box-1']).toMatchObject({ x: 90, y: 30 });
      expect(preview?.updates['box-2']).toMatchObject({ x: 240, y: 30 });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 32,
        point: { x: 100, y: 40 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().revision).toBe(revBefore + 1);

      const b1 = section.getSnapshot().document.nodes['box-1'] as { x: number; y: number };
      const b2 = section.getSnapshot().document.nodes['box-2'] as { x: number; y: number };
      expect(b1.x).toBe(90);
      expect(b1.y).toBe(30);
      expect(b2.x).toBe(240);
      expect(b2.y).toBe(30);
      // Posição relativa preservada: 240 - 90 = 150 (igual a 200 - 50)
      expect(b2.x - b1.x).toBe(150);
    });

    it('undo restaura todos os nós movidos às posições originais em 1 passo (INPUT-04)', () => {
      section.setSelection(['box-1', 'box-2']);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 33,
        pointerType: 'mouse',
        point: { x: 60, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 33,
        point: { x: 100, y: 100 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 33,
        point: { x: 100, y: 100 },
        button: 0,
      });

      // Executa undo
      const undoRes = section.undo();
      expect(undoRes.ok).toBe(true);

      const b1 = section.getSnapshot().document.nodes['box-1'] as { x: number; y: number };
      const b2 = section.getSnapshot().document.nodes['box-2'] as { x: number; y: number };
      expect(b1.x).toBe(50);
      expect(b1.y).toBe(50);
      expect(b2.x).toBe(200);
      expect(b2.y).toBe(50);
    });

    it('cancelar por Escape ou POINTER_CANCEL descarta a movimentação sem commitar', () => {
      section.setSelection(['box-1']);
      const revBefore = section.getSnapshot().revision;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 34,
        pointerType: 'mouse',
        point: { x: 60, y: 60 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 34,
        point: { x: 120, y: 120 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('moving');
      expect(section.getPreview()).not.toBeNull();

      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(revBefore);

      const b1 = section.getSnapshot().document.nodes['box-1'] as { x: number; y: number };
      expect(b1.x).toBe(50);
      expect(b1.y).toBe(50);
    });

    it('tentar arrastar forma bloqueada não transiciona para moving', () => {
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 35,
        pointerType: 'mouse',
        point: { x: 360, y: 60 }, // sobre box-locked
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 35,
        point: { x: 420, y: 120 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('selecting');
      expect(section.getPreview()).toBeNull();

      machine.process({
        type: 'POINTER_UP',
        pointerId: 35,
        point: { x: 420, y: 120 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      const bLocked = section.getSnapshot().document.nodes['box-locked'] as {
        x: number;
        y: number;
      };
      expect(bLocked.x).toBe(350);
      expect(bLocked.y).toBe(50);
    });
  });

  describe('ferramenta select: resize de shape única (Tarefa 34)', () => {
    let capturedActions: InteractionAction[] = [];

    beforeEach(() => {
      section.setTool('select');
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-1',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });
      capturedActions = [];
      machine.onAction((action) => {
        capturedActions.push(action);
      });
    });

    it('clicar sobre handle se de shape selecionado transiciona para resizing e emite cursor correspondente', () => {
      // box-1: x: 50, y: 50, width: 100, height: 100. Handle se está em (150, 150)
      section.setSelection(['box-1']);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 40,
        pointerType: 'mouse',
        point: { x: 150, y: 150 }, // exatamente sobre handle se
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('resizing');
      const cursorAction = capturedActions.find((a) => a.type === 'SET_CURSOR');
      expect(cursorAction).toBeDefined();
      expect((cursorAction as { cursor: string }).cursor).toBe('nwse-resize');
    });

    it('atualiza preview durante pointermove sem alterar documento e comita em commit único no pointerup (INPUT-02)', () => {
      section.setSelection(['box-1']);
      const revBefore = section.getSnapshot().revision;

      // Inicia resize em se (150, 150)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 41,
        pointerType: 'mouse',
        point: { x: 150, y: 150 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Move handle se para (200, 180) -> width: 150, height: 130
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 41,
        point: { x: 200, y: 180 },
        buttons: 1,
      });

      // Preview reflete a nova dimensão
      const preview = section.getPreview();
      expect(preview).not.toBeNull();
      expect(preview?.updates['box-1']).toMatchObject({
        x: 50,
        y: 50,
        width: 150,
        height: 130,
      });

      // Documento real não foi mutado durante o gesto
      expect(section.getSnapshot().revision).toBe(revBefore);
      const b1Before = section.getSnapshot().document.nodes['box-1'] as {
        width: number;
        height: number;
      };
      expect(b1Before.width).toBe(100);
      expect(b1Before.height).toBe(100);

      // Finaliza no pointerup
      machine.process({
        type: 'POINTER_UP',
        pointerId: 41,
        point: { x: 200, y: 180 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();

      // Commit único avançou exatamente 1 revisão
      expect(section.getSnapshot().revision).toBe(revBefore + 1);
      const b1After = section.getSnapshot().document.nodes['box-1'] as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      expect(b1After.x).toBe(50);
      expect(b1After.y).toBe(50);
      expect(b1After.width).toBe(150);
      expect(b1After.height).toBe(130);
    });

    it('preserva proporção 1:1 ao redimensionar com Shift ativo', () => {
      section.setSelection(['box-1']);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 42,
        pointerType: 'mouse',
        point: { x: 150, y: 150 },
        button: 0,
        buttons: 1,
        shiftKey: true,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Move se para (250, 180) -> dx = 200, dy = 130 -> escala máx = 2
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 42,
        point: { x: 250, y: 180 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 42,
        point: { x: 250, y: 180 },
        button: 0,
      });

      const b1 = section.getSnapshot().document.nodes['box-1'] as { width: number; height: number };
      // Proporção original era 100:100 (1:1), deve continuar 1:1
      expect(b1.width).toBe(200);
      expect(b1.height).toBe(200);
    });

    it('cancelar com Escape limpa preview e não comita alterações', () => {
      section.setSelection(['box-1']);
      const revBefore = section.getSnapshot().revision;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 43,
        pointerType: 'mouse',
        point: { x: 150, y: 150 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 43,
        point: { x: 300, y: 300 },
        buttons: 1,
      });

      expect(section.getPreview()).not.toBeNull();

      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(revBefore);

      const b1 = section.getSnapshot().document.nodes['box-1'] as { width: number; height: number };
      expect(b1.width).toBe(100);
      expect(b1.height).toBe(100);
    });

    it('redimensiona endpoint de linha com start fixo ao arrastar end', () => {
      // Adiciona uma linha na camada padrão
      const createRes = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'test-line',
          type: 'line',
          start: { x: 100, y: 100 },
          end: { x: 200, y: 100 },
          style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
        },
      });
      expect(createRes.ok).toBe(true);

      section.setSelection(['test-line']);

      // Clica no handle end (200, 100)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 44,
        pointerType: 'mouse',
        point: { x: 200, y: 100 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('resizing');

      // Move end para (250, 150)
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 44,
        point: { x: 250, y: 150 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 44,
        point: { x: 250, y: 150 },
        button: 0,
      });

      const line = section.getSnapshot().document.nodes['test-line'] as {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      expect(line.start).toEqual({ x: 100, y: 100 });
      expect(line.end).toEqual({ x: 250, y: 150 });
    });
  });

  describe('ferramenta select: resize de seleção múltipla uniforme (Tarefa 35, INPUT-04)', () => {
    beforeEach(() => {
      section.setTool('select');
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-1',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-2',
          type: 'rectangle',
          x: 200,
          y: 50,
          width: 100,
          height: 100,
          rotation: Math.PI / 4, // 45 graus - para validar zero skew
        },
      });
      section.setSelection(['box-1', 'box-2']);
    });

    it('clicar em handle de bounding box agregada transiciona para resizing e emite cursor', () => {
      // Bounds: x: 50, y: 50.. box-2 rotacionado tem cantos calculados.
      // Pegamos o handle se da bounding box agregada
      const nodes = [
        section.getSnapshot().document.nodes['box-1'] as ShapeNode,
        section.getSnapshot().document.nodes['box-2'] as ShapeNode,
      ];
      const bounds = computeAggregateBounds(nodes)!;
      const seHandle = getMultiResizeHandles(bounds).find((h) => h.id === 'se')!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 50,
        pointerType: 'mouse',
        point: { x: seHandle.x, y: seHandle.y },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('resizing');
    });

    it('arrastar atualiza preview em tempo real e comita em 1 transação no pointerup (INPUT-02, INPUT-04)', () => {
      const revBefore = section.getSnapshot().revision;
      const nodes = [
        section.getSnapshot().document.nodes['box-1'] as ShapeNode,
        section.getSnapshot().document.nodes['box-2'] as ShapeNode,
      ];
      const bounds = computeAggregateBounds(nodes)!;
      const seHandle = getMultiResizeHandles(bounds).find((h) => h.id === 'se')!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 51,
        pointerType: 'mouse',
        point: { x: seHandle.x, y: seHandle.y },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Move 50px no X e 50px no Y
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 51,
        point: { x: seHandle.x + 50, y: seHandle.y + 50 },
        buttons: 1,
      });

      // Preview reflete atualizações em ambos os nós
      const preview = section.getPreview();
      expect(preview).not.toBeNull();
      expect('box-1' in (preview?.updates ?? {})).toBe(true);
      expect('box-2' in (preview?.updates ?? {})).toBe(true);

      // Documento real inalterado durante o arrasto
      expect(section.getSnapshot().revision).toBe(revBefore);

      // Finaliza no pointerup
      machine.process({
        type: 'POINTER_UP',
        pointerId: 51,
        point: { x: seHandle.x + 50, y: seHandle.y + 50 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      // Commit único atômico
      expect(section.getSnapshot().revision).toBe(revBefore + 1);

      const b1 = section.getSnapshot().document.nodes['box-1'] as RectangleNode;
      const b2 = section.getSnapshot().document.nodes['box-2'] as RectangleNode;

      expect(b1.width).toBeGreaterThan(100);
      expect(b1.height).toBeGreaterThan(100);

      // Forma rotacionada preserva sua rotação exatamente: zero skew
      expect(b2.rotation).toBe(Math.PI / 4);

      // Desfaz em 1 passo via undo (INPUT-04)
      const undoRes = section.undo();
      expect(undoRes.ok).toBe(true);

      const restored1 = section.getSnapshot().document.nodes['box-1'] as RectangleNode;
      const restored2 = section.getSnapshot().document.nodes['box-2'] as RectangleNode;
      expect(restored1.width).toBe(100);
      expect(restored2.width).toBe(100);
      expect(restored2.rotation).toBe(Math.PI / 4);
    });

    it('cancelar com Escape limpa preview sem gerar histórico', () => {
      const revBefore = section.getSnapshot().revision;
      const nodes = [
        section.getSnapshot().document.nodes['box-1'] as ShapeNode,
        section.getSnapshot().document.nodes['box-2'] as ShapeNode,
      ];
      const bounds = computeAggregateBounds(nodes)!;
      const seHandle = getMultiResizeHandles(bounds).find((h) => h.id === 'se')!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 52,
        pointerType: 'mouse',
        point: { x: seHandle.x, y: seHandle.y },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 52,
        point: { x: seHandle.x + 100, y: seHandle.y + 100 },
        buttons: 1,
      });

      expect(section.getPreview()).not.toBeNull();

      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(revBefore);
    });

    it('cancela redimensionamento múltiplo ao receber POINTER_CANCEL', () => {
      const nodes = [
        section.getSnapshot().document.nodes['box-1'] as ShapeNode,
        section.getSnapshot().document.nodes['box-2'] as ShapeNode,
      ];
      const bounds = computeAggregateBounds(nodes)!;
      const seHandle = getMultiResizeHandles(bounds).find((h) => h.id === 'se')!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 53,
        pointerType: 'mouse',
        point: { x: seHandle.x, y: seHandle.y },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 53,
        point: { x: seHandle.x + 50, y: seHandle.y + 50 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('resizing');
      expect(section.getPreview()).not.toBeNull();

      machine.process({
        type: 'POINTER_CANCEL',
        pointerId: 53,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
    });
  });

  describe('Rotação de seleção única e múltipla na máquina de estados (Tarefa 36 - INPUT-04)', () => {
    let section: CanvasSectionApi;
    let machine: InteractionStateMachine;
    let actions: InteractionAction[];

    beforeEach(() => {
      section = createCanvasSection();
      section.setViewport({ x: 0, y: 0, zoom: 1 });
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
      machine = new InteractionStateMachine(section);
      actions = [];
      machine.onAction((act) => actions.push(act));
    });

    it('clicar no handle de rotação de forma única transiciona para rotating e comita no pointerup', () => {
      section.setSelection(['box-a']);
      const node = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      const rotHandle = getRotationHandlePoint([node], 1)!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 60,
        pointerType: 'mouse',
        point: rotHandle,
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('rotating');
      expect(actions).toContainEqual({ type: 'SET_CURSOR', cursor: 'crosshair' });

      // Move 45 graus (pi/4) ao redor do centro (150, 150)
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 60,
        point: { x: 200, y: 100 },
        buttons: 1,
      });

      expect(section.getPreview()).not.toBeNull();
      const revBefore = section.getSnapshot().revision;

      // Finaliza no pointerup
      machine.process({
        type: 'POINTER_UP',
        pointerId: 60,
        point: { x: 200, y: 100 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(revBefore + 1);

      const rotated = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      expect(rotated.rotation).not.toBe(0);

      // Desfaz via undo
      const undoRes = section.undo();
      expect(undoRes.ok).toBe(true);
      const restored = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      expect(restored.rotation).toBe(0);
    });

    it('Shift limita a rotação a passos de 15° na máquina de estados', () => {
      section.setSelection(['box-a']);
      const node = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      const rotHandle = getRotationHandlePoint([node], 1)!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 61,
        pointerType: 'mouse',
        point: rotHandle,
        button: 0,
        buttons: 1,
        shiftKey: true,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Move ponteiro
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 61,
        point: { x: 200, y: 100 },
        buttons: 1,
      });

      machine.process({
        type: 'POINTER_UP',
        pointerId: 61,
        point: { x: 200, y: 100 },
        button: 0,
      });

      const rotated = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      const STEP_15_DEG = Math.PI / 12;
      const remainder = Math.abs(rotated.rotation % STEP_15_DEG);
      expect(remainder < 0.0001 || Math.abs(remainder - STEP_15_DEG) < 0.0001).toBe(true);
    });

    it('rotaciona múltiplos shapes preservando posições relativas (INPUT-04)', () => {
      section.setSelection(['box-a', 'box-b']);
      const nodes = [
        section.getSnapshot().document.nodes['box-a'] as ShapeNode,
        section.getSnapshot().document.nodes['box-b'] as ShapeNode,
      ];
      const rotHandle = getRotationHandlePoint(nodes, 1)!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 62,
        pointerType: 'mouse',
        point: rotHandle,
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('rotating');

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 62,
        point: { x: rotHandle.x + 100, y: rotHandle.y },
        buttons: 1,
      });

      const revBefore = section.getSnapshot().revision;
      machine.process({
        type: 'POINTER_UP',
        pointerId: 62,
        point: { x: rotHandle.x + 100, y: rotHandle.y },
        button: 0,
      });

      expect(section.getSnapshot().revision).toBe(revBefore + 1);

      const rA = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      const rB = section.getSnapshot().document.nodes['box-b'] as RectangleNode;
      expect(rA.rotation).not.toBe(0);
      expect(rB.rotation).not.toBe(0);

      // Desfaz em 1 passo de undo
      const undoRes = section.undo();
      expect(undoRes.ok).toBe(true);
      const resA = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      const resB = section.getSnapshot().document.nodes['box-b'] as RectangleNode;
      expect(resA.rotation).toBe(0);
      expect(resB.rotation).toBe(0);
    });

    it('Escape cancela a rotação sem comitar', () => {
      section.setSelection(['box-a']);
      const node = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      const rotHandle = getRotationHandlePoint([node], 1)!;
      const revBefore = section.getSnapshot().revision;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 63,
        pointerType: 'mouse',
        point: rotHandle,
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 63,
        point: { x: 200, y: 100 },
        buttons: 1,
      });

      expect(section.getPreview()).not.toBeNull();

      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(revBefore);
    });

    it('POINTER_CANCEL cancela a rotação', () => {
      section.setSelection(['box-a']);
      const node = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
      const rotHandle = getRotationHandlePoint([node], 1)!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 64,
        pointerType: 'mouse',
        point: rotHandle,
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      machine.process({
        type: 'POINTER_CANCEL',
        pointerId: 64,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
    });

    describe('cursor no hover em estado idle com ferramenta select', () => {
      it('atualiza cursor para crosshair, resize, move e default em nó único', () => {
        section.setSelection(['box-a']);
        const node = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
        const rotHandle = getRotationHandlePoint([node], 1)!;

        // 1. Hover sobre rotação
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 1,
          point: rotHandle,
          buttons: 0,
        });
        const lastAction1 = actions[actions.length - 1];
        expect(lastAction1).toEqual({ type: 'SET_CURSOR', cursor: 'crosshair' });

        // 2. Hover sobre handle de redimensionamento canto inferior direito (br)
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 1,
          point: { x: 200, y: 200 },
          buttons: 0,
        });
        const lastAction2 = actions[actions.length - 1];
        expect(lastAction2?.type).toBe('SET_CURSOR');
        expect((lastAction2 as { cursor: string }).cursor).toContain('resize');

        // 3. Hover sobre corpo do nó selecionado
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 1,
          point: { x: 150, y: 150 },
          buttons: 0,
        });
        const lastAction3 = actions[actions.length - 1];
        expect(lastAction3).toEqual({ type: 'SET_CURSOR', cursor: 'move' });

        // 4. Hover fora da seleção
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 1,
          point: { x: 10, y: 10 },
          buttons: 0,
        });
        const lastAction4 = actions[actions.length - 1];
        expect(lastAction4).toEqual({ type: 'SET_CURSOR', cursor: 'default' });
      });

      it('atualiza cursor para crosshair, resize, move e default em seleção múltipla', () => {
        section.setSelection(['box-a', 'box-b']);
        const nodeA = section.getSnapshot().document.nodes['box-a'] as RectangleNode;
        const nodeB = section.getSnapshot().document.nodes['box-b'] as RectangleNode;
        const rotHandle = getRotationHandlePoint([nodeA, nodeB], 1)!;

        // 1. Hover sobre rotação agregada
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 1,
          point: rotHandle,
          buttons: 0,
        });
        const lastAction1 = actions[actions.length - 1];
        expect(lastAction1).toEqual({ type: 'SET_CURSOR', cursor: 'crosshair' });

        // 2. Hover sobre handle de redimensionamento agregado (br = 400, 200)
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 1,
          point: { x: 400, y: 200 },
          buttons: 0,
        });
        const lastAction2 = actions[actions.length - 1];
        expect(lastAction2?.type).toBe('SET_CURSOR');
        expect((lastAction2 as { cursor: string }).cursor).toContain('resize');

        // 3. Hover sobre nó box-b da seleção múltipla
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 1,
          point: { x: 350, y: 150 },
          buttons: 0,
        });
        const lastAction3 = actions[actions.length - 1];
        expect(lastAction3).toEqual({ type: 'SET_CURSOR', cursor: 'move' });

        // 4. Hover fora da seleção múltipla
        machine.process({
          type: 'POINTER_MOVE',
          pointerId: 1,
          point: { x: 10, y: 10 },
          buttons: 0,
        });
        const lastAction4 = actions[actions.length - 1];
        expect(lastAction4).toEqual({ type: 'SET_CURSOR', cursor: 'default' });
      });
    });

    describe('Edição de Texto (Tarefa 43 - INPUT-06)', () => {
      it('inicia criação de texto com a ferramenta text e comita novo nó atomicamente', () => {
        section.setTool('text');
        const actions: unknown[] = [];
        machine.onAction((act) => actions.push(act));

        // 1. Pointer down para criar texto
        machine.process({
          type: 'POINTER_DOWN',
          pointerId: 10,
          pointerType: 'mouse',
          point: { x: 200, y: 150 },
          button: 0,
          buttons: 1,
          shiftKey: false,
          spaceKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        });
        expect(machine.getState()).toBe('creating');

        // 2. Pointer up abre sessão de edição de novo texto
        machine.process({
          type: 'POINTER_UP',
          pointerId: 10,
          point: { x: 350, y: 180 },
          button: 0,
        });

        expect(machine.getState()).toBe('editing-text');
        const startAct = actions.find((a) => (a as { type: string }).type === 'START_TEXT_EDIT') as
          { type: string; isNew: boolean; node: { width: number } } | undefined;
        expect(startAct).toBeDefined();
        expect(startAct?.isNew).toBe(true);
        expect(startAct?.node.width).toBe(150);

        const revBefore = section.getSnapshot().revision;

        // 3. Comita o texto digitado
        machine.commitTextEdit('Primeiro texto canvash\nSegunda linha');

        expect(machine.getState()).toBe('idle');
        expect(section.getSnapshot().session.activeTool).toBe('select');
        expect(section.getSnapshot().revision).toBe(revBefore + 1);

        const sel = section.getSnapshot().session.selectedIds;
        expect(sel.length).toBe(1);
        const createdNode = section.getSnapshot().document.nodes[sel[0]!] as {
          type: string;
          text: string;
          width: number;
        };
        expect(createdNode.type).toBe('text');
        expect(createdNode.text).toBe('Primeiro texto canvash\nSegunda linha');
        expect(createdNode.width).toBe(150);
      });

      it('descarta criação de texto novo se o conteúdo for vazio', () => {
        section.setTool('text');
        machine.process({
          type: 'POINTER_DOWN',
          pointerId: 11,
          pointerType: 'mouse',
          point: { x: 100, y: 100 },
          button: 0,
          buttons: 1,
          shiftKey: false,
          spaceKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        });
        machine.process({
          type: 'POINTER_UP',
          pointerId: 11,
          point: { x: 100, y: 100 },
          button: 0,
        });

        expect(machine.getState()).toBe('editing-text');
        const revBefore = section.getSnapshot().revision;

        machine.commitTextEdit('    \n   ');
        expect(machine.getState()).toBe('idle');
        expect(section.getSnapshot().revision).toBe(revBefore);
      });

      it('cancela criação de texto com Escape sem criar nós', () => {
        section.setTool('text');
        machine.process({
          type: 'POINTER_DOWN',
          pointerId: 12,
          pointerType: 'mouse',
          point: { x: 50, y: 50 },
          button: 0,
          buttons: 1,
          shiftKey: false,
          spaceKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        });
        machine.process({
          type: 'POINTER_UP',
          pointerId: 12,
          point: { x: 50, y: 50 },
          button: 0,
        });

        expect(machine.getState()).toBe('editing-text');
        const revBefore = section.getSnapshot().revision;

        machine.cancel();
        expect(machine.getState()).toBe('idle');
        expect(section.getSnapshot().revision).toBe(revBefore);
      });

      it('duplo clique em nó de texto existente entra em edição e atualiza texto no commit', () => {
        // Insere nó de texto
        section.dispatch({
          type: 'shape.create',
          shape: {
            id: 'txt-existente',
            type: 'text',
            x: 200,
            y: 200,
            width: 300,
            text: 'Texto Original',
            fontSize: 18,
          },
        });

        section.setTool('select');
        const actions: unknown[] = [];
        machine.onAction((act) => actions.push(act));

        // Duplo clique sobre o texto
        machine.process({
          type: 'DOUBLE_CLICK',
          point: { x: 250, y: 210 },
          button: 0,
        });

        expect(machine.getState()).toBe('editing-text');
        const startAct = actions.find((a) => (a as { type: string }).type === 'START_TEXT_EDIT') as
          { type: string; isNew: boolean; node: { id: string } } | undefined;
        expect(startAct).toBeDefined();
        expect(startAct?.isNew).toBe(false);
        expect(startAct?.node.id).toBe('txt-existente');

        // Comita alteração
        const revBefore = section.getSnapshot().revision;
        machine.commitTextEdit('Texto Atualizado com Sucesso');

        expect(machine.getState()).toBe('idle');
        expect(section.getSnapshot().revision).toBe(revBefore + 1);

        const updated = section.getSnapshot().document.nodes['txt-existente'] as { text: string };
        expect(updated.text).toBe('Texto Atualizado com Sucesso');

        // Undo restaura texto anterior de forma atômica
        section.undo();
        const reverted = section.getSnapshot().document.nodes['txt-existente'] as { text: string };
        expect(reverted.text).toBe('Texto Original');
      });

      it('cancelar edição de nó de texto existente restaura estado original sem alterar histórico', () => {
        section.dispatch({
          type: 'shape.create',
          shape: {
            id: 'txt-cancelar',
            type: 'text',
            x: 300,
            y: 300,
            width: 200,
            text: 'Texto Seguro',
            fontSize: 16,
          },
        });

        section.setTool('select');
        machine.process({
          type: 'DOUBLE_CLICK',
          point: { x: 350, y: 310 },
          button: 0,
        });

        expect(machine.getState()).toBe('editing-text');
        const revBefore = section.getSnapshot().revision;

        machine.cancel();
        expect(machine.getState()).toBe('idle');
        expect(section.getSnapshot().revision).toBe(revBefore);
        const node = section.getSnapshot().document.nodes['txt-cancelar'] as { text: string };
        expect(node.text).toBe('Texto Seguro');
      });

      it('commitTextEdit com texto em branco em novo nó descarta sem criar shape', () => {
        section.setTool('text');
        machine.process({
          type: 'POINTER_DOWN',
          pointerId: 40,
          pointerType: 'mouse',
          point: { x: 400, y: 400 },
          button: 0,
          buttons: 1,
          shiftKey: false,
          spaceKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        });
        machine.process({
          type: 'POINTER_UP',
          pointerId: 40,
          point: { x: 400, y: 400 },
          button: 0,
        });

        expect(machine.getState()).toBe('editing-text');
        const countBefore = Object.keys(section.getSnapshot().document.nodes).length;
        machine.commitTextEdit('   '); // Somente espaços
        expect(machine.getState()).toBe('idle');
        expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(countBefore);
      });

      it('commitTextEdit com texto idêntico ao original não incrementa revisão', () => {
        section.dispatch({
          type: 'shape.create',
          shape: {
            id: 'txt-mesmo',
            type: 'text',
            x: 50,
            y: 50,
            width: 150,
            text: 'Mesmo Texto',
            fontSize: 16,
          },
        });

        machine.process({
          type: 'DOUBLE_CLICK',
          point: { x: 60, y: 60 },
          button: 0,
        });

        expect(machine.getState()).toBe('editing-text');
        const rev = section.getSnapshot().revision;
        machine.commitTextEdit('Mesmo Texto');
        expect(machine.getState()).toBe('idle');
        expect(section.getSnapshot().revision).toBe(rev);
      });

      it('double click com botão direito ou em readOnly não inicia edição', () => {
        section.dispatch({
          type: 'shape.create',
          shape: {
            id: 'txt-ro',
            type: 'text',
            x: 500,
            y: 500,
            width: 150,
            text: 'Texto RO',
            fontSize: 16,
          },
        });

        // Botão direito (button = 2)
        machine.process({
          type: 'DOUBLE_CLICK',
          point: { x: 510, y: 510 },
          button: 2,
        });
        expect(machine.getState()).toBe('idle');

        // Modo readOnly
        section.setReadOnly(true);
        machine.process({
          type: 'DOUBLE_CLICK',
          point: { x: 510, y: 510 },
          button: 0,
        });
        expect(machine.getState()).toBe('idle');
        section.setReadOnly(false);
      });

      it('double click em área vazia ou em forma que não aceita texto (chave) não inicia edição de texto', () => {
        // Área vazia
        machine.process({
          type: 'DOUBLE_CLICK',
          point: { x: 9999, y: 9999 },
          button: 0,
        });
        expect(machine.getState()).toBe('idle');

        // Chave: o retângulo passou a abrir o editor do texto da forma, a chave não
        section.dispatch({
          type: 'shape.create',
          shape: {
            id: 'rect-dblclick',
            type: 'brace',
            x: 600,
            y: 600,
            width: 100,
            height: 100,
            rotation: 0,
            style: { stroke: '#000000', strokeWidth: 40, opacity: 1 },
          },
        });
        machine.process({
          type: 'DOUBLE_CLICK',
          point: { x: 650, y: 650 },
          button: 0,
        });
        expect(machine.getState()).toBe('idle');
      });

      it('operações de commitTextEdit e cancelTextEdit fora de editing-text são no-op', () => {
        expect(machine.getState()).toBe('idle');
        machine.commitTextEdit('abc');
        expect(machine.getState()).toBe('idle');
        machine.cancelTextEdit();
        expect(machine.getState()).toBe('idle');
      });
    });
  });

  describe('Snapping magnético e guias efêmeras (INPUT-09)', () => {
    let section: CanvasSectionApi;
    let guidesLog: (readonly SnapGuide[])[];

    beforeEach(() => {
      section = createCanvasSection();
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'target-1',
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
          id: 'mov-1',
          type: 'rectangle',
          x: 300,
          y: 100,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });
      guidesLog = [];
    });

    it('ao mover um objeto para perto da borda de outro, aplica atração e emite guias', () => {
      const snapMachine = new InteractionStateMachine(section, {
        snapping: true,
        onGuidesChange: (guides) => guidesLog.push(guides),
      });

      section.setSelection(['mov-1']);
      section.setTool('select');

      // Pointer down dentro de mov-1 (centro: 350, 150)
      snapMachine.process({
        type: 'POINTER_DOWN',
        pointerId: 10,
        pointerType: 'mouse',
        point: { x: 350, y: 150 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(snapMachine.getState()).toBe('selecting');

      // Mover além do limiar de drag (5px).
      // Deslocamos para a esquerda por -97px. Posição raw de mov-1 seria x: 203.
      // Borda direita de target-1 é x: 200. Diferença é 3px (<= 6 CSS px).
      snapMachine.process({
        type: 'POINTER_MOVE',
        pointerId: 10,
        point: { x: 350 - 97, y: 150 },
        buttons: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(snapMachine.getState()).toBe('moving');

      // O preview deve ter x snapado para 200 (ao invés de 203)
      const preview = section.getPreview();
      expect(preview).not.toBeNull();
      const updated = preview?.updates['mov-1'] as RectangleNode;
      expect(updated).toBeDefined();
      expect(updated.x).toBe(200);

      // Deve ter emitido guias efêmeras no eixo x em coordinate: 200
      expect(guidesLog.length).toBeGreaterThan(0);
      const latestGuides = guidesLog[guidesLog.length - 1] ?? [];
      expect(latestGuides.some((g) => g.axis === 'x' && g.coordinate === 200)).toBe(true);

      // Ao soltar o botão (pointerup), comita na posição snapada e limpa as guias
      snapMachine.process({
        type: 'POINTER_UP',
        pointerId: 10,
        point: { x: 350 - 97, y: 150 },
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(snapMachine.getState()).toBe('idle');
      const committed = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(committed.x).toBe(200);

      // Guias limpas
      const finalGuides = guidesLog[guidesLog.length - 1] ?? [];
      expect(finalGuides).toEqual([]);

      // Reversibilidade no histórico
      section.undo();
      const reverted = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(reverted.x).toBe(300);
    });

    it('tecla Alt suspende o snapping magnético durante o movimento', () => {
      const snapMachine = new InteractionStateMachine(section, {
        snapping: true,
        onGuidesChange: (guides) => guidesLog.push(guides),
      });

      section.setSelection(['mov-1']);
      section.setTool('select');

      snapMachine.process({
        type: 'POINTER_DOWN',
        pointerId: 11,
        pointerType: 'mouse',
        point: { x: 350, y: 150 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Mover com altKey: true
      snapMachine.process({
        type: 'POINTER_MOVE',
        pointerId: 11,
        point: { x: 350 - 97, y: 150 },
        buttons: 1,
        shiftKey: false,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
      });

      expect(snapMachine.getState()).toBe('moving');

      // O preview deve ter x não snapado (203)
      const preview = section.getPreview();
      expect(preview).not.toBeNull();
      const updated = preview?.updates['mov-1'] as RectangleNode;
      expect(updated.x).toBe(203);

      // Nenhuma guia ativa
      const latestGuides = guidesLog[guidesLog.length - 1] ?? [];
      expect(latestGuides).toEqual([]);

      snapMachine.process({
        type: 'POINTER_UP',
        pointerId: 11,
        point: { x: 350 - 97, y: 150 },
        button: 0,
        shiftKey: false,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
      });

      const committed = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(committed.x).toBe(203);
    });

    it('snapping durante criação de forma geométrica alinha com alvos de outros objetos', () => {
      const snapMachine = new InteractionStateMachine(section, {
        snapping: true,
        onGuidesChange: (guides) => guidesLog.push(guides),
      });

      section.setTool('rectangle');

      snapMachine.process({
        type: 'POINTER_DOWN',
        pointerId: 12,
        pointerType: 'mouse',
        point: { x: 10, y: 10 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(snapMachine.getState()).toBe('creating');

      // Arrastar para perto de target-1 (left: 100) -> x: 98 (a 2px de 100)
      snapMachine.process({
        type: 'POINTER_MOVE',
        pointerId: 12,
        point: { x: 98, y: 80 },
        buttons: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      const preview = section.getPreview();
      expect(preview).not.toBeNull();
      const addition = preview?.additions[0] as RectangleNode;
      expect(addition).toBeDefined();
      // startX foi 10, snapped endX é 100 -> width deve ser 90
      expect(addition.x + addition.width).toBe(100);

      snapMachine.process({
        type: 'POINTER_UP',
        pointerId: 12,
        point: { x: 98, y: 80 },
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(snapMachine.getState()).toBe('idle');
      // Guias limpas
      const finalGuides = guidesLog[guidesLog.length - 1] ?? [];
      expect(finalGuides).toEqual([]);
    });

    it('snapping a grid atrai quando dentro da tolerância', () => {
      const snapMachine = new InteractionStateMachine(section, {
        snapping: true,
        grid: { enabled: true, size: 50 },
        onGuidesChange: (guides) => guidesLog.push(guides),
      });

      section.setSelection(['mov-1']);
      section.setTool('select');

      snapMachine.process({
        type: 'POINTER_DOWN',
        pointerId: 13,
        pointerType: 'mouse',
        point: { x: 350, y: 150 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Mover 52px para direita: x seria 352 (a 2px da grade 350)
      snapMachine.process({
        type: 'POINTER_MOVE',
        pointerId: 13,
        point: { x: 350 + 52, y: 150 },
        buttons: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      const preview = section.getPreview();
      expect(preview).not.toBeNull();
      const updated = preview?.updates['mov-1'] as RectangleNode;
      expect(updated.x).toBe(350); // atraiu para múltiplo de 50

      snapMachine.process({
        type: 'POINTER_UP',
        pointerId: 13,
        point: { x: 350 + 52, y: 150 },
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      const committed = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(committed.x).toBe(350);
    });
  });

  describe('Snapping magnético durante o redimensionamento (INPUT-09)', () => {
    let section: CanvasSectionApi;
    let guidesLog: (readonly SnapGuide[])[];
    let snapMachine: InteractionStateMachine;

    const press = (pointerId: number, point: { x: number; y: number }): void => {
      snapMachine.process({
        type: 'POINTER_DOWN',
        pointerId,
        pointerType: 'mouse',
        point,
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
    };
    const move = (pointerId: number, point: { x: number; y: number }, altKey = false): void => {
      snapMachine.process({
        type: 'POINTER_MOVE',
        pointerId,
        point,
        buttons: 1,
        shiftKey: false,
        altKey,
        ctrlKey: false,
        metaKey: false,
      });
    };
    const release = (pointerId: number, point: { x: number; y: number }): void => {
      snapMachine.process({
        type: 'POINTER_UP',
        pointerId,
        point,
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
    };
    const latestGuides = (): readonly SnapGuide[] | undefined => guidesLog[guidesLog.length - 1];

    beforeEach(() => {
      section = createCanvasSection();
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.setTool('select');
      // target-1 oferece alvos verticais em x = 100, 150 e 200 e horizontais em y = 100, 150 e 200.
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'target-1',
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
          id: 'mov-1',
          type: 'rectangle',
          x: 300,
          y: 100,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });
      guidesLog = [];
      snapMachine = new InteractionStateMachine(section, {
        snapping: true,
        onGuidesChange: (guides) => guidesLog.push(guides),
      });
    });

    it('alça nw a 3 px da borda direita de outra forma ajusta o ponto à borda e emite a guia', () => {
      section.setSelection(['mov-1']);

      // Alça nw de mov-1 em (300, 100); a âncora oposta (se) fica em (400, 200).
      press(20, { x: 300, y: 100 });
      expect(snapMachine.getState()).toBe('resizing');

      // Primeiro move longe de qualquer alvo: x = 250 está a 50 de 200 e y = 120 a 20 de 100.
      move(20, { x: 250, y: 120 });
      expect(snapMachine.getState()).toBe('resizing');
      const free = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(free.x).toBe(250);
      expect(free.width).toBe(150);
      expect(latestGuides()).toEqual([]);

      // Segundo move a 3 px da borda direita de target-1 (x = 200), dentro dos 6 CSS px.
      move(20, { x: 203, y: 120 });
      const data = snapMachine.getData();
      expect(data.name === 'resizing' ? data.currentWorld : null).toEqual({ x: 200, y: 120 });

      const snapped = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(snapped.x).toBe(200);
      expect(snapped.y).toBe(120);
      expect(snapped.width).toBe(200);
      expect(snapped.height).toBe(80);
      expect(latestGuides()).toEqual([
        {
          axis: 'x',
          coordinate: 200,
          min: 100,
          max: 200,
          targetType: 'object',
          nodeId: 'target-1',
        },
      ]);

      // O commit usa o ponto ajustado e limpa as guias.
      release(20, { x: 203, y: 120 });
      expect(snapMachine.getState()).toBe('idle');
      const committed = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(committed.x).toBe(200);
      expect(committed.width).toBe(200);
      expect(latestGuides()).toEqual([]);
    });

    it('fora da tolerância, contra a própria borda ou com Alt, o redimensionamento não ajusta', () => {
      section.setSelection(['mov-1']);
      press(21, { x: 300, y: 100 });

      // 7 px da borda direita de target-1: acima da tolerância de 6 CSS px.
      move(21, { x: 207, y: 120 });
      const outside = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(outside.x).toBe(207);
      expect(outside.width).toBe(193);
      expect(latestGuides()).toEqual([]);

      // A borda original da forma redimensionada (x = 300) não serve de alvo para ela mesma.
      move(21, { x: 303, y: 125 });
      const self = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(self.x).toBe(303);
      expect(latestGuides()).toEqual([]);

      // Alt suspende o snapping mesmo a 3 px de um alvo.
      move(21, { x: 203, y: 120 }, true);
      const withAlt = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(withAlt.x).toBe(203);
      expect(latestGuides()).toEqual([]);

      release(21, { x: 203, y: 120 });
      const committed = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(committed.x).toBe(203);
    });

    it('seleção múltipla ajusta a alça agregada a outra forma e ignora as formas selecionadas', () => {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'mov-2',
          type: 'rectangle',
          x: 300,
          y: 250,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });
      section.setSelection(['mov-1', 'mov-2']);

      // Caixa agregada (300, 100, 100, 250): alça nw em (300, 100) e âncora se em (400, 350).
      press(22, { x: 300, y: 100 });
      expect(snapMachine.getState()).toBe('resizing');

      // x = 303 estaria a 3 px da borda esquerda de mov-1 e mov-2, mas as duas estão excluídas.
      move(22, { x: 303, y: 125 });
      const unsnapped = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(unsnapped.x).toBeCloseTo(303);
      expect(latestGuides()).toEqual([]);

      // A 3 px da borda direita de target-1: o ponto vai a x = 200 e a escala uniforme fica 2.
      move(22, { x: 203, y: 120 });
      const data = snapMachine.getData();
      expect(data.name === 'resizing' ? data.currentWorld : null).toEqual({ x: 200, y: 120 });
      const scaled1 = section.getPreview()?.updates['mov-1'] as RectangleNode;
      const scaled2 = section.getPreview()?.updates['mov-2'] as RectangleNode;
      expect(scaled1.x).toBe(200);
      expect(scaled1.width).toBe(200);
      expect(scaled2.x).toBe(200);
      expect(scaled2.width).toBe(200);
      expect(latestGuides()).toEqual([
        {
          axis: 'x',
          coordinate: 200,
          min: 100,
          max: 200,
          targetType: 'object',
          nodeId: 'target-1',
        },
      ]);

      release(22, { x: 203, y: 120 });
      expect(snapMachine.getState()).toBe('idle');
      const committed = section.getSnapshot().document.nodes['mov-2'] as RectangleNode;
      expect(committed.x).toBe(200);
      expect(committed.width).toBe(200);
      expect(latestGuides()).toEqual([]);
    });

    it('com zoom 2 a tolerância vale 3 unidades de mundo, os dois eixos ajustam e Alt apaga a guia', () => {
      section.setViewport({ x: 0, y: 0, zoom: 2 });
      section.setSelection(['mov-1']);

      // Alça nw de mov-1 em mundo (300, 100), ou seja, (600, 200) na tela.
      press(23, { x: 600, y: 200 });
      expect(snapMachine.getState()).toBe('resizing');

      // Mundo (204, 120): 4 unidades da borda x = 200, fora dos 6 CSS px / 2 = 3 unidades.
      move(23, { x: 408, y: 240 });
      const outside = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(outside.x).toBe(204);
      expect(outside.width).toBe(196);
      expect(latestGuides()).toEqual([]);

      // Mundo (202.5, 101.5): a 2,5 da borda direita e a 1,5 do topo de target-1.
      move(23, { x: 405, y: 203 });
      const data = snapMachine.getData();
      expect(data.name === 'resizing' ? data.currentWorld : null).toEqual({ x: 200, y: 100 });
      const snapped = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(snapped.x).toBe(200);
      expect(snapped.y).toBe(100);
      expect(snapped.width).toBe(200);
      expect(snapped.height).toBe(100);
      expect(latestGuides()).toEqual([
        {
          axis: 'x',
          coordinate: 200,
          min: 100,
          max: 200,
          targetType: 'object',
          nodeId: 'target-1',
        },
        {
          axis: 'y',
          coordinate: 100,
          min: 100,
          max: 200,
          targetType: 'object',
          nodeId: 'target-1',
        },
      ]);

      // Alt no meio do gesto devolve o ponto bruto e retira a guia que estava visível.
      move(23, { x: 405, y: 203 }, true);
      const withAlt = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(withAlt.x).toBe(202.5);
      expect(withAlt.y).toBe(101.5);
      expect(latestGuides()).toEqual([]);

      release(23, { x: 405, y: 203 });
      const committed = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(committed.x).toBe(202.5);
      expect(committed.y).toBe(101.5);
    });

    it('snapToleranceCssPx configurado amplia a atração do redimensionamento', () => {
      snapMachine = new InteractionStateMachine(section, {
        snapping: true,
        snapToleranceCssPx: 10,
        onGuidesChange: (guides) => guidesLog.push(guides),
      });
      section.setSelection(['mov-1']);
      press(24, { x: 300, y: 100 });
      move(24, { x: 250, y: 120 });

      // 8 px da borda x = 200: fora do padrão de 6 CSS px, dentro dos 10 configurados.
      move(24, { x: 208, y: 120 });
      const snapped = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(snapped.x).toBe(200);
      expect(snapped.width).toBe(200);
      expect(latestGuides()).toEqual([
        {
          axis: 'x',
          coordinate: 200,
          min: 100,
          max: 200,
          targetType: 'object',
          nodeId: 'target-1',
        },
      ]);

      release(24, { x: 208, y: 120 });
      const committed = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(committed.x).toBe(200);
    });

    it('com grade ativa a alça ajusta à linha da grade mais próxima', () => {
      snapMachine = new InteractionStateMachine(section, {
        snapping: true,
        grid: { enabled: true, size: 50 },
        onGuidesChange: (guides) => guidesLog.push(guides),
      });
      section.setSelection(['mov-1']);
      press(25, { x: 300, y: 100 });

      // x = 237 está a 13 da linha 250 e y = 120 a 20 da linha 100: nenhum ajuste.
      move(25, { x: 237, y: 120 });
      const free = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(free.x).toBe(237);
      expect(latestGuides()).toEqual([]);

      move(25, { x: 253, y: 120 });
      const snapped = section.getPreview()?.updates['mov-1'] as RectangleNode;
      expect(snapped.x).toBe(250);
      expect(snapped.width).toBe(150);
      expect(snapped.y).toBe(120);
      expect(latestGuides()).toEqual([{ axis: 'x', coordinate: 250, targetType: 'grid' }]);

      release(25, { x: 253, y: 120 });
      const committed = section.getSnapshot().document.nodes['mov-1'] as RectangleNode;
      expect(committed.x).toBe(250);
      expect(committed.width).toBe(150);
    });
  });

  describe('InteractionStateMachine - Criação de Quadrado (square)', () => {
    it('ativa ferramenta square, define cursor crosshair e cria SquareNode 1:1 no pointerup', () => {
      const sqSection = createCanvasSection();
      const sqMachine = new InteractionStateMachine(sqSection);
      sqSection.setTool('square');

      expect(sqMachine.getIdleCursor()).toBe('crosshair');

      sqMachine.process({
        type: 'POINTER_DOWN',
        pointerId: 77,
        pointerType: 'mouse',
        point: { x: 20, y: 30 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(sqMachine.getState()).toBe('creating');

      sqMachine.process({
        type: 'POINTER_MOVE',
        pointerId: 77,
        point: { x: 100, y: 70 }, // dx=80, dy=40 => side=80
        buttons: 1,
      });

      const preview = sqSection.getPreview();
      expect(preview?.additions[0]).toMatchObject({
        type: 'square',
        x: 20,
        y: 30,
        width: 80,
        height: 80,
      });

      sqMachine.process({
        type: 'POINTER_UP',
        pointerId: 77,
        point: { x: 100, y: 70 },
        button: 0,
      });

      expect(sqMachine.getState()).toBe('idle');
      const selected = sqSection.getSnapshot().session.selectedIds;
      expect(selected).toHaveLength(1);
      const created = sqSection.getSnapshot().document.nodes[selected[0]!];
      expect(created).toMatchObject({
        type: 'square',
        x: 20,
        y: 30,
        width: 80,
        height: 80,
      });
    });
  });

  describe('InteractionStateMachine - Criação de Círculo (circle)', () => {
    it('ativa ferramenta circle, define cursor crosshair e cria CircleNode 1:1 no pointerup', () => {
      const cSection = createCanvasSection();
      const cMachine = new InteractionStateMachine(cSection);
      cSection.setTool('circle');

      expect(cMachine.getIdleCursor()).toBe('crosshair');

      cMachine.process({
        type: 'POINTER_DOWN',
        pointerId: 78,
        pointerType: 'mouse',
        point: { x: 20, y: 30 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(cMachine.getState()).toBe('creating');

      cMachine.process({
        type: 'POINTER_MOVE',
        pointerId: 78,
        point: { x: 100, y: 70 },
        buttons: 1,
      });

      const preview = cSection.getPreview();
      expect(preview?.additions[0]).toMatchObject({
        type: 'circle',
        x: 20,
        y: 30,
        width: 80,
        height: 80,
      });

      cMachine.process({
        type: 'POINTER_UP',
        pointerId: 78,
        point: { x: 100, y: 70 },
        button: 0,
      });

      expect(cMachine.getState()).toBe('idle');
      const selected = cSection.getSnapshot().session.selectedIds;
      expect(selected).toHaveLength(1);
      const created = cSection.getSnapshot().document.nodes[selected[0]!];
      expect(created).toMatchObject({
        type: 'circle',
        x: 20,
        y: 30,
        width: 80,
        height: 80,
      });
    });
  });
});

describe('InteractionStateMachine - Criação de Polígono (polygon)', () => {
  it('ativa ferramenta polygon, define cursor crosshair e cria PolygonNode 1:1 de 5 lados no pointerup', () => {
    const pSection = createCanvasSection();
    const pMachine = new InteractionStateMachine(pSection);
    pSection.setTool('polygon');

    expect(pMachine.getIdleCursor()).toBe('crosshair');

    pMachine.process({
      type: 'POINTER_DOWN',
      pointerId: 79,
      pointerType: 'mouse',
      point: { x: 20, y: 30 },
      button: 0,
      buttons: 1,
      shiftKey: false,
      spaceKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    expect(pMachine.getState()).toBe('creating');

    pMachine.process({ type: 'POINTER_MOVE', pointerId: 79, point: { x: 100, y: 70 }, buttons: 1 });
    expect(pSection.getPreview()?.additions[0]).toMatchObject({
      type: 'polygon',
      sides: 5,
      x: 20,
      y: 30,
      width: 80,
      height: 80,
    });

    pMachine.process({ type: 'POINTER_UP', pointerId: 79, point: { x: 100, y: 70 }, button: 0 });
    expect(pMachine.getState()).toBe('idle');
    const [selected] = pSection.getSnapshot().session.selectedIds;
    expect(pSection.getSnapshot().document.nodes[selected!]).toMatchObject({
      type: 'polygon',
      sides: 5,
      x: 20,
      y: 30,
      width: 80,
      height: 80,
    });
  });
});

describe('InteractionStateMachine - curva Bézier (Tarefa 112)', () => {
  function pointer(type: 'POINTER_DOWN' | 'POINTER_MOVE' | 'POINTER_UP', x: number, y: number) {
    const base = { pointerId: 81, point: { x, y } };
    if (type === 'POINTER_DOWN') {
      return {
        ...base,
        type,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      } as const;
    }
    return type === 'POINTER_MOVE'
      ? ({ ...base, type, buttons: 1 } as const)
      : ({ ...base, type, button: 0 } as const);
  }

  it('a ferramenta bezier cria o arco padrão com preview e um commit', () => {
    const section = createCanvasSection();
    const machine = new InteractionStateMachine(section);
    section.setTool('bezier');
    expect(machine.getIdleCursor()).toBe('crosshair');

    machine.process(pointer('POINTER_DOWN', 20, 100));
    machine.process(pointer('POINTER_MOVE', 140, 100));
    expect(section.getPreview()?.additions[0]).toMatchObject({
      type: 'bezier',
      control1: { x: 60, y: 70 },
      control2: { x: 100, y: 70 },
    });
    machine.process(pointer('POINTER_UP', 140, 100));

    const [id] = section.getSnapshot().session.selectedIds;
    expect(section.getSnapshot().document.nodes[id!]).toMatchObject({
      type: 'bezier',
      start: { x: 20, y: 100 },
      end: { x: 140, y: 100 },
      control1: { x: 60, y: 70 },
      symmetric: true,
    });
    // Um commit só: desfazer uma vez remove a curva e esvazia o histórico
    section.undo();
    expect(section.getSnapshot().document.nodes[id!]).toBeUndefined();
    expect(section.getSnapshot().history.canUndo).toBe(false);
  });

  it('arrastar control1 espelha control2 no preview e no commit, em uma entrada de histórico', () => {
    const section = createCanvasSection();
    const machine = new InteractionStateMachine(section);
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'bz', type: 'bezier', start: { x: 100, y: 200 }, end: { x: 220, y: 200 } },
    });
    section.setSelection(['bz']);

    // control1 do arco padrão: (140, 170)
    machine.process(pointer('POINTER_DOWN', 140, 170));
    machine.process(pointer('POINTER_MOVE', 130, 120));
    expect(section.getPreview()?.updates['bz']).toMatchObject({
      control1: { x: 130, y: 120 },
      control2: { x: 190, y: 120 },
    });
    machine.process(pointer('POINTER_UP', 130, 120));

    expect(section.getSnapshot().document.nodes['bz']).toMatchObject({
      control1: { x: 130, y: 120 },
      control2: { x: 190, y: 120 },
    });
    section.undo();
    expect(section.getSnapshot().document.nodes['bz']).toMatchObject({
      control1: { x: 140, y: 170 },
      control2: { x: 180, y: 170 },
    });
    // O gesto foi uma entrada só: a próxima desfaz a criação
    section.undo();
    expect(section.getSnapshot().document.nodes['bz']).toBeUndefined();
  });

  it('a alça de borda da caixa escala a curva uniformemente', () => {
    const section = createCanvasSection();
    const machine = new InteractionStateMachine(section);
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'bz',
        type: 'bezier',
        start: { x: 100, y: 200 },
        control1: { x: 100, y: 160 },
        end: { x: 200, y: 200 },
      },
    });
    section.setSelection(['bz']);

    // Caixa exata: x 100..200, y 170..200. A alça n em (150, 170) fica longe dos controles
    // (100, 160) e (200, 160); subir 30 dobra a altura em torno da base, no mesmo centro em x.
    machine.process(pointer('POINTER_DOWN', 150, 170));
    machine.process(pointer('POINTER_MOVE', 150, 140));
    machine.process(pointer('POINTER_UP', 150, 140));

    const node = section.getSnapshot().document.nodes['bz'];
    expect(node?.type).toBe('bezier');
    if (node?.type !== 'bezier') return;
    expect(node.start.x).toBeCloseTo(50, 6);
    expect(node.start.y).toBeCloseTo(200, 6);
    expect(node.end.x).toBeCloseTo(250, 6);
    expect(node.control1.x).toBeCloseTo(50, 6);
    expect(node.control1.y).toBeCloseTo(120, 6);
  });
});

describe('InteractionStateMachine - polígonos nomeados (pentagon, hexagon, octagon)', () => {
  const presets = [
    ['pentagon', 5],
    ['hexagon', 6],
    ['octagon', 8],
  ] as const;

  for (const [tool, sides] of presets) {
    it(`a ferramenta ${tool} usa cursor crosshair e cria um polígono 1:1 de ${sides} lados`, () => {
      const section = createCanvasSection();
      const machine = new InteractionStateMachine(section);
      section.setTool(tool);
      expect(machine.getIdleCursor()).toBe('crosshair');

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 91,
        pointerType: 'mouse',
        point: { x: 40, y: 40 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      expect(machine.getState()).toBe('creating');

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 91,
        point: { x: 120, y: 80 },
        buttons: 1,
      });
      expect(section.getPreview()?.additions[0]).toMatchObject({
        type: 'polygon',
        sides,
        width: 80,
        height: 80,
      });

      machine.process({ type: 'POINTER_UP', pointerId: 91, point: { x: 120, y: 80 }, button: 0 });
      expect(machine.getState()).toBe('idle');
      const [selected] = section.getSnapshot().session.selectedIds;
      expect(section.getSnapshot().document.nodes[selected!]).toMatchObject({
        type: 'polygon',
        sides,
        x: 40,
        y: 40,
        width: 80,
        height: 80,
      });
    });
  }
});
