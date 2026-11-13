import { createCanvasSection, type CanvasPeer, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteractionStateMachine, type InteractionAction } from './state-machine.js';

// Edição do texto da forma pelo duplo clique (spec shape-label, US-SL.8 e US-SL.9).

const dblclick = (x: number, y: number) =>
  ({ type: 'DOUBLE_CLICK', point: { x, y }, button: 0 }) as const;
const down = (x: number, y: number) =>
  ({
    type: 'POINTER_DOWN',
    pointerId: 1,
    point: { x, y },
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    shiftKey: false,
    spaceKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  }) as const;
const up = (x: number, y: number) =>
  ({ type: 'POINTER_UP', pointerId: 1, point: { x, y }, button: 0 }) as const;

const NONE = { fill: null, stroke: null, strokeWidth: 0, opacity: 1 } as const;
const PEER = (locks: string[]): CanvasPeer => ({
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

describe('InteractionStateMachine: o texto da forma (US-SL.8)', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;
  let actions: InteractionAction[];

  const shape = (id: string, extra: Record<string, unknown> = {}, layerId?: string) =>
    section.dispatch({
      type: 'shape.create',
      ...(layerId === undefined ? {} : { layerId }),
      shape: {
        id,
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        rotation: 0,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        ...extra,
      },
    } as never);
  const labelOf = (id: string) =>
    (section.getSnapshot().document.nodes[id] as { label?: { text: string } }).label;
  const revision = () => section.getSnapshot().revision;

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    actions = [];
    machine.onAction((action) => actions.push(action));
  });

  it('o duplo clique numa forma elegível entra em editing-text com o nó', () => {
    shape('r', { label: { text: 'Olá' } });

    machine.process(dblclick(200, 150));

    expect(machine.getState()).toBe('editing-text');
    const start = actions.find((a) => a.type === 'START_TEXT_EDIT');
    expect(start).toMatchObject({ isNew: false, node: { id: 'r', type: 'rectangle' } });
    expect(machine.getData()).toMatchObject({ nodeId: 'r', initialText: 'Olá' });
    expect(section.getSnapshot().session.selectedIds).toEqual(['r']);
  });

  it('abre nas nove formas elegíveis', () => {
    const nine = [
      { type: 'rectangle' },
      { type: 'square', height: 200 },
      { type: 'ellipse' },
      { type: 'circle', height: 200 },
      { type: 'diamond' },
      { type: 'triangle' },
      { type: 'polygon', sides: 6, height: 200 },
      { type: 'cross', height: 200 },
      { type: 'chevron' },
    ];
    for (const extra of nine) {
      section = createCanvasSection();
      machine = new InteractionStateMachine(section);
      shape('s', { ...extra, label: { text: 'x' } });

      machine.process(dblclick(200, 150));

      expect(machine.getState(), String(extra.type)).toBe('editing-text');
    }
  });

  it('no interior de um retângulo sem preenchimento e sem texto, longe do contorno, também abre', () => {
    shape('r', { style: NONE });

    machine.process(dblclick(200, 150));

    expect(machine.getState()).toBe('editing-text');
    expect(machine.getData()).toMatchObject({ nodeId: 'r', initialText: '' });
  });

  it('o clique simples no mesmo ponto não seleciona a forma vazada', () => {
    shape('r', { style: NONE });
    section.setSelection([]);

    machine.process(down(200, 150));
    machine.process(up(200, 150));

    expect(section.getSnapshot().session.selectedIds).toEqual([]);
  });

  it('o commit grava o texto numa entrada de histórico, e o desfazer devolve a forma sem label', () => {
    shape('r');
    machine.process(dblclick(200, 150));
    const before = revision();

    machine.commitTextEdit('Primeira edição');

    expect(revision()).toBe(before + 1);
    expect(labelOf('r')).toMatchObject({ text: 'Primeira edição', verticalAlign: 'middle' });
    expect(section.getSnapshot().session.selectedIds).toEqual(['r']);
    section.undo();
    expect(labelOf('r')).toBeUndefined();
    section.redo();
    expect(labelOf('r')).toMatchObject({ text: 'Primeira edição' });
  });

  it('confirmar o mesmo texto, ou "" numa forma sem label, não gera entrada', () => {
    shape('r', { label: { text: 'Olá' } });
    shape('v', { x: 500 });

    machine.process(dblclick(200, 150));
    let before = revision();
    machine.commitTextEdit('Olá');
    expect(revision()).toBe(before);

    machine.process(dblclick(600, 150));
    before = revision();
    machine.commitTextEdit('');
    expect(revision()).toBe(before);
    expect(labelOf('v')).toBeUndefined();
  });

  it('o commit tira HTML do texto', () => {
    shape('r');
    machine.process(dblclick(200, 150));

    machine.commitTextEdit('<b>negrito</b> normal');

    expect(labelOf('r')?.text).toBe('negrito normal');
  });

  it('Esc (cancelTextEdit) cancela sem efeito', () => {
    shape('r', { label: { text: 'Olá' } });
    machine.process(dblclick(200, 150));
    const before = revision();

    machine.cancelTextEdit();

    expect(machine.getState()).toBe('idle');
    expect(revision()).toBe(before);
    expect(labelOf('r')?.text).toBe('Olá');
    expect(section.getPreview()).toBeNull();
  });

  it('durante a edição, a prévia mostra a forma sem o texto, e a seleção é mantida', () => {
    shape('r', { label: { text: 'Olá' } });

    machine.process(dblclick(200, 150));

    expect(section.getPreview()?.updates).toMatchObject({ r: { label: { text: '' } } });
    expect(section.getSnapshot().document.nodes['r']).toMatchObject({ label: { text: 'Olá' } });
    expect(section.getSnapshot().session.selectedIds).toEqual(['r']);
  });

  it('não abre com a forma bloqueada, em camada bloqueada ou oculta, em readOnly ou bloqueada por outra sessão', () => {
    shape('lk', { locked: true, label: { text: 'x' } });
    machine.process(dblclick(200, 150));
    expect(machine.getState()).toBe('idle');

    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    shape('r', { label: { text: 'x' } });
    section.setReadOnly(true);
    machine.process(dblclick(200, 150));
    expect(machine.getState()).toBe('idle');

    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    shape('r', { label: { text: 'x' } });
    section.setPeers([PEER(['r'])]);
    machine.process(dblclick(200, 150));
    expect(machine.getState()).toBe('idle');
  });

  it('não abre numa forma de camada bloqueada ou oculta', () => {
    for (const patch of [{ locked: true }, { visible: false }]) {
      section = createCanvasSection();
      machine = new InteractionStateMachine(section);
      section.dispatch({ type: 'layer.create', layer: { id: 'L2' } });
      shape('r', { label: { text: 'x' } }, 'L2');
      section.dispatch({ type: 'layer.update', id: 'L2', patch });

      machine.process(dblclick(200, 150));

      expect(machine.getState(), JSON.stringify(patch)).toBe('idle');
    }
  });

  it('abre numa forma dentro de grupo desbloqueado, e não em grupo bloqueado ou oculto', () => {
    shape('a', { label: { text: 'x' } });
    shape('b', { x: 500, label: { text: 'y' } });
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['a', 'b'] });

    machine.process(dblclick(200, 150));
    expect(machine.getState()).toBe('editing-text');
    machine.cancelTextEdit();

    section.dispatch({ type: 'layer.create', layer: { id: 'L2' } });
    for (const patch of [{ locked: true }, { visible: false }]) {
      section = createCanvasSection();
      machine = new InteractionStateMachine(section);
      shape('a', { label: { text: 'x' } });
      shape('b', { x: 500, label: { text: 'y' } });
      section.dispatch({ type: 'group.create', id: 'g', childIds: ['a', 'b'] });
      const document = section.getSnapshot().document;
      const group = document.nodes['g']!;
      section.replaceDocument({
        ...document,
        nodes: { ...document.nodes, g: { ...group, ...patch } },
      } as never);

      machine.process(dblclick(200, 150));

      expect(machine.getState(), JSON.stringify(patch)).toBe('idle');
    }
  });
});
