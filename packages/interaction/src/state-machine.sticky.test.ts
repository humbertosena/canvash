import { createCanvasSection, type CanvasSectionApi, type StickyNode } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteractionStateMachine, type InteractionAction } from './state-machine.js';

const pointer = (type: 'POINTER_DOWN' | 'POINTER_MOVE' | 'POINTER_UP', x: number, y: number) => {
  const base = { pointerId: 1, point: { x, y } };
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
};

describe('InteractionStateMachine: nota adesiva', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;
  let actions: InteractionAction[];

  const startEdit = (): { node: StickyNode; isNew: boolean } | undefined => {
    const action = actions.find((entry) => entry.type === 'START_TEXT_EDIT');
    return action?.type === 'START_TEXT_EDIT'
      ? { node: action.node as StickyNode, isNew: action.isNew }
      : undefined;
  };

  const notes = (): StickyNode[] =>
    Object.values(section.getSnapshot().document.nodes).filter(
      (node): node is StickyNode => node.type === 'sticky',
    );

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    actions = [];
    machine.onAction((action) => actions.push(action));
    section.setTool('sticky');
  });

  it('usa o cursor de cruz com a ferramenta sticky', () => {
    expect(machine.getIdleCursor()).toBe('crosshair');
  });

  it('um clique abre a edição de uma nota amarela 200 × 200, sem criá-la ainda', () => {
    machine.process(pointer('POINTER_DOWN', 40, 60));
    expect(machine.getState()).toBe('creating');
    machine.process(pointer('POINTER_UP', 40, 60));

    expect(machine.getState()).toBe('editing-text');
    const edit = startEdit()!;
    expect(edit.isNew).toBe(true);
    expect(edit.node).toMatchObject({
      type: 'sticky',
      x: 40,
      y: 60,
      width: 200,
      height: 200,
      text: '',
      style: { fill: '#fff59d' },
    });
    expect(notes()).toHaveLength(0);
    expect(section.getPreview()).toBeNull();
  });

  it('confirmar o texto cria a nota numa só entrada de histórico e volta à seleção', () => {
    machine.process(pointer('POINTER_DOWN', 40, 60));
    machine.process(pointer('POINTER_UP', 40, 60));
    machine.commitTextEdit('Ideia boa');

    expect(machine.getState()).toBe('idle');
    const [note] = notes();
    expect(note).toMatchObject({ text: 'Ideia boa', x: 40, y: 60, width: 200, height: 200 });
    expect(section.getSnapshot().session.selectedIds).toEqual([note!.id]);
    expect(section.getSnapshot().session.activeTool).toBe('select');

    section.undo();
    expect(notes()).toHaveLength(0);
  });

  it('confirmar sem texto cria uma nota vazia', () => {
    machine.process(pointer('POINTER_DOWN', 10, 10));
    machine.process(pointer('POINTER_UP', 10, 10));
    machine.commitTextEdit('   ');
    const [note] = notes();
    expect(note).toBeDefined();
    expect(note!.text).toBe('   ');
  });

  it('o texto confirmado perde as tags HTML', () => {
    machine.process(pointer('POINTER_DOWN', 10, 10));
    machine.process(pointer('POINTER_UP', 10, 10));
    machine.commitTextEdit('a<b>negrito</b>');
    expect(notes()[0]!.text).toBe('anegrito');
  });

  it('cancelar a edição não cria nada', () => {
    machine.process(pointer('POINTER_DOWN', 40, 60));
    machine.process(pointer('POINTER_UP', 40, 60));
    machine.cancelTextEdit();
    expect(machine.getState()).toBe('idle');
    expect(notes()).toHaveLength(0);
    expect(section.getSnapshot().session.activeTool).toBe('sticky');
  });

  it('arrastar cria a nota na caixa do gesto, com preview da cor durante o arrasto', () => {
    machine.process(pointer('POINTER_DOWN', 100, 100));
    machine.process(pointer('POINTER_MOVE', 20, 40));
    expect(section.getPreview()?.additions[0]).toMatchObject({
      type: 'sticky',
      x: 20,
      y: 40,
      width: 80,
      height: 60,
      style: { fill: '#fff59d' },
    });

    machine.process(pointer('POINTER_UP', 20, 40));
    expect(section.getPreview()).toBeNull();
    expect(startEdit()!.node).toMatchObject({ x: 20, y: 40, width: 80, height: 60 });
  });

  it('o limiar de arrasto acompanha o zoom', () => {
    section.setViewport({ x: 0, y: 0, zoom: 0.1 });
    // 8 px de tela são 80 unidades de mundo: um arrasto de 50 ainda é clique.
    machine.process(pointer('POINTER_DOWN', 0, 0));
    machine.process(pointer('POINTER_UP', 5, 5));
    expect(startEdit()!.node).toMatchObject({ x: 0, y: 0, width: 200, height: 200 });
  });

  it('setStickyColor vale para as próximas notas e ignora valor inválido', () => {
    expect(machine.getStickyColor()).toBe('#fff59d');
    machine.setStickyColor('#F8BBD0');
    expect(machine.getStickyColor()).toBe('#f8bbd0');
    machine.setStickyColor('rosa');
    machine.setStickyColor('#fff');
    expect(machine.getStickyColor()).toBe('#f8bbd0');

    machine.process(pointer('POINTER_DOWN', 10, 10));
    machine.process(pointer('POINTER_UP', 10, 10));
    machine.commitTextEdit('oi');
    expect(notes()[0]!.style.fill).toBe('#f8bbd0');
  });

  it('não cria nota com o canvas somente leitura', () => {
    section.setReadOnly(true);
    machine.process(pointer('POINTER_DOWN', 10, 10));
    expect(machine.getState()).toBe('idle');
  });

  it('clicar numa nota existente com a ferramenta sticky a edita', () => {
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'note', type: 'sticky', x: 0, y: 0, text: 'antes' },
    });
    machine.process(pointer('POINTER_DOWN', 50, 50));
    expect(machine.getState()).toBe('editing-text');
    const edit = startEdit()!;
    expect(edit.isNew).toBe(false);
    expect(edit.node.id).toBe('note');
    // A nota continua à vista: nada é escondido por preview.
    expect(section.getPreview()).toBeNull();
  });

  it('uma nota bloqueada, ou em camada bloqueada, não abre edição pela ferramenta', () => {
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'locked', type: 'sticky', x: 0, y: 0, text: 'x', locked: true },
    });
    machine.process(pointer('POINTER_DOWN', 50, 50));
    // O hit-test ignora bloqueados: vira criação de uma nota nova por cima.
    expect(machine.getState()).toBe('creating');
  });

  describe('edição de uma nota existente', () => {
    beforeEach(() => {
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'note', type: 'sticky', x: 0, y: 0, text: 'antes' },
      });
      section.setTool('select');
    });

    it('duplo clique abre a edição e confirmar atualiza o texto numa entrada de histórico', () => {
      machine.process({ type: 'DOUBLE_CLICK', point: { x: 50, y: 50 }, button: 0 } as never);
      expect(machine.getState()).toBe('editing-text');
      expect(startEdit()).toMatchObject({ isNew: false, node: { id: 'note' } });

      const before = section.getSnapshot().document.nodes['note'] as StickyNode;
      machine.commitTextEdit('depois, com bastante texto para a fonte encolher dentro da nota');
      const after = section.getSnapshot().document.nodes['note'] as StickyNode;
      expect(after.text).toContain('depois');
      expect(after.fontSize).toBeLessThan(before.fontSize);
      expect(section.getSnapshot().session.selectedIds).toEqual(['note']);

      section.undo();
      expect(section.getSnapshot().document.nodes['note']).toMatchObject({
        text: 'antes',
        fontSize: before.fontSize,
      });
    });

    it('confirmar o mesmo texto não gera entrada de histórico', () => {
      machine.process({ type: 'DOUBLE_CLICK', point: { x: 50, y: 50 }, button: 0 } as never);
      const revision = section.getSnapshot().revision;
      machine.commitTextEdit('antes');
      expect(section.getSnapshot().revision).toBe(revision);
    });

    it('cancelar a edição mantém o texto anterior', () => {
      machine.process({ type: 'DOUBLE_CLICK', point: { x: 50, y: 50 }, button: 0 } as never);
      machine.cancelTextEdit();
      expect(section.getSnapshot().document.nodes['note']).toMatchObject({ text: 'antes' });
      expect(machine.getState()).toBe('idle');
    });

    it('duplo clique não abre nota bloqueada, nem o canvas somente leitura', () => {
      section.dispatch({ type: 'shape.update', id: 'note', patch: { locked: true } });
      machine.process({ type: 'DOUBLE_CLICK', point: { x: 50, y: 50 }, button: 0 } as never);
      expect(machine.getState()).toBe('idle');

      section.dispatch({ type: 'shape.update', id: 'note', patch: { locked: false } });
      section.setReadOnly(true);
      machine.process({ type: 'DOUBLE_CLICK', point: { x: 50, y: 50 }, button: 0 } as never);
      expect(machine.getState()).toBe('idle');
    });

    it('duplo clique não abre nota em camada bloqueada', () => {
      const layerId = section.getSnapshot().document.layers[0]!.id;
      section.dispatch({ type: 'layer.update', id: layerId, patch: { locked: true } });
      machine.process({ type: 'DOUBLE_CLICK', point: { x: 50, y: 50 }, button: 0 } as never);
      expect(machine.getState()).toBe('idle');
    });
  });
});
