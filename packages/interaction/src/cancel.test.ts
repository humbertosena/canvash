import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi, type RectangleNode } from '@canvash/core';
import { InteractionStateMachine } from './state-machine.js';
import { getRotationHandlePoint } from './tools/rotate.js';

describe('Cancelamento de gestos na Máquina de Estados (INPUT-02, INPUT-05)', () => {
  let section: CanvasSectionApi;

  beforeEach(() => {
    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
  });

  describe('Cancelamento de cada estado', () => {
    it('cancela panning restaurando o viewport original', () => {
      section.setViewport({ x: 100, y: 50, zoom: 1.5 });
      const machine = new InteractionStateMachine(section);
      const initialViewport = section.getSnapshot().session.viewport;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 100, y: 100 },
        button: 1, // middle button
        buttons: 4,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('panning');

      // Move pan
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 250, y: 350 },
        buttons: 4,
      });

      expect(section.getSnapshot().session.viewport.x).not.toBe(initialViewport.x);

      // Cancela
      machine.cancel();

      expect(machine.getState()).toBe('idle');
      expect(section.getSnapshot().session.viewport).toEqual(initialViewport);
    });

    it('cancela criação limpando preview sem criar shape nem alterar revisão', () => {
      const machine = new InteractionStateMachine(section);
      section.setTool('rectangle');
      const initialRev = section.getSnapshot().revision;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
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

      expect(machine.getState()).toBe('creating');

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 150, y: 150 },
        buttons: 1,
      });

      expect(section.getPreview()).not.toBeNull();

      // Cancela por Escape
      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(initialRev);
      const undoRes = section.undo();
      expect(undoRes.ok).toBe(true);
      if (undoRes.ok) {
        expect(undoRes.value.changed).toBe(false);
      }
      expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(0);
    });

    it('cancela movimentação restaurando seleção inicial e sem comitar', () => {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-move',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });

      const shapeId = 'box-move';
      section.setSelection([shapeId]);
      section.setTool('select');
      const revBeforeMove = section.getSnapshot().revision;

      const machine = new InteractionStateMachine(section);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
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

      // Move além do threshold de 3px
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 90, y: 100 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('moving');
      expect(section.getPreview()).not.toBeNull();

      // Cancela via POINTER_CANCEL
      machine.process({ type: 'POINTER_CANCEL', pointerId: 1 });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(revBeforeMove);
      expect((section.getSnapshot().document.nodes[shapeId] as RectangleNode).x).toBe(50);
      expect(section.getSnapshot().session.selectedIds).toEqual([shapeId]);
    });

    it('cancela redimensionamento sem alterar dimensões da shape', () => {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-resize',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });

      const shapeId = 'box-resize';
      section.setSelection([shapeId]);
      section.setTool('select');
      const revBefore = section.getSnapshot().revision;

      const machine = new InteractionStateMachine(section);

      // Handle 'se' em (150, 150)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
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

      expect(machine.getState()).toBe('resizing');

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 250, y: 250 },
        buttons: 1,
      });

      expect(section.getPreview()).not.toBeNull();

      // Cancela via CANCEL explícito
      machine.process({ type: 'CANCEL' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(revBefore);
      expect((section.getSnapshot().document.nodes[shapeId] as RectangleNode).width).toBe(100);
    });

    it('cancela rotação sem alterar ângulo da shape', () => {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-rotate',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });

      const shapeId = 'box-rotate';
      section.setSelection([shapeId]);
      section.setTool('select');
      const revBefore = section.getSnapshot().revision;

      const machine = new InteractionStateMachine(section);

      const node = section.getSnapshot().document.nodes[shapeId] as RectangleNode;
      const rotHandle = getRotationHandlePoint([node], 1)!;

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
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
        pointerId: 1,
        point: { x: 250, y: 150 },
        buttons: 1,
      });

      expect(section.getPreview()).not.toBeNull();

      // Cancela via Escape
      machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().revision).toBe(revBefore);
      expect((section.getSnapshot().document.nodes[shapeId] as RectangleNode).rotation).toBe(0);
    });

    it('cancela marquee de seleção descartando preview e mantendo seleção inicial', () => {
      const machine = new InteractionStateMachine(section);
      section.setTool('select');
      section.setSelection([]);

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
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: { x: 200, y: 200 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('marquee');
      expect(section.getPreview()).not.toBeNull();

      machine.cancel();

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(section.getSnapshot().session.selectedIds).toEqual([]);
    });

    it('DESTROY cancela gesto ativo e limpa todos os listeners', () => {
      const machine = new InteractionStateMachine(section);
      section.setTool('rectangle');
      const actionListener = vi.fn();
      machine.onAction(actionListener);

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

      expect(machine.getState()).toBe('creating');

      machine.process({ type: 'DESTROY' });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();

      // Listeners foram desinscritos
      actionListener.mockClear();
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 2,
        pointerType: 'mouse',
        point: { x: 20, y: 20 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      // Como listeners foram limpos em DESTROY, nenhum actionListener é invocado
      expect(actionListener).not.toHaveBeenCalled();
    });
  });
});
