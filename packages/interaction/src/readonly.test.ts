import { describe, it, expect, beforeEach } from 'vitest';
import { createCanvasSection, type CanvasSectionApi, type RectangleNode } from '@canvash/core';
import { InteractionStateMachine } from './state-machine.js';
import { executeDelete, executeNudge, executeRedo, executeUndo } from './keyboard.js';
import { getRotationHandlePoint } from './tools/rotate.js';

describe('Bloqueio e modo somente leitura (Tarefa 39 - INPUT-10)', () => {
  let section: CanvasSectionApi;

  beforeEach(() => {
    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });

    // Cria camada normal e camada bloqueada
    section.dispatch({
      type: 'layer.create',
      layer: {
        id: 'layer-unlocked',
        name: 'Desbloqueada',
      },
    });

    section.dispatch({
      type: 'layer.create',
      layer: {
        id: 'layer-locked',
        name: 'Bloqueada',
      },
    });

    // Shape na camada antes de bloqueá-la
    section.dispatch({
      type: 'shape.create',
      layerId: 'layer-locked',
      shape: {
        id: 'shape-in-locked-layer',
        type: 'rectangle',
        x: 350,
        y: 50,
        width: 100,
        height: 100,
        rotation: 0,
        locked: false,
      },
    });

    // Bloqueia a segunda camada após conter o shape
    section.dispatch({
      type: 'layer.update',
      id: 'layer-locked',
      patch: { locked: true },
    });

    // Shape desbloqueado na camada desbloqueada
    section.dispatch({
      type: 'shape.create',
      layerId: 'layer-unlocked',
      shape: {
        id: 'shape-normal',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        rotation: 0,
        locked: false,
      },
    });

    // Shape bloqueado na camada desbloqueada
    section.dispatch({
      type: 'shape.create',
      layerId: 'layer-unlocked',
      shape: {
        id: 'shape-locked',
        type: 'rectangle',
        x: 200,
        y: 50,
        width: 100,
        height: 100,
        rotation: 0,
        locked: true,
      },
    });
  });

  describe('Nós e camadas bloqueados', () => {
    it('executeDelete ignora nós bloqueados e nós em camadas bloqueadas', () => {
      // Tenta deletar shape bloqueado
      section.setSelection(['shape-locked']);
      const delLocked = executeDelete(section, ['shape-locked']);
      expect(delLocked).toBe(false);
      expect(section.getSnapshot().document.nodes['shape-locked']).toBeDefined();

      // Tenta deletar shape em camada bloqueada
      section.setSelection(['shape-in-locked-layer']);
      const delLayer = executeDelete(section, ['shape-in-locked-layer']);
      expect(delLayer).toBe(false);
      expect(section.getSnapshot().document.nodes['shape-in-locked-layer']).toBeDefined();

      // Em seleção mista, exclui APENAS o desbloqueado e mantém o bloqueado
      section.setSelection(['shape-normal', 'shape-locked']);
      const delMixed = executeDelete(section, ['shape-normal', 'shape-locked']);
      expect(delMixed).toBe(true);
      expect(section.getSnapshot().document.nodes['shape-normal']).toBeUndefined();
      expect(section.getSnapshot().document.nodes['shape-locked']).toBeDefined();
      expect(section.getSnapshot().session.selectedIds).toEqual(['shape-locked']);
    });

    it('executeNudge ignora nós bloqueados e nós em camadas bloqueadas', () => {
      // Nudge em shape bloqueado
      section.setSelection(['shape-locked']);
      const nudgeLocked = executeNudge(section, ['shape-locked'], 'right', false);
      expect(nudgeLocked).toBe(false);
      expect((section.getSnapshot().document.nodes['shape-locked'] as RectangleNode).x).toBe(200);

      // Nudge em camada bloqueada
      section.setSelection(['shape-in-locked-layer']);
      const nudgeLayer = executeNudge(section, ['shape-in-locked-layer'], 'down', true);
      expect(nudgeLayer).toBe(false);
      expect(
        (section.getSnapshot().document.nodes['shape-in-locked-layer'] as RectangleNode).y,
      ).toBe(50);

      // Em seleção mista, desloca APENAS o desbloqueado
      section.setSelection(['shape-normal', 'shape-locked']);
      const nudgeMixed = executeNudge(section, ['shape-normal', 'shape-locked'], 'right', false);
      expect(nudgeMixed).toBe(true);
      expect((section.getSnapshot().document.nodes['shape-normal'] as RectangleNode).x).toBe(51);
      expect((section.getSnapshot().document.nodes['shape-locked'] as RectangleNode).x).toBe(200);
    });

    it('handles de redimensionamento e rotação não são ativados para shape bloqueado', () => {
      section.setTool('select');
      section.setSelection(['shape-locked']);

      const machine = new InteractionStateMachine(section);

      // Handle SE de shape-locked: (200 + 100, 50 + 100) = (300, 150)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 300, y: 150 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Não entra em resizing
      expect(machine.getState()).not.toBe('resizing');

      // Handle de rotação de shape-locked: (250, 50 - 24) = (250, 26)
      const node = section.getSnapshot().document.nodes['shape-locked'] as RectangleNode;
      const rotHandle = getRotationHandlePoint([node], 1)!;

      const machineRot = new InteractionStateMachine(section);
      machineRot.process({
        type: 'POINTER_DOWN',
        pointerId: 2,
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

      // Não entra em rotating
      expect(machineRot.getState()).not.toBe('rotating');
    });

    it('arrasto sobre shape bloqueado não inicia moving nem marquee', () => {
      section.setTool('select');
      const machine = new InteractionStateMachine(section);

      // Clica dentro de shape-locked: (250, 100)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 3,
        pointerType: 'mouse',
        point: { x: 250, y: 100 },
        button: 0,
        buttons: 1,
        shiftKey: false,
        spaceKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(machine.getState()).toBe('selecting');

      // Arrasta 50px
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 3,
        point: { x: 300, y: 150 },
        buttons: 1,
      });

      // Permanece em selecting, não vira moving nem marquee
      expect(machine.getState()).toBe('selecting');
      expect(section.getPreview()).toBeNull();
    });
  });

  describe('Modo somente leitura (readOnly)', () => {
    beforeEach(() => {
      section.setReadOnly(true);
      expect(section.getSnapshot().session.readOnly).toBe(true);
    });

    it('impede criação de shape com ferramenta rectangle/ellipse/line', () => {
      section.setTool('rectangle');
      const machine = new InteractionStateMachine(section);

      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 10,
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

      // Não inicia criação
      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();

      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 10,
        point: { x: 200, y: 200 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
    });

    it('impede movimentação de shapes selecionados', () => {
      section.setSelection(['shape-normal']);
      section.setTool('select');
      const machine = new InteractionStateMachine(section);

      // Clica em shape-normal: (60, 60)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 11,
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

      // Move além do threshold
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 11,
        point: { x: 120, y: 120 },
        buttons: 1,
      });

      // Não entra em moving
      expect(machine.getState()).toBe('selecting');
      expect(section.getPreview()).toBeNull();

      machine.process({
        type: 'POINTER_UP',
        pointerId: 11,
        point: { x: 120, y: 120 },
        button: 0,
      });

      expect(machine.getState()).toBe('idle');
      expect((section.getSnapshot().document.nodes['shape-normal'] as RectangleNode).x).toBe(50);
    });

    it('impede redimensionamento e rotação via handles', () => {
      section.setSelection(['shape-normal']);
      section.setTool('select');
      const machine = new InteractionStateMachine(section);

      // Handle SE de shape-normal: (150, 150)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 12,
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

      // Não entra em resizing
      expect(machine.getState()).not.toBe('resizing');
    });

    it('impede exclusão, nudge, undo e redo via atalhos de teclado', () => {
      section.setSelection(['shape-normal']);

      expect(executeDelete(section, ['shape-normal'])).toBe(false);
      expect(section.getSnapshot().document.nodes['shape-normal']).toBeDefined();

      expect(executeNudge(section, ['shape-normal'], 'up', false)).toBe(false);
      expect((section.getSnapshot().document.nodes['shape-normal'] as RectangleNode).y).toBe(50);

      expect(executeUndo(section)).toBe(false);
      expect(executeRedo(section)).toBe(false);
    });

    it('mantém navegação por pan e seleção por clique e marquee', () => {
      // 1. Pan funciona
      section.setTool('hand');
      const machinePan = new InteractionStateMachine(section);

      machinePan.process({
        type: 'POINTER_DOWN',
        pointerId: 20,
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

      expect(machinePan.getState()).toBe('panning');

      machinePan.process({
        type: 'POINTER_MOVE',
        pointerId: 20,
        point: { x: 150, y: 120 },
        buttons: 1,
      });

      expect(section.getSnapshot().session.viewport.x).toBe(50);
      machinePan.cancel();

      // 2. Seleção por clique funciona
      section.setTool('select');
      section.setSelection([]);
      const machineSelect = new InteractionStateMachine(section);

      machineSelect.process({
        type: 'POINTER_DOWN',
        pointerId: 21,
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

      machineSelect.process({
        type: 'POINTER_UP',
        pointerId: 21,
        point: { x: 60, y: 60 },
        button: 0,
      });

      expect(section.getSnapshot().session.selectedIds).toEqual(['shape-normal']);

      // 3. Marquee funciona para inspecionar nós
      section.setSelection([]);
      const machineMarquee = new InteractionStateMachine(section);

      machineMarquee.process({
        type: 'POINTER_DOWN',
        pointerId: 22,
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

      machineMarquee.process({
        type: 'POINTER_MOVE',
        pointerId: 22,
        point: { x: 180, y: 180 },
        buttons: 1,
      });

      expect(machineMarquee.getState()).toBe('marquee');
      expect(section.getPreview()).not.toBeNull();

      machineMarquee.process({
        type: 'POINTER_UP',
        pointerId: 22,
        point: { x: 180, y: 180 },
        button: 0,
      });

      expect(machineMarquee.getState()).toBe('idle');
      expect(section.getSnapshot().session.selectedIds).toEqual(['shape-normal']);
    });
  });
});
