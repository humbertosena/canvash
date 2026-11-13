import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi, type RectangleNode } from '@canvash/core';
import { applyPinchPanZoom, computeTouchCenter, computeTouchDistance } from './touch.js';
import { InteractionStateMachine } from './state-machine.js';
import { PointerAdapter } from './pointer.js';

describe('Suporte a Toque, Multitoque e Caneta (Tarefa 40 - INPUT-01, INPUT-05)', () => {
  describe('Funções geométricas puras (touch.ts)', () => {
    it('computeTouchDistance calcula a distância euclidiana correta', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 30, y: 40 };
      expect(computeTouchDistance(p1, p2)).toBe(50);

      const samePoint = { x: 100, y: 100 };
      expect(computeTouchDistance(samePoint, samePoint)).toBe(0);
    });

    it('computeTouchCenter calcula o ponto médio entre dois pontos', () => {
      const p1 = { x: 10, y: 20 };
      const p2 = { x: 30, y: 60 };
      expect(computeTouchCenter(p1, p2)).toEqual({ x: 20, y: 40 });
    });

    it('applyPinchPanZoom aplica pan pelo deslocamento do centro dos dedos', () => {
      const vp = { x: 0, y: 0, zoom: 1 };
      const prevCenter = { x: 100, y: 100 };
      const newCenter = { x: 150, y: 120 };
      const distance = 100;

      const next = applyPinchPanZoom(vp, prevCenter, newCenter, distance, distance);

      expect(next.x).toBe(50);
      expect(next.y).toBe(20);
      expect(next.zoom).toBe(1);
    });

    it('applyPinchPanZoom aplica pinch zoom proporcional à variação de distância', () => {
      const vp = { x: 0, y: 0, zoom: 1 };
      const center = { x: 200, y: 200 };
      const prevDistance = 100;
      const newDistance = 200; // Dobra a distância -> 2x zoom

      const next = applyPinchPanZoom(vp, center, center, prevDistance, newDistance);

      expect(next.zoom).toBe(2);
    });

    it('applyPinchPanZoom respeita os limites de zoomLimits', () => {
      const vp = { x: 0, y: 0, zoom: 1 };
      const center = { x: 100, y: 100 };
      const limits = { min: 0.5, max: 2.0 };

      // Tenta dar 4x de zoom
      const zoomMax = applyPinchPanZoom(vp, center, center, 50, 200, limits);
      expect(zoomMax.zoom).toBe(2.0);

      // Tenta dar 0.1x de zoom
      const zoomMin = applyPinchPanZoom(vp, center, center, 200, 20, limits);
      expect(zoomMin.zoom).toBe(0.5);
    });
  });

  describe('Paridade de Gestos: Mouse, Toque e Caneta (INPUT-01)', () => {
    let section: CanvasSectionApi;
    let machine: InteractionStateMachine;

    beforeEach(() => {
      section = createCanvasSection();
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      machine = new InteractionStateMachine(section);
    });

    it('cria retângulo idêntico por mouse, toque e caneta (INPUT-01)', () => {
      const pointerTypes = ['mouse', 'touch', 'pen'] as const;

      for (const [index, pType] of pointerTypes.entries()) {
        section.setTool('rectangle');
        const revBefore = section.getSnapshot().revision;

        const startX = 50 + index * 100;
        const startY = 50;
        const endX = startX + 80;
        const endY = startY + 60;

        machine.process({
          type: 'POINTER_DOWN',
          pointerId: index + 1,
          pointerType: pType,
          point: { x: startX, y: startY },
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
          pointerId: index + 1,
          point: { x: endX, y: endY },
          buttons: 1,
        });

        expect(section.getPreview()).not.toBeNull();

        machine.process({
          type: 'POINTER_UP',
          pointerId: index + 1,
          point: { x: endX, y: endY },
          button: 0,
        });

        expect(machine.getState()).toBe('idle');
        expect(section.getPreview()).toBeNull();
        expect(section.getSnapshot().revision).toBe(revBefore + 1);

        const createdId = section.getSnapshot().session.selectedIds[0]!;
        const shape = section.getSnapshot().document.nodes[createdId] as RectangleNode;

        expect(shape.type).toBe('rectangle');
        expect(shape.x).toBe(startX);
        expect(shape.y).toBe(startY);
        expect(shape.width).toBe(80);
        expect(shape.height).toBe(60);
      }

      expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(3);
    });

    it('move shape com precisão idêntica por caneta (pen) e por toque (touch)', () => {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'box-target',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });

      section.setTool('select');
      section.setSelection(['box-target']);

      // 1. Move 30px com a caneta (pen)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 10,
        pointerType: 'pen',
        point: { x: 120, y: 120 },
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
        pointerId: 10,
        point: { x: 150, y: 150 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('moving');

      machine.process({
        type: 'POINTER_UP',
        pointerId: 10,
        point: { x: 150, y: 150 },
        button: 0,
      });

      let shape = section.getSnapshot().document.nodes['box-target'] as RectangleNode;
      expect(shape.x).toBe(130);
      expect(shape.y).toBe(130);

      // 2. Move 20px adicionais com toque (touch)
      machine.process({
        type: 'POINTER_DOWN',
        pointerId: 11,
        pointerType: 'touch',
        point: { x: 140, y: 140 },
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
        pointerId: 11,
        point: { x: 160, y: 160 },
        buttons: 1,
      });

      expect(machine.getState()).toBe('moving');

      machine.process({
        type: 'POINTER_UP',
        pointerId: 11,
        point: { x: 160, y: 160 },
        button: 0,
      });

      shape = section.getSnapshot().document.nodes['box-target'] as RectangleNode;
      expect(shape.x).toBe(150);
      expect(shape.y).toBe(150);
    });
  });

  describe('Multitoque no PointerAdapter: Cancelamento no 2º toque e Pinch-Zoom (INPUT-05)', () => {
    let section: CanvasSectionApi;
    let machine: InteractionStateMachine;

    beforeEach(() => {
      section = createCanvasSection();
      section.setViewport({ x: 0, y: 0, zoom: 1 });
      machine = new InteractionStateMachine(section);
    });

    it('segundo toque cancela o preview de edição ativa antes de navegar (INPUT-05)', () => {
      type EventHandler = (event: unknown) => void;
      const listeners = new Map<string, EventHandler>();
      const mockElement = {
        style: { touchAction: 'none', cursor: 'default' },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        addEventListener: vi.fn((type: string, fn: EventHandler) => {
          listeners.set(type, fn);
        }),
        removeEventListener: vi.fn(),
        hasPointerCapture: () => false,
      } as unknown as HTMLElement;

      const adapter = new PointerAdapter({
        element: mockElement,
        stateMachine: machine,
        section,
      });

      section.setTool('rectangle');

      const onDown = listeners.get('pointerdown');
      const onMove = listeners.get('pointermove');
      expect(onDown).toBeDefined();
      expect(onMove).toBeDefined();
      if (!onDown || !onMove) return;

      // 1º toque inicia criação
      onDown({
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      onMove({
        pointerId: 1,
        pointerType: 'touch',
        buttons: 1,
        clientX: 150,
        clientY: 150,
      });

      expect(machine.getState()).toBe('creating');
      expect(section.getPreview()).not.toBeNull();

      // 2º toque toca a tela enquanto o primeiro está ativo
      onDown({
        pointerId: 2,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 300,
        clientY: 300,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // O preview deve ter sido descartado e a máquina voltou para idle!
      expect(machine.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      expect(Object.keys(section.getSnapshot().document.nodes).length).toBe(0);

      adapter.destroy();
    });

    it('dois toques aplicam pan e pinch zoom sincronizados no viewport', () => {
      type EventHandler = (event: unknown) => void;
      const listeners = new Map<string, EventHandler>();
      const mockElement = {
        style: { touchAction: 'none', cursor: 'default' },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        addEventListener: vi.fn((type: string, fn: EventHandler) => {
          listeners.set(type, fn);
        }),
        removeEventListener: vi.fn(),
        hasPointerCapture: () => false,
      } as unknown as HTMLElement;

      const adapter = new PointerAdapter({
        element: mockElement,
        stateMachine: machine,
        section,
      });

      const onDown = listeners.get('pointerdown');
      const onMove = listeners.get('pointermove');
      const onUp = listeners.get('pointerup');
      expect(onDown).toBeDefined();
      expect(onMove).toBeDefined();
      expect(onUp).toBeDefined();
      if (!onDown || !onMove || !onUp) return;

      // Toque 1 em (100, 100)
      onDown({
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 100,
      });

      // Toque 2 em (300, 100) -> distância inicial = 200, centro inicial = (200, 100)
      onDown({
        pointerId: 2,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 300,
        clientY: 100,
      });

      // Afasta os dedos e move para a direita: Toque 1 vai para (50, 100), Toque 2 vai para (450, 100)
      // Nova distância = 400 (zoom dobra!), Novo centro = (250, 100) (pan move 50px no X!)
      onMove({
        pointerId: 1,
        pointerType: 'touch',
        buttons: 1,
        clientX: 50,
        clientY: 100,
      });

      onMove({
        pointerId: 2,
        pointerType: 'touch',
        buttons: 1,
        clientX: 450,
        clientY: 100,
      });

      const vp = section.getSnapshot().session.viewport;
      expect(vp.zoom).toBeGreaterThan(1.5);

      // Levantar um dedo encerra o gesto de pinch
      onUp({
        pointerId: 1,
        pointerType: 'touch',
        clientX: 50,
        clientY: 100,
      });

      expect(machine.getState()).toBe('idle');
      adapter.destroy();
    });
  });
});
