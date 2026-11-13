import { createCanvasSection, type CanvasPeer, type TextNode } from '@canvash/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachInteractions } from './index.js';

const TEXT: TextNode = {
  id: 'txt',
  type: 'text',
  x: 50,
  y: 50,
  width: 200,
  height: 40,
  rotation: 0,
  text: 'Texto inicial',
  fontSize: 16,
  fontSizeMode: 'auto',
  fontFamily: 'sans-serif',
  fontWeight: 400,
  textAlign: 'left',
  lineHeight: 1.25,
  visible: true,
  locked: false,
  style: { fill: '#111827', stroke: null, strokeWidth: 0, opacity: 1 },
};

const holder = (locks: string[]): CanvasPeer => ({
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

describe('interação com bloqueio de outro participante (navegador)', () => {
  let container: HTMLDivElement;
  let section: ReturnType<typeof createCanvasSection>;

  const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) => {
    const rect = container.getBoundingClientRect();
    container.dispatchEvent(
      new PointerEvent(type, {
        clientX: rect.left + x,
        clientY: rect.top + y,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true,
        ...extra,
      }),
    );
  };
  const dblclick = (x: number, y: number) => {
    const rect = container.getBoundingClientRect();
    container.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: rect.left + x,
        clientY: rect.top + y,
        button: 0,
        bubbles: true,
      }),
    );
  };

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = 'position:relative;width:600px;height:400px';
    document.body.appendChild(container);
    section = createCanvasSection();
    section.dispatch({ type: 'shape.create', shape: TEXT });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'caixa',
        type: 'rectangle',
        x: 300,
        y: 100,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });
  });

  describe('gesto em andamento que perde o alvo (US-RL.5)', () => {
    it('mover: o preview some, nada é confirmado e o gesto termina', () => {
      const handle = attachInteractions({ section, element: container });
      section.setSelection(['caixa']);
      pointer('pointerdown', 350, 150);
      pointer('pointermove', 380, 170);
      expect(handle.getState()).toBe('moving');
      expect(section.getPreview()).not.toBeNull();
      const revision = section.getSnapshot().revision;

      section.setPeers([holder(['caixa'])]);

      expect(handle.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      pointer('pointerup', 380, 170);
      const box = section.getSnapshot().document.nodes['caixa'] as { x: number; y: number };
      expect(box.x).toBe(300);
      expect(section.getSnapshot().revision).toBe(revision);
      handle.destroy();
    });

    it('redimensionar: o preview some e nada é confirmado', () => {
      const handle = attachInteractions({ section, element: container });
      section.setSelection(['caixa']);
      // Alça do canto inferior direito.
      pointer('pointerdown', 400, 200);
      pointer('pointermove', 450, 240);
      expect(handle.getState()).toBe('resizing');
      const revision = section.getSnapshot().revision;

      section.setPeers([holder(['caixa'])]);

      expect(handle.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      pointer('pointerup', 450, 240);
      expect(section.getSnapshot().revision).toBe(revision);
      handle.destroy();
    });

    it('girar: o preview some e nada é confirmado', () => {
      const handle = attachInteractions({ section, element: container });
      section.setSelection(['caixa']);
      // Alça de rotação: acima do topo do nó.
      pointer('pointerdown', 350, 100 - 24);
      pointer('pointermove', 420, 90);
      expect(handle.getState()).toBe('rotating');
      const revision = section.getSnapshot().revision;

      section.setPeers([holder(['caixa'])]);

      expect(handle.getState()).toBe('idle');
      expect(section.getPreview()).toBeNull();
      pointer('pointerup', 420, 90);
      expect(section.getSnapshot().revision).toBe(revision);
      handle.destroy();
    });

    it('um bloqueio que não toca o alvo do gesto não o interrompe', () => {
      const handle = attachInteractions({ section, element: container });
      section.setSelection(['caixa']);
      pointer('pointerdown', 350, 150);
      pointer('pointermove', 380, 170);

      section.setPeers([holder(['txt'])]);

      expect(handle.getState()).toBe('moving');
      pointer('pointerup', 380, 170);
      handle.destroy();
    });
  });

  describe('edição de texto que perde o bloqueio (US-RL.7)', () => {
    it('fecha o editor, entrega o buffer a onTextEditSuperseded e não grava por cima', () => {
      const onTextEditSuperseded = vi.fn();
      const handle = attachInteractions({ section, element: container, onTextEditSuperseded });
      dblclick(70, 70);
      expect(handle.getState()).toBe('editing-text');
      const textarea = handle.getTextEditor?.()?.getTextArea();
      textarea!.value = 'Meu texto digitado';
      const revision = section.getSnapshot().revision;

      section.setPeers([holder(['txt'])]);

      expect(onTextEditSuperseded).toHaveBeenCalledTimes(1);
      expect(onTextEditSuperseded).toHaveBeenCalledWith('txt', 'Meu texto digitado');
      expect(handle.getState()).toBe('idle');
      expect(handle.getTextEditor?.()?.isActive()).toBe(false);
      expect(container.querySelector('textarea')).toBeNull();
      expect((section.getSnapshot().document.nodes['txt'] as TextNode).text).toBe('Texto inicial');
      expect(section.getSnapshot().revision).toBe(revision);
      expect(section.getPreview()).toBeNull();
      handle.destroy();
    });

    it('sem o callback, o editor fecha do mesmo jeito', () => {
      const handle = attachInteractions({ section, element: container });
      dblclick(70, 70);

      section.setPeers([holder(['txt'])]);

      expect(handle.getState()).toBe('idle');
      expect(container.querySelector('textarea')).toBeNull();
      handle.destroy();
    });
  });

  describe('texto só no fim da edição (US-RL.6)', () => {
    it('durante a digitação o documento não muda, e o blur confirma uma única vez', () => {
      const handle = attachInteractions({ section, element: container });
      dblclick(70, 70);
      const textarea = handle.getTextEditor?.().getTextArea() as HTMLTextAreaElement;
      const documentEvents: number[] = [];
      section.subscribe((change) => {
        if (change.areas.includes('document')) documentEvents.push(change.snapshot.revision);
      });
      const revision = section.getSnapshot().revision;

      for (const text of ['M', 'Me', 'Meu', 'Meu t']) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      expect(documentEvents).toHaveLength(0);
      expect(section.getSnapshot().revision).toBe(revision);

      textarea.dispatchEvent(new FocusEvent('blur'));
      expect(documentEvents).toHaveLength(1);
      expect((section.getSnapshot().document.nodes['txt'] as TextNode).text).toBe('Meu t');
      handle.destroy();
    });

    it('Ctrl+Enter também confirma numa única alteração, e Esc não confirma nada', () => {
      const handle = attachInteractions({ section, element: container });
      const documentEvents: number[] = [];
      section.subscribe((change) => {
        if (change.areas.includes('document')) documentEvents.push(1);
      });

      dblclick(70, 70);
      let textarea = handle.getTextEditor?.().getTextArea() as HTMLTextAreaElement;
      textarea.value = 'Primeiro';
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
      expect(documentEvents).toHaveLength(1);

      dblclick(70, 70);
      textarea = handle.getTextEditor?.().getTextArea() as HTMLTextAreaElement;
      textarea.value = 'Cancelado';
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(documentEvents).toHaveLength(1);
      expect((section.getSnapshot().document.nodes['txt'] as TextNode).text).toBe('Primeiro');
      handle.destroy();
    });
  });

  describe('editar mantém o nó selecionado', () => {
    it('o duplo clique em texto não selecionado o seleciona ao abrir o editor', () => {
      const handle = attachInteractions({ section, element: container });
      expect(section.getSnapshot().session.selectedIds).toEqual([]);

      dblclick(70, 70);

      expect(handle.getState()).toBe('editing-text');
      expect(section.getSnapshot().session.selectedIds).toEqual(['txt']);
      handle.destroy();
    });

    it('abrir o editor não altera uma seleção que já continha o nó', () => {
      const handle = attachInteractions({ section, element: container });
      section.setSelection(['txt', 'caixa']);

      dblclick(70, 70);

      expect(section.getSnapshot().session.selectedIds).toEqual(['txt', 'caixa']);
      handle.destroy();
    });
  });
});
