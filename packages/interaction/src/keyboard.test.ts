import { createCanvasSection, type CanvasPeer } from '@canvash/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  executeDelete,
  executeFitContent,
  executeFitSelection,
  executeGroup,
  executeNudge,
  executeRedo,
  executeReorder,
  executeUndo,
  executeUngroup,
  executeZoomBy,
  executeZoomReset,
  getGroupActions,
  isEditableElement,
  isFocusOnEditor,
  KeyboardAdapter,
  matchKeyboardShortcut,
  type KeyboardShortcutMap,
} from './keyboard.js';

function getRect(section: ReturnType<typeof createCanvasSection>, id: string) {
  const node = section.getSnapshot().document.nodes[id];
  return node && node.type === 'rectangle' ? node : undefined;
}

describe('keyboard.ts - Atalhos de Teclado e Isolamento de Foco (Tarefa 37 - INPUT-10)', () => {
  describe('isEditableElement', () => {
    it('identifica corretamente inputs, textareas e selects', () => {
      expect(isEditableElement({ tagName: 'INPUT' })).toBe(true);
      expect(isEditableElement({ tagName: 'textarea' })).toBe(true);
      expect(isEditableElement({ tagName: 'SELECT' })).toBe(true);
      expect(isEditableElement({ tagName: 'DIV' })).toBe(false);
      expect(isEditableElement(null)).toBe(false);
      expect(isEditableElement(undefined)).toBe(false);
      expect(isEditableElement(123)).toBe(false);
    });

    it('identifica elementos com contenteditable ativo', () => {
      expect(isEditableElement({ isContentEditable: true })).toBe(true);
      expect(
        isEditableElement({
          getAttribute: (attr: string) => (attr === 'contenteditable' ? 'true' : null),
        }),
      ).toBe(true);
      expect(
        isEditableElement({
          getAttribute: (attr: string) => (attr === 'contenteditable' ? '' : null),
        }),
      ).toBe(true);
      expect(
        isEditableElement({
          getAttribute: (attr: string) => (attr === 'contenteditable' ? 'plaintext-only' : null),
        }),
      ).toBe(true);
      expect(
        isEditableElement({
          getAttribute: (attr: string) => (attr === 'contenteditable' ? 'false' : null),
        }),
      ).toBe(false);
    });
  });

  describe('isFocusOnEditor', () => {
    it('retorna true quando o activeElement é o container ou está dentro dele', () => {
      const child = {} as Element;
      const container = {
        contains: (el: unknown) => el === child,
      } as HTMLElement;

      expect(isFocusOnEditor(container, container)).toBe(true);
      expect(isFocusOnEditor(container, child)).toBe(true);
    });

    it('retorna true quando o activeElement está em additionalRoots (ex: toolbar externa)', () => {
      const container = {
        contains: () => false,
      } as unknown as HTMLElement;
      const toolbarBtn = {} as Element;
      const toolbar = {
        contains: (el: unknown) => el === toolbarBtn,
      } as unknown as HTMLElement;

      expect(isFocusOnEditor(container, toolbarBtn, [toolbar])).toBe(true);
    });

    it('retorna false quando o foco pertence a outro elemento ou não há foco', () => {
      const container = {
        contains: () => false,
      } as unknown as HTMLElement;
      const otherElement = {} as Element;

      expect(isFocusOnEditor(container, null)).toBe(false);
      expect(isFocusOnEditor(null, otherElement)).toBe(false);
      expect(isFocusOnEditor(container, otherElement)).toBe(false);
    });
  });

  describe('matchKeyboardShortcut', () => {
    it('mapeia Delete e Backspace para delete', () => {
      expect(matchKeyboardShortcut({ key: 'Delete' })).toBe('delete');
      expect(matchKeyboardShortcut({ key: 'Backspace' })).toBe('delete');
    });

    it('mapeia setas direcionais para ações de deslocamento (nudge)', () => {
      expect(matchKeyboardShortcut({ key: 'ArrowLeft' })).toBe('move-left');
      expect(matchKeyboardShortcut({ key: 'ArrowRight' })).toBe('move-right');
      expect(matchKeyboardShortcut({ key: 'ArrowUp' })).toBe('move-up');
      expect(matchKeyboardShortcut({ key: 'ArrowDown' })).toBe('move-down');
    });

    it('mapeia Ctrl/Meta+Z para undo', () => {
      expect(matchKeyboardShortcut({ key: 'z', ctrlKey: true, shiftKey: false })).toBe('undo');
      expect(matchKeyboardShortcut({ key: 'Z', metaKey: true, shiftKey: false })).toBe('undo');
    });

    it('mapeia Ctrl/Meta+Shift+Z e Ctrl/Meta+Y para redo', () => {
      expect(matchKeyboardShortcut({ key: 'z', ctrlKey: true, shiftKey: true })).toBe('redo');
      expect(matchKeyboardShortcut({ key: 'Z', metaKey: true, shiftKey: true })).toBe('redo');
      expect(matchKeyboardShortcut({ key: 'y', ctrlKey: true, shiftKey: false })).toBe('redo');
      expect(matchKeyboardShortcut({ key: 'Y', metaKey: true, shiftKey: false })).toBe('redo');
    });

    it('ignora atalhos durante composição IME (isComposing = true)', () => {
      expect(matchKeyboardShortcut({ key: 'Delete', isComposing: true })).toBeNull();
      expect(matchKeyboardShortcut({ key: 'z', ctrlKey: true, isComposing: true })).toBeNull();
    });

    it('permite remapeamento customizado de atalhos', () => {
      const customMap: KeyboardShortcutMap = {
        'move-up': { key: 'w' },
        'move-left': { key: 'a' },
        'move-down': { key: 's' },
        'move-right': { key: 'd' },
      };

      expect(matchKeyboardShortcut({ key: 'w' }, customMap)).toBe('move-up');
      expect(matchKeyboardShortcut({ key: 'a' }, customMap)).toBe('move-left');
      expect(matchKeyboardShortcut({ key: 's' }, customMap)).toBe('move-down');
      expect(matchKeyboardShortcut({ key: 'd' }, customMap)).toBe('move-right');
    });

    it('não possui atalho de teclado global para ativar a ferramenta square (decisão de arquitetura)', () => {
      for (const key of ['s', 'S', 'q', 'Q', 'r', 'R', '2', '4']) {
        expect(matchKeyboardShortcut({ key })).toBeNull();
      }
    });

    it('não possui atalho de teclado global para circle, diamond ou triangle (decisão de arquitetura)', () => {
      for (const key of ['c', 'C', 'd', 'D', 't', 'T', '3']) {
        expect(matchKeyboardShortcut({ key })).toBeNull();
      }
    });

    it('não possui atalho de teclado global para pentagon, hexagon ou octagon (decisão de arquitetura)', () => {
      for (const key of ['p', 'P', 'h', 'H', 'o', 'O', '5', '6', '8']) {
        expect(matchKeyboardShortcut({ key })).toBeNull();
      }
    });
  });

  describe('executeDelete, executeNudge, executeUndo e executeRedo', () => {
    let section: ReturnType<typeof createCanvasSection>;

    beforeEach(() => {
      section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'rect-1',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 50,
          height: 50,
          rotation: 0,
        },
      });
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'rect-locked',
          type: 'rectangle',
          x: 200,
          y: 200,
          width: 50,
          height: 50,
          rotation: 0,
          locked: true,
        },
      });
      section.setSelection(['rect-1', 'rect-locked']);
    });

    it('executeDelete remove apenas nós desbloqueados e atualiza a seleção (INPUT-10)', () => {
      const res = executeDelete(section, ['rect-1', 'rect-locked']);
      expect(res).toBe(true);

      const snap = section.getSnapshot();
      expect(snap.document.nodes['rect-1']).toBeUndefined();
      expect(snap.document.nodes['rect-locked']).toBeDefined();
      expect(snap.session.selectedIds).toEqual(['rect-locked']);

      // Undo restaura rect-1
      section.undo();
      const afterUndo = section.getSnapshot();
      expect(afterUndo.document.nodes['rect-1']).toBeDefined();
    });

    it('executeDelete não faz nada e retorna false em modo readOnly', () => {
      section.setReadOnly(true);
      const res = executeDelete(section, ['rect-1']);
      expect(res).toBe(false);
      expect(section.getSnapshot().document.nodes['rect-1']).toBeDefined();
    });

    it('executeNudge desloca 1 px normalmente e 10 px com Shift ativo (INPUT-10)', () => {
      // 1 px para a direita
      executeNudge(section, ['rect-1'], 'right', false);
      expect(getRect(section, 'rect-1')?.x).toBe(101);

      // 10 px para baixo com Shift
      executeNudge(section, ['rect-1'], 'down', true);
      expect(getRect(section, 'rect-1')?.y).toBe(110);

      // Não move nós trancados
      executeNudge(section, ['rect-locked'], 'right', true);
      expect(getRect(section, 'rect-locked')?.x).toBe(200);

      // Undo restaura 10 px e depois 1 px
      section.undo();
      expect(getRect(section, 'rect-1')?.y).toBe(100);
      section.undo();
      expect(getRect(section, 'rect-1')?.x).toBe(100);
    });

    it('executeNudge não faz nada e retorna false em modo readOnly', () => {
      section.setReadOnly(true);
      const res = executeNudge(section, ['rect-1'], 'right', true);
      expect(res).toBe(false);
      expect(getRect(section, 'rect-1')?.x).toBe(100);
    });

    it('executeUndo e executeRedo executam operações no histórico e respeitam readOnly', () => {
      executeNudge(section, ['rect-1'], 'right', false);
      expect(getRect(section, 'rect-1')?.x).toBe(101);

      const undoOk = executeUndo(section);
      expect(undoOk).toBe(true);
      expect(getRect(section, 'rect-1')?.x).toBe(100);

      const redoOk = executeRedo(section);
      expect(redoOk).toBe(true);
      expect(getRect(section, 'rect-1')?.x).toBe(101);

      section.setReadOnly(true);
      expect(executeUndo(section)).toBe(false);
      expect(executeRedo(section)).toBe(false);
    });
  });

  describe('KeyboardAdapter com mocks em ambiente Node', () => {
    function createMockElement(initialTabIndex: string | null = null) {
      let tabIndex = initialTabIndex;
      const listeners: Record<string, ((event: unknown) => void)[]> = {};

      const el = {
        getAttribute: (attr: string) => (attr === 'tabindex' ? tabIndex : null),
        setAttribute: (attr: string, val: string) => {
          if (attr === 'tabindex') tabIndex = val;
        },
        contains: (other: unknown) => other === el,
        focus: vi.fn(),
        addEventListener: (type: string, fn: (e: unknown) => void) => {
          listeners[type] = listeners[type] || [];
          listeners[type].push(fn);
        },
        removeEventListener: (type: string, fn: (e: unknown) => void) => {
          if (!listeners[type]) return;
          listeners[type] = listeners[type].filter((l) => l !== fn);
        },
        _listeners: listeners,
      };

      return el as unknown as HTMLElement & { _listeners: typeof listeners };
    }

    function createMockWindow() {
      const listeners: Record<string, ((event: unknown) => void)[]> = {};
      return {
        addEventListener: (type: string, fn: (e: unknown) => void) => {
          listeners[type] = listeners[type] || [];
          listeners[type].push(fn);
        },
        removeEventListener: (type: string, fn: (e: unknown) => void) => {
          if (!listeners[type]) return;
          listeners[type] = listeners[type].filter((l) => l !== fn);
        },
        dispatch: (type: string, event: unknown) => {
          for (const fn of listeners[type] || []) {
            fn(event);
          }
        },
        _listeners: listeners,
      } as unknown as Window & {
        dispatch: (type: string, event: unknown) => void;
        _listeners: typeof listeners;
      };
    }

    function createMockDocument(initialActiveElement: Element | null = null) {
      return {
        activeElement: initialActiveElement,
      } as unknown as Document;
    }

    it('adiciona tabindex="0" ao elemento caso não possua', () => {
      const el = createMockElement(null);
      const section = createCanvasSection();
      const mockWin = createMockWindow();
      const mockDoc = createMockDocument(null);

      const adapter = new KeyboardAdapter({
        element: el,
        section,
        targetWindow: mockWin,
        targetDocument: mockDoc,
      });

      expect(el.getAttribute('tabindex')).toBe('0');
      adapter.destroy();
    });

    it('reage a eventos de teclado quando o foco está no editor e previne o default', () => {
      const el = createMockElement('0');
      const mockWin = createMockWindow();
      const mockDoc = createMockDocument(el as unknown as Element);

      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'test-shape',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 50,
          height: 50,
          rotation: 0,
        },
      });
      section.setSelection(['test-shape']);

      const adapter = new KeyboardAdapter({
        element: el,
        section,
        targetWindow: mockWin,
        targetDocument: mockDoc,
      });

      const preventDefault = vi.fn();
      mockWin.dispatch('keydown', {
        key: 'Delete',
        preventDefault,
      });

      expect(preventDefault).toHaveBeenCalled();
      expect(section.getSnapshot().document.nodes['test-shape']).toBeUndefined();

      adapter.destroy();
    });

    it('ignora eventos de teclado quando o foco pertence a outro elemento ou campo editável (INPUT-10)', () => {
      const el = createMockElement('0');
      const otherElement = createMockElement('0');
      const mockWin = createMockWindow();
      const mockDoc = createMockDocument(otherElement as unknown as Element);

      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'shape-safe',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 50,
          height: 50,
          rotation: 0,
        },
      });
      section.setSelection(['shape-safe']);

      const adapter = new KeyboardAdapter({
        element: el,
        section,
        targetWindow: mockWin,
        targetDocument: mockDoc,
      });

      const preventDefault = vi.fn();
      mockWin.dispatch('keydown', {
        key: 'Delete',
        preventDefault,
      });

      // Nó NÃO deve ter sido excluído!
      expect(preventDefault).not.toHaveBeenCalled();
      expect(section.getSnapshot().document.nodes['shape-safe']).toBeDefined();

      adapter.destroy();
    });

    it('chama element.focus() no pointerdown se o foco não estiver no editor', () => {
      const el = createMockElement('0');
      const mockWin = createMockWindow();
      const mockDoc = createMockDocument(null);

      const section = createCanvasSection();
      const adapter = new KeyboardAdapter({
        element: el,
        section,
        targetWindow: mockWin,
        targetDocument: mockDoc,
      });

      // Simula pointerdown
      for (const fn of el._listeners['pointerdown'] || []) {
        fn({});
      }

      expect(el.focus).toHaveBeenCalled();
      adapter.destroy();
    });

    it('executa atalho Ctrl+G para agrupar e Ctrl+Shift+G para desagrupar (INPUT-08)', () => {
      const el = createMockElement('0');
      const mockWin = createMockWindow();
      const mockDoc = createMockDocument(el);

      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'k1', type: 'rectangle', x: 0, y: 0, width: 50, height: 50, rotation: 0 },
      });
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'k2', type: 'rectangle', x: 60, y: 0, width: 50, height: 50, rotation: 0 },
      });
      section.setSelection(['k1', 'k2']);

      const adapter = new KeyboardAdapter({
        element: el,
        section,
        targetWindow: mockWin,
        targetDocument: mockDoc,
      });

      // Pressiona Ctrl+g para agrupar
      mockWin.dispatch('keydown', {
        key: 'g',
        ctrlKey: true,
        shiftKey: false,
        preventDefault: vi.fn(),
      });

      const selectedAfterGroup = section.getSnapshot().session.selectedIds;
      expect(selectedAfterGroup.length).toBe(1);
      const groupId = selectedAfterGroup[0]!;
      const groupNode = section.getSnapshot().document.nodes[groupId];
      expect(groupNode).toBeDefined();
      expect(groupNode?.type).toBe('group');

      // Pressiona Ctrl+Shift+g para desagrupar
      mockWin.dispatch('keydown', {
        key: 'g',
        ctrlKey: true,
        shiftKey: true,
        preventDefault: vi.fn(),
      });

      const selectedAfterUngroup = section.getSnapshot().session.selectedIds;
      expect([...selectedAfterUngroup].sort()).toEqual(['k1', 'k2'].sort());
      expect(section.getSnapshot().document.nodes[groupId]).toBeUndefined();

      adapter.destroy();
    });

    it('executa reordenação via atalhos ], [, Shift+], Shift+[ (INPUT-08)', () => {
      const el = createMockElement('0');
      const mockWin = createMockWindow();
      const mockDoc = createMockDocument(el);

      const section = createCanvasSection();
      // Cria s1, s2, s3 na camada padrão
      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 50, height: 50, rotation: 0 },
      });
      section.dispatch({
        type: 'shape.create',
        shape: { id: 's2', type: 'rectangle', x: 60, y: 0, width: 50, height: 50, rotation: 0 },
      });
      section.dispatch({
        type: 'shape.create',
        shape: { id: 's3', type: 'rectangle', x: 120, y: 0, width: 50, height: 50, rotation: 0 },
      });

      const adapter = new KeyboardAdapter({
        element: el,
        section,
        targetWindow: mockWin,
        targetDocument: mockDoc,
      });

      expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['s1', 's2', 's3']);

      // 1. Seleciona s1 e envia para a frente com Ctrl+Shift+]
      section.setSelection(['s1']);
      mockWin.dispatch('keydown', {
        key: ']',
        ctrlKey: true,
        shiftKey: true,
        preventDefault: vi.fn(),
      });
      expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['s2', 's3', 's1']);

      // 2. Seleciona s1 e envia para o fundo com Ctrl+Shift+[
      mockWin.dispatch('keydown', {
        key: '[',
        ctrlKey: true,
        shiftKey: true,
        preventDefault: vi.fn(),
      });
      expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['s1', 's2', 's3']);

      // 3. Move s1 um nível à frente com Ctrl+]
      mockWin.dispatch('keydown', {
        key: ']',
        ctrlKey: true,
        shiftKey: false,
        preventDefault: vi.fn(),
      });
      expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['s2', 's1', 's3']);

      // 4. Move s1 um nível para trás com Ctrl+[
      mockWin.dispatch('keydown', {
        key: '[',
        ctrlKey: true,
        shiftKey: false,
        preventDefault: vi.fn(),
      });
      expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['s1', 's2', 's3']);

      adapter.destroy();
    });
  });

  describe('executeGroup & executeUngroup', () => {
    it('executeGroup retorna false se selecionados < 2 ou readOnly', () => {
      const section = createCanvasSection();
      expect(executeGroup(section, ['single'])).toBe(false);

      section.setReadOnly(true);
      expect(executeGroup(section, ['a', 'b'])).toBe(false);
    });

    it('executeUngroup retorna false se nenhum grupo selecionado ou readOnly', () => {
      const section = createCanvasSection();
      expect(executeUngroup(section, [])).toBe(false);

      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });
      // s1 não é grupo
      expect(executeUngroup(section, ['s1'])).toBe(false);
    });
  });

  describe('executeReorder (INPUT-08)', () => {
    it('executeReorder retorna false se readOnly ou seleção vazia', () => {
      const section = createCanvasSection();
      expect(executeReorder(section, [], 'bringToFront')).toBe(false);

      section.setReadOnly(true);
      expect(executeReorder(section, ['s1'], 'bringToFront')).toBe(false);
    });
  });
});

describe('keyboard.ts - atalhos e ações de zoom', () => {
  const SIZE = { width: 800, height: 600 };
  // Sem contorno, para os limites de enquadramento serem exatamente os da geometria.
  const PLAIN = { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 };

  function sectionWithRectangle(id = 'r1', x = 0, y = 0, width = 100, height = 100) {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id, type: 'rectangle', x, y, width, height, rotation: 0, style: PLAIN },
    });
    return section;
  }

  const centerWorld = (section: ReturnType<typeof createCanvasSection>) => {
    const { x, y, zoom } = section.getSnapshot().session.viewport;
    return { x: (400 - x) / zoom, y: (300 - y) / zoom };
  };

  describe('matchKeyboardShortcut', () => {
    it('mapeia Ctrl/Meta + = e + (com Shift) e o + do teclado numérico para zoom-in', () => {
      expect(matchKeyboardShortcut({ key: '=', code: 'Equal', ctrlKey: true })).toBe('zoom-in');
      expect(matchKeyboardShortcut({ key: '=', code: 'Equal', metaKey: true })).toBe('zoom-in');
      expect(
        matchKeyboardShortcut({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }),
      ).toBe('zoom-in');
      expect(matchKeyboardShortcut({ key: '+', code: 'NumpadAdd', ctrlKey: true })).toBe('zoom-in');
    });

    it('mapeia Ctrl/Meta + - e o - do teclado numérico para zoom-out', () => {
      expect(matchKeyboardShortcut({ key: '-', code: 'Minus', ctrlKey: true })).toBe('zoom-out');
      expect(matchKeyboardShortcut({ key: '-', code: 'Minus', metaKey: true })).toBe('zoom-out');
      expect(matchKeyboardShortcut({ key: '-', code: 'NumpadSubtract', ctrlKey: true })).toBe(
        'zoom-out',
      );
    });

    it('identifica a tecla pelo code, funcionando em layouts em que = não é uma tecla direta', () => {
      // ABNT2: a tecla física Equal produz outro caractere em event.key
      expect(matchKeyboardShortcut({ key: '´', code: 'Equal', ctrlKey: true })).toBe('zoom-in');
    });

    it('mapeia ⇧0, ⇧1 e ⇧2 para 100%, ajustar ao conteúdo e ajustar à seleção', () => {
      expect(matchKeyboardShortcut({ key: ')', code: 'Digit0', shiftKey: true })).toBe(
        'zoom-reset',
      );
      expect(matchKeyboardShortcut({ key: '!', code: 'Digit1', shiftKey: true })).toBe('zoom-fit');
      expect(matchKeyboardShortcut({ key: '@', code: 'Digit2', shiftKey: true })).toBe(
        'zoom-selection',
      );
    });

    it('não casa as teclas sem os modificadores certos', () => {
      expect(matchKeyboardShortcut({ key: '=', code: 'Equal' })).toBeNull();
      expect(matchKeyboardShortcut({ key: '-', code: 'Minus' })).toBeNull();
      expect(matchKeyboardShortcut({ key: '0', code: 'Digit0' })).toBeNull();
      expect(matchKeyboardShortcut({ key: '1', code: 'Digit1' })).toBeNull();
      expect(
        matchKeyboardShortcut({ key: '!', code: 'Digit1', shiftKey: true, ctrlKey: true }),
      ).toBeNull();
      expect(
        matchKeyboardShortcut({ key: '!', code: 'Digit1', shiftKey: true, altKey: true }),
      ).toBeNull();
    });

    it('permite remapear as ações de zoom e não atrapalha os atalhos existentes', () => {
      const custom: KeyboardShortcutMap = { 'zoom-in': { key: 'i', ctrl: true } };

      expect(matchKeyboardShortcut({ key: 'i', ctrlKey: true }, custom)).toBe('zoom-in');
      expect(matchKeyboardShortcut({ key: '=', code: 'Equal', ctrlKey: true }, custom)).toBeNull();
      expect(matchKeyboardShortcut({ key: ']', ctrlKey: true })).toBe('bring-forward');
      expect(matchKeyboardShortcut({ key: 'z', ctrlKey: true })).toBe('undo');
    });
  });

  describe('executeZoomBy e executeZoomReset', () => {
    it('multiplica o zoom mantendo o ponto central e devolve true', () => {
      const section = createCanvasSection();
      section.setViewport({ x: 37, y: -12, zoom: 1 });
      const before = centerWorld(section);

      expect(executeZoomBy(section, SIZE, 1.2)).toBe(true);

      expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(1.2, 10);
      expect(centerWorld(section).x).toBeCloseTo(before.x, 6);
      expect(centerWorld(section).y).toBeCloseTo(before.y, 6);
    });

    it('devolve false no limite de zoom, com fator inválido ou com área sem tamanho', () => {
      const section = createCanvasSection();
      section.setViewport({ x: 0, y: 0, zoom: 16 });

      expect(executeZoomBy(section, SIZE, 1.2)).toBe(false);
      expect(executeZoomBy(section, SIZE, 0)).toBe(false);
      expect(executeZoomBy(section, SIZE, Number.NaN)).toBe(false);
      expect(executeZoomBy(section, { width: 0, height: 600 }, 0.5)).toBe(false);
      expect(section.getSnapshot().session.viewport.zoom).toBe(16);
    });

    it('funciona em modo somente leitura e não altera o documento', () => {
      const section = sectionWithRectangle();
      section.setReadOnly(true);
      const revision = section.getSnapshot().revision;

      expect(executeZoomBy(section, SIZE, 2)).toBe(true);

      expect(section.getSnapshot().session.viewport.zoom).toBe(2);
      expect(section.getSnapshot().revision).toBe(revision);
    });

    it('executeZoomReset leva a 100% mantendo o ponto central e devolve false se já está em 100%', () => {
      const section = createCanvasSection();
      section.setViewport({ x: 100, y: 50, zoom: 0.37 });
      const before = centerWorld(section);

      expect(executeZoomReset(section, SIZE)).toBe(true);

      expect(section.getSnapshot().session.viewport.zoom).toBe(1);
      expect(centerWorld(section).x).toBeCloseTo(before.x, 6);
      expect(centerWorld(section).y).toBeCloseTo(before.y, 6);
      expect(executeZoomReset(section, SIZE)).toBe(false);
    });
  });

  describe('executeFitContent e executeFitSelection', () => {
    it('executeFitContent enquadra todos os nós com a margem padrão de 40 px', () => {
      const section = sectionWithRectangle('a', 0, 0, 100, 100);
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'b',
          type: 'rectangle',
          x: 700,
          y: 400,
          width: 100,
          height: 100,
          rotation: 0,
          style: PLAIN,
        },
      });

      expect(executeFitContent(section, SIZE)).toBe(true);

      const { zoom } = section.getSnapshot().session.viewport;
      // 800 × 500 numa área útil de 720 × 520: o eixo horizontal limita (0,9)
      expect(zoom).toBeCloseTo(0.9, 6);
      expect(centerWorld(section).x).toBeCloseTo(400, 6);
      expect(centerWorld(section).y).toBeCloseTo(250, 6);
    });

    it('executeFitContent devolve false com o documento vazio ou a área sem tamanho', () => {
      expect(executeFitContent(createCanvasSection(), SIZE)).toBe(false);
      expect(executeFitContent(sectionWithRectangle(), { width: 800, height: 0 })).toBe(false);
    });

    it('executeFitSelection enquadra só a seleção e devolve false sem seleção', () => {
      const section = sectionWithRectangle('a', 0, 0, 100, 100);
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'b',
          type: 'rectangle',
          x: 5000,
          y: 5000,
          width: 10,
          height: 10,
          rotation: 0,
          style: PLAIN,
        },
      });

      expect(executeFitSelection(section, SIZE)).toBe(false);

      section.setSelection(['a']);
      expect(executeFitSelection(section, SIZE)).toBe(true);
      // 100 × 100 numa área útil de 720 × 520: zoom 5,2
      expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(5.2, 6);
    });
  });

  describe('KeyboardAdapter', () => {
    function setup(options: { focused?: boolean; width?: number; height?: number } = {}) {
      const { focused = true, width = 800, height = 600 } = options;
      const element = {
        clientWidth: width,
        clientHeight: height,
        getAttribute: () => '0',
        setAttribute: () => {},
        contains: () => false,
        focus: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      let handler: ((event: unknown) => void) | undefined;
      const targetWindow = {
        addEventListener: (_type: string, fn: (event: unknown) => void) => {
          handler = fn;
        },
        removeEventListener: vi.fn(),
      } as unknown as Window;
      const targetDocument = {
        activeElement: focused ? element : {},
      } as unknown as Document;
      const section = sectionWithRectangle('a', 0, 0, 100, 100);
      const adapter = new KeyboardAdapter({
        element: element as unknown as HTMLElement,
        section,
        targetWindow,
        targetDocument,
      });
      const press = (event: Record<string, unknown>) => {
        const preventDefault = vi.fn();
        handler?.({ preventDefault, ...event });
        return preventDefault;
      };
      return { adapter, section, press };
    }

    it('Ctrl + = aproxima 20% no centro do elemento e previne o zoom do navegador', () => {
      const { adapter, section, press } = setup();

      const preventDefault = press({ key: '=', code: 'Equal', ctrlKey: true });

      expect(preventDefault).toHaveBeenCalled();
      expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(1.2, 10);
      adapter.destroy();
    });

    it('Ctrl + - afasta, ⇧0 volta a 100%, ⇧1 ajusta ao conteúdo e ⇧2 à seleção', () => {
      const { adapter, section, press } = setup();

      press({ key: '-', code: 'Minus', ctrlKey: true });
      expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(1 / 1.2, 10);

      press({ key: ')', code: 'Digit0', shiftKey: true });
      expect(section.getSnapshot().session.viewport.zoom).toBe(1);

      press({ key: '!', code: 'Digit1', shiftKey: true });
      expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(5.2, 6);

      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.setSelection(['a']);
      press({ key: '@', code: 'Digit2', shiftKey: true });
      expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(5.2, 6);
      adapter.destroy();
    });

    it('com o foco fora do editor não faz zoom nem previne o comportamento do navegador', () => {
      const { adapter, section, press } = setup({ focused: false });

      const preventDefault = press({ key: '=', code: 'Equal', ctrlKey: true });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(section.getSnapshot().session.viewport.zoom).toBe(1);
      adapter.destroy();
    });

    it('em campo editável (editor de texto) não faz zoom nem previne o default', () => {
      const { adapter, section, press } = setup();

      const preventDefault = press({
        key: '!',
        code: 'Digit1',
        shiftKey: true,
        target: { tagName: 'TEXTAREA' },
      });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(section.getSnapshot().session.viewport.zoom).toBe(1);
      adapter.destroy();
    });

    it('com o elemento sem tamanho não faz nada', () => {
      const { adapter, section, press } = setup({ width: 0, height: 0 });

      press({ key: '=', code: 'Equal', ctrlKey: true });

      expect(section.getSnapshot().session.viewport.zoom).toBe(1);
      adapter.destroy();
    });
  });
});

describe('getGroupActions (US-GA.1, US-GA.3, US-GA.4 e US-GA.8: regra de Agrupar e Desagrupar)', () => {
  const rect = (id: string, extra: { locked?: boolean; layerId?: string } = {}) =>
    ({
      type: 'shape.create',
      shape: {
        id,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        ...(extra.locked === undefined ? {} : { locked: extra.locked }),
      },
      ...(extra.layerId === undefined ? {} : { layerId: extra.layerId }),
    }) as const;

  /** Quatro retângulos soltos (r1 a r4) e, a pedido, um grupo `g` com `g1` e `g2`. */
  function build(withGroup = false) {
    const section = createCanvasSection();
    section.transact([rect('r1'), rect('r2'), rect('r3'), rect('r4')]);
    if (withGroup) {
      section.transact([
        rect('g1'),
        rect('g2'),
        { type: 'group.create', id: 'g', childIds: ['g1', 'g2'] },
      ]);
    }
    return section;
  }
  const peerLocking = (locks: string[]): CanvasPeer => ({
    sessionId: 'outra',
    name: 'Bia',
    color: '#dc2626',
    cursor: null,
    selection: locks,
    selectedAt: 1,
    drag: null,
    view: null,
    locks,
    followed: false,
  });

  it('dois nós soltos: Agrupar habilitado e Desagrupar escondido; um só nó: os dois escondidos', () => {
    const section = build();
    expect(getGroupActions(section, ['r1', 'r2'])).toEqual({ group: 'enabled', ungroup: 'hidden' });
    expect(getGroupActions(section, ['r1'])).toEqual({ group: 'hidden', ungroup: 'hidden' });
    expect(getGroupActions(section, [])).toEqual({ group: 'hidden', ungroup: 'hidden' });
  });

  it('um grupo: só Desagrupar; dois grupos ou um grupo e um nó solto: Agrupar desabilitado', () => {
    const section = build(true);
    section.transact([
      rect('h1'),
      rect('h2'),
      { type: 'group.create', id: 'h', childIds: ['h1', 'h2'] },
    ]);
    expect(getGroupActions(section, ['g'])).toEqual({ group: 'hidden', ungroup: 'enabled' });
    expect(getGroupActions(section, ['g', 'h'])).toEqual({ group: 'disabled', ungroup: 'enabled' });
    expect(getGroupActions(section, ['g', 'r1'])).toEqual({
      group: 'disabled',
      ungroup: 'enabled',
    });
  });

  it('Agrupar fica desabilitado com nó bloqueado, camada bloqueada, camadas diferentes e membro de grupo', () => {
    const section = build(true);
    section.transact([
      rect('lk', { locked: true }),
      { type: 'layer.create', layer: { id: 'L2' } },
      rect('o1', { layerId: 'L2' }),
      { type: 'layer.create', layer: { id: 'L3' } },
      rect('z1', { layerId: 'L3' }),
      rect('z2', { layerId: 'L3' }),
      { type: 'layer.update', id: 'L3', patch: { locked: true } },
    ]);
    expect(getGroupActions(section, ['r1', 'lk']).group).toBe('disabled');
    expect(getGroupActions(section, ['z1', 'z2']).group).toBe('disabled');
    expect(getGroupActions(section, ['r1', 'o1']).group).toBe('disabled');
    expect(getGroupActions(section, ['g1', 'r1']).group).toBe('disabled');
    expect(getGroupActions(section, ['g1', 'r1']).ungroup).toBe('hidden');
  });

  it('Desagrupar fica desabilitado quando todos os grupos têm locked ou estão em camada com locked', () => {
    const section = build(true);
    section.transact([
      rect('b1'),
      rect('b2'),
      { type: 'group.create', id: 'gb', childIds: ['b1', 'b2'] },
      { type: 'layer.create', layer: { id: 'L2' } },
      rect('c1', { layerId: 'L2' }),
      rect('c2', { layerId: 'L2' }),
      { type: 'group.create', id: 'gc', childIds: ['c1', 'c2'] },
      { type: 'layer.update', id: 'L2', patch: { locked: true } },
    ]);
    expect(getGroupActions(section, ['gc']).ungroup).toBe('disabled');
    expect(getGroupActions(section, ['g', 'gc']).ungroup).toBe('enabled');
    // `locked` no próprio grupo só chega por um documento carregado.
    const { document } = section.getSnapshot();
    const gb = document.nodes['gb']!;
    section.replaceDocument({
      ...document,
      nodes: { ...document.nodes, gb: { ...gb, locked: true } },
    });
    expect(getGroupActions(section, ['gb']).ungroup).toBe('disabled');
  });

  it('nós bloqueados por outra sessão contam como não selecionados (US-GA.8)', () => {
    const section = build(true);
    section.setPeers([peerLocking(['g'])]);
    expect(getGroupActions(section, ['g', 'r4'])).toEqual({ group: 'hidden', ungroup: 'hidden' });
    section.setPeers([peerLocking(['r1'])]);
    expect(getGroupActions(section, ['r1', 'r2', 'r3'])).toEqual({
      group: 'enabled',
      ungroup: 'hidden',
    });
    expect(getGroupActions(section, ['r1', 'r2'])).toEqual({ group: 'hidden', ungroup: 'hidden' });
  });

  it('somente leitura esconde as duas ações, e IDs inexistentes são ignorados', () => {
    const section = build(true);
    expect(getGroupActions(section, ['r1', 'ghost', 'r2'])).toEqual({
      group: 'enabled',
      ungroup: 'hidden',
    });
    expect(getGroupActions(section, ['ghost', 'fantasma'])).toEqual({
      group: 'hidden',
      ungroup: 'hidden',
    });
    section.setReadOnly(true);
    expect(getGroupActions(section, ['r1', 'r2'])).toEqual({ group: 'hidden', ungroup: 'hidden' });
    expect(getGroupActions(section, ['g'])).toEqual({ group: 'hidden', ungroup: 'hidden' });
  });

  it('IDs repetidos contam uma vez, e um peer sem bloqueio não tira nó nenhum da conta', () => {
    const section = build();
    expect(getGroupActions(section, ['r1', 'r1', 'r1'])).toEqual({
      group: 'hidden',
      ungroup: 'hidden',
    });
    expect(getGroupActions(section, ['r1', 'r2', 'r1'])).toEqual({
      group: 'enabled',
      ungroup: 'hidden',
    });
    // Só o cursor de B: nenhum nó bloqueado, e o resultado não muda.
    section.setPeers([{ ...peerLocking([]), cursor: { x: 5, y: 5 } }]);
    expect(getGroupActions(section, ['r1', 'r2'])).toEqual({ group: 'enabled', ungroup: 'hidden' });
  });

  it('reaproveita o índice enquanto o documento não muda e o refaz quando muda', () => {
    const section = build();
    expect(getGroupActions(section, ['r1', 'r2']).group).toBe('enabled');
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['r1', 'r2'] });
    expect(getGroupActions(section, ['r1', 'r3']).group).toBe('disabled');
    section.undo();
    expect(getGroupActions(section, ['r1', 'r3']).group).toBe('enabled');
  });
});

describe('executeGroup e executeUngroup seguem getGroupActions (US-GA.2, US-GA.3, US-GA.5 e US-GA.8)', () => {
  const rect = (id: string, extra: { locked?: boolean; layerId?: string } = {}) =>
    ({
      type: 'shape.create',
      shape: {
        id,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        ...(extra.locked === undefined ? {} : { locked: extra.locked }),
      },
      ...(extra.layerId === undefined ? {} : { layerId: extra.layerId }),
    }) as const;

  /** r1 a r4 soltos, o grupo ga (a1, a2) e o grupo gb (b1, b2). */
  function build() {
    const section = createCanvasSection();
    section.transact([
      rect('r1'),
      rect('r2'),
      rect('r3'),
      rect('r4'),
      rect('a1'),
      rect('a2'),
      rect('b1'),
      rect('b2'),
      { type: 'group.create', id: 'ga', childIds: ['a1', 'a2'] },
      { type: 'group.create', id: 'gb', childIds: ['b1', 'b2'] },
    ]);
    return section;
  }
  const revisionOf = (section: ReturnType<typeof build>) => section.getSnapshot().revision;

  it('Agrupar cria o grupo numa entrada de histórico e o seleciona', () => {
    const section = build();
    const before = revisionOf(section);
    expect(executeGroup(section, ['r1', 'r2'])).toBe(true);
    const snapshot = section.getSnapshot();
    expect(snapshot.revision).toBe(before + 1);
    const [created] = snapshot.session.selectedIds;
    expect(snapshot.document.nodes[created!]?.type).toBe('group');
    expect(section.undo().ok).toBe(true);
    expect(section.getSnapshot().document.nodes[created!]).toBeUndefined();
  });

  it('com a ação desabilitada ou escondida, Agrupar devolve false sem despachar nada (US-GA.5)', () => {
    const section = build();
    section.transact([rect('lk', { locked: true })]);
    const dispatch = vi.spyOn(section, 'dispatch');
    const transact = vi.spyOn(section, 'transact');
    const before = revisionOf(section);
    for (const selection of [
      ['ga', 'gb'],
      ['r1', 'lk'],
      ['a1', 'r1'],
      ['ga', 'r1'],
      ['r1'],
      ['r1', 'fantasma'],
    ]) {
      expect(executeGroup(section, selection)).toBe(false);
    }
    expect(dispatch).not.toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
    expect(revisionOf(section)).toBe(before);
  });

  it('com a ação desabilitada ou escondida, Desagrupar devolve false sem despachar nada', () => {
    const section = build();
    const dispatch = vi.spyOn(section, 'dispatch');
    const transact = vi.spyOn(section, 'transact');
    const before = revisionOf(section);
    expect(executeUngroup(section, ['r1', 'r2'])).toBe(false);
    expect(executeUngroup(section, ['a1'])).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
    expect(revisionOf(section)).toBe(before);
  });

  it('Desagrupar dois grupos é um transact: uma entrada de histórico, e um undo os restaura', () => {
    const section = build();
    const transact = vi.spyOn(section, 'transact');
    const dispatch = vi.spyOn(section, 'dispatch');
    const before = revisionOf(section);
    expect(executeUngroup(section, ['ga', 'gb', 'r1'])).toBe(true);
    expect(transact).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(revisionOf(section)).toBe(before + 1);
    const snapshot = section.getSnapshot();
    expect(snapshot.document.nodes['ga']).toBeUndefined();
    expect(snapshot.document.nodes['gb']).toBeUndefined();
    // A seleção são os filhos liberados, e o nó solto que estava nela sai.
    expect([...snapshot.session.selectedIds].sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(section.undo().ok).toBe(true);
    const restored = section.getSnapshot().document.nodes;
    expect(restored['ga']?.type).toBe('group');
    expect(restored['gb']?.type).toBe('group');
  });

  it('com um grupo livre e um com locked, só o livre é desagrupado', () => {
    const section = build();
    const { document } = section.getSnapshot();
    const gb = document.nodes['gb']!;
    section.replaceDocument({
      ...document,
      nodes: { ...document.nodes, gb: { ...gb, locked: true } },
    });
    expect(executeUngroup(section, ['ga', 'gb'])).toBe(true);
    const snapshot = section.getSnapshot();
    expect(snapshot.document.nodes['ga']).toBeUndefined();
    expect(snapshot.document.nodes['gb']?.type).toBe('group');
    expect([...snapshot.session.selectedIds].sort()).toEqual(['a1', 'a2']);
  });

  it('nó bloqueado por outra sessão fica de fora do grupo, e grupo bloqueado fica de fora do lote (US-GA.8)', () => {
    const section = build();
    const lock = (...locks: string[]) =>
      section.setPeers([
        {
          sessionId: 'outra',
          name: 'Bia',
          color: '#dc2626',
          cursor: null,
          selection: locks,
          selectedAt: 1,
          drag: null,
          view: null,
          locks,
          followed: false,
        },
      ]);
    lock('r1');
    expect(executeGroup(section, ['r1', 'r2', 'r3'])).toBe(true);
    const [created] = section.getSnapshot().session.selectedIds;
    const group = section.getSnapshot().document.nodes[created!];
    expect(group?.type === 'group' ? [...group.childIds].sort() : []).toEqual(['r2', 'r3']);
    lock('ga');
    expect(executeUngroup(section, ['ga', 'gb'])).toBe(true);
    expect(section.getSnapshot().document.nodes['ga']?.type).toBe('group');
    expect(section.getSnapshot().document.nodes['gb']).toBeUndefined();
  });
});

describe('ação edit-text: Enter abre o texto da forma (US-SL.8)', () => {
  const press = (key: string, extra: Record<string, unknown> = {}) =>
    matchKeyboardShortcut({ key, code: key, ...extra });

  it('Enter, sem modificadores, é a ação edit-text por padrão', () => {
    expect(DEFAULT_SHORTCUTS['edit-text']).toEqual([
      { key: 'Enter', ctrl: false, shift: false, alt: false },
    ]);
    expect(press('Enter')).toBe('edit-text');
  });

  it('Enter com Ctrl, Meta, Shift ou Alt não é edit-text', () => {
    expect(press('Enter', { ctrlKey: true })).toBeNull();
    expect(press('Enter', { metaKey: true })).toBeNull();
    expect(press('Enter', { shiftKey: true })).toBeNull();
    expect(press('Enter', { altKey: true })).toBeNull();
  });

  it('pode ser remapeada como as demais, e os atalhos existentes não mudam', () => {
    expect(matchKeyboardShortcut({ key: 'F2' }, { 'edit-text': { key: 'F2' } })).toBe('edit-text');
    expect(matchKeyboardShortcut({ key: 'Enter' }, { 'edit-text': { key: 'F2' } })).toBeNull();
    expect(press('Delete')).toBe('delete');
    expect(press('g', { ctrlKey: true })).toBe('group');
  });

  describe('KeyboardAdapter', () => {
    function adapterWith(onEditText: (() => boolean) | undefined, focused = true) {
      const listeners: Record<string, ((event: unknown) => void)[]> = {};
      const el = {
        getAttribute: () => '0',
        setAttribute: () => undefined,
        contains: (other: unknown) => other === el,
        focus: vi.fn(),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      } as unknown as HTMLElement;
      const win = {
        addEventListener: (type: string, fn: (e: unknown) => void) => {
          (listeners[type] ??= []).push(fn);
        },
        removeEventListener: () => undefined,
      } as unknown as Window;
      const doc = { activeElement: focused ? el : null } as unknown as Document;
      const adapter = new KeyboardAdapter({
        element: el,
        section: createCanvasSection(),
        targetWindow: win,
        targetDocument: doc,
        ...(onEditText ? { onEditText } : {}),
      });
      const keydown = (event: Record<string, unknown>) => {
        const preventDefault = vi.fn();
        for (const fn of listeners['keydown'] ?? []) fn({ key: 'Enter', preventDefault, ...event });
        return preventDefault;
      };
      return { adapter, keydown };
    }

    it('chama onEditText e só previne o padrão quando ele agiu', () => {
      const acted = vi.fn(() => true);
      const idle = vi.fn(() => false);

      const yes = adapterWith(acted);
      expect(yes.keydown({})).toHaveBeenCalled();
      expect(acted).toHaveBeenCalledTimes(1);

      const no = adapterWith(idle);
      expect(no.keydown({})).not.toHaveBeenCalled();
      expect(idle).toHaveBeenCalledTimes(1);
    });

    it('é ignorada com o foco fora do editor, em campo editável ou sem callback', () => {
      const callback = vi.fn(() => true);

      expect(adapterWith(callback, false).keydown({})).not.toHaveBeenCalled();
      expect(
        adapterWith(callback).keydown({ target: { tagName: 'INPUT' }, composedPath: () => [] }),
      ).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(adapterWith(undefined).keydown({})).not.toHaveBeenCalled();
    });
  });
});

describe('getGroupActions com boards (spec boards, US-BD.9)', () => {
  const rect = (id: string, x = 0) => ({
    type: 'shape.create' as const,
    shape: { id, type: 'rectangle' as const, x, y: 0, width: 10, height: 10, rotation: 0 },
  });

  /** Boards `b` (c1, c2, c3) e `b2` (d1, d2) e, soltos na camada, r1 e r2. */
  function build() {
    const section = createCanvasSection();
    const created = section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 400, height: 300 },
      },
      {
        type: 'shape.create',
        shape: { id: 'b2', type: 'board', x: 600, y: 0, width: 400, height: 300 },
      },
      ...['c1', 'c2', 'c3', 'd1', 'd2', 'r1', 'r2'].map((id, index) => rect(id, index * 20)),
      { type: 'board.attach', boardId: 'b', ids: ['c1', 'c2', 'c3'] },
      { type: 'board.attach', boardId: 'b2', ids: ['d1', 'd2'] },
    ]);
    if (!created.ok) throw new Error('fixture recusada');
    return section;
  }

  it('dois filhos do mesmo board: Agrupar habilitado, e group.create dá certo', () => {
    const section = build();

    expect(getGroupActions(section, ['c1', 'c2'])).toEqual({ group: 'enabled', ungroup: 'hidden' });
    expect(section.dispatch({ type: 'group.create', childIds: ['c1', 'c2'] }).ok).toBe(true);
  });

  it.each([
    ['um board e um nó da camada', ['b', 'r1']],
    ['dois boards', ['b', 'b2']],
    ['um filho de board e um nó da camada', ['c1', 'r1']],
    ['filhos de dois boards', ['c1', 'd1']],
    ['um board e um filho dele', ['b', 'c1']],
  ])('%s: Agrupar desabilitado, e group.create é recusado', (_name, selection) => {
    const section = build();

    expect(getGroupActions(section, selection).group).toBe('disabled');
    expect(section.dispatch({ type: 'group.create', childIds: selection }).ok).toBe(false);
  });

  it('um board sozinho esconde Agrupar e Desagrupar', () => {
    expect(getGroupActions(build(), ['b'])).toEqual({ group: 'hidden', ungroup: 'hidden' });
  });

  it('um board locked desabilita Agrupar dos filhos dele e Desagrupar do grupo dentro dele', () => {
    const section = build();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['c1', 'c2'] });
    expect(getGroupActions(section, ['g'])).toEqual({ group: 'hidden', ungroup: 'enabled' });
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } });

    expect(getGroupActions(section, ['g'])).toEqual({ group: 'hidden', ungroup: 'disabled' });
    expect(getGroupActions(section, ['g', 'c3']).group).toBe('disabled');
  });

  it('Desagrupar vale para um grupo dentro do board', () => {
    const section = build();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['c1', 'c2'] });

    expect(getGroupActions(section, ['g']).ungroup).toBe('enabled');
    expect(section.dispatch({ type: 'group.ungroup', id: 'g' }).ok).toBe(true);
  });
});

describe('setas e Delete com board (spec boards, US-BD.5 e US-BD.8)', () => {
  const rect = (id: string, x: number) => ({
    type: 'shape.create' as const,
    shape: { id, type: 'rectangle' as const, x, y: 200, width: 20, height: 20, rotation: 0 },
  });
  const peerLocking = (locks: string[]): CanvasPeer => ({
    sessionId: 'outra',
    name: 'Bia',
    color: '#dc2626',
    cursor: null,
    selection: locks,
    selectedAt: 1,
    drag: null,
    view: null,
    locks,
    followed: false,
  });

  function build() {
    const section = createCanvasSection();
    const created = section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 100, y: 150, width: 400, height: 200 },
      },
      rect('c1', 120),
      rect('m1', 200),
      rect('m2', 240),
      rect('out', 700),
      {
        type: 'shape.create',
        shape: {
          id: 'link',
          type: 'arrow',
          start: { targetId: 'c1', anchor: { x: 1, y: 0.5 } },
          end: { targetId: 'out', anchor: { x: 0, y: 0.5 } },
        },
      },
      { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      { type: 'board.attach', boardId: 'b', ids: ['c1', 'g'] },
    ] as never);
    if (!created.ok) throw new Error('fixture recusada');
    return section;
  }
  const at = (section: ReturnType<typeof build>, id: string) =>
    section.getSnapshot().document.nodes[id] as unknown as { x: number; y: number };

  it('as setas movem o board e os descendentes pelo mesmo vetor, numa entrada de histórico', () => {
    const section = build();
    const before = section.getSnapshot().revision;

    expect(executeNudge(section, ['b'], 'right', true)).toBe(true);

    expect(section.getSnapshot().revision).toBe(before + 1);
    expect(at(section, 'b')).toMatchObject({ x: 110, y: 150 });
    expect(at(section, 'c1')).toMatchObject({ x: 130 });
    expect(at(section, 'm2')).toMatchObject({ x: 250 });
    expect(at(section, 'out')).toMatchObject({ x: 700 });
  });

  it('as setas não recalculam a pertença: o filho empurrado para fora continua filho', () => {
    const section = build();

    for (let i = 0; i < 6; i += 1) executeNudge(section, ['b'], 'down', true);

    const board = section.getSnapshot().document.nodes['b'] as unknown as { childIds: string[] };
    expect(board.childIds).toEqual(['c1', 'g']);
  });

  it('um descendente locked ou bloqueado por outra sessão: as setas e o Delete não fazem nada', () => {
    const locked = build();
    locked.dispatch({ type: 'shape.update', id: 'm1', patch: { locked: true } });
    const remote = build();
    remote.setPeers([peerLocking(['c1'])]);

    for (const section of [locked, remote]) {
      const before = section.getSnapshot().document;
      expect(executeNudge(section, ['b'], 'left', false)).toBe(false);
      expect(executeDelete(section, ['b'])).toBe(false);
      expect(section.getSnapshot().document).toBe(before);
    }
  });

  it('US-BD.8: Delete remove o board e os descendentes numa transação, e o undo restaura tudo', () => {
    const section = build();
    section.setSelection(['b']);
    const before = section.getSnapshot().document;
    const revision = section.getSnapshot().revision;

    expect(executeDelete(section, ['b'])).toBe(true);

    expect(section.getSnapshot().revision).toBe(revision + 1);
    expect(Object.keys(section.getSnapshot().document.nodes).sort()).toEqual(['link', 'out']);
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
    // A seta ligada a um filho removido ficou com a ponta livre na última posição.
    expect(
      (section.getSnapshot().document.nodes['link'] as unknown as { start: unknown }).start,
    ).toEqual({
      x: 140,
      y: 210,
    });

    section.undo();
    expect(section.getSnapshot().document).toEqual(before);
    expect(
      (section.getSnapshot().document.nodes['b'] as unknown as { childIds: string[] }).childIds,
    ).toEqual(['c1', 'g']);
  });

  it('Delete com o board e um filho dele selecionados apaga uma vez só', () => {
    const section = build();

    expect(executeDelete(section, ['b', 'c1'])).toBe(true);

    expect(Object.keys(section.getSnapshot().document.nodes).sort()).toEqual(['link', 'out']);
  });
});
