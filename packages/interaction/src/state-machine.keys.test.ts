import { createCanvasSection, type CanvasSectionApi, type RectangleNode } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteractionStateMachine } from './state-machine.js';
import { getRotationHandlePoint } from './tools/rotate.js';

function down(machine: InteractionStateMachine, x: number, y: number, shiftKey = false): void {
  machine.process({
    type: 'POINTER_DOWN',
    pointerId: 1,
    pointerType: 'mouse',
    point: { x, y },
    button: 0,
    buttons: 1,
    shiftKey,
    spaceKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  });
}

function move(machine: InteractionStateMachine, x: number, y: number): void {
  machine.process({ type: 'POINTER_MOVE', pointerId: 1, point: { x, y }, buttons: 1 });
}

describe('InteractionStateMachine - Shift e Espaço durante os gestos', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;

  beforeEach(() => {
    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'box', type: 'rectangle', x: 50, y: 50, width: 100, height: 100, rotation: 0 },
    });
    machine = new InteractionStateMachine(section);
  });

  const shiftDown = () => machine.process({ type: 'KEY_DOWN', key: 'Shift', code: 'ShiftLeft' });
  const shiftUp = () => machine.process({ type: 'KEY_UP', key: 'Shift', code: 'ShiftLeft' });

  it('em criação, Shift liga e desliga a proporção do preview', () => {
    section.setTool('rectangle');
    down(machine, 300, 300);
    move(machine, 360, 330);
    expect(section.getPreview()?.additions[0]).toMatchObject({ width: 60, height: 30 });

    shiftDown();
    expect(machine.getData()).toMatchObject({ name: 'creating', shiftKey: true });
    expect(section.getPreview()?.additions[0]).toMatchObject({ width: 60, height: 60 });

    shiftUp();
    expect(machine.getData()).toMatchObject({ name: 'creating', shiftKey: false });
    expect(section.getPreview()?.additions[0]).toMatchObject({ width: 60, height: 30 });
  });

  it('em resize, Shift atualiza o estado e o preview', () => {
    section.setSelection(['box']);
    down(machine, 150, 150);
    expect(machine.getState()).toBe('resizing');

    shiftDown();
    expect(machine.getData()).toMatchObject({ name: 'resizing', shiftKey: true });
    shiftUp();
    expect(machine.getData()).toMatchObject({ name: 'resizing', shiftKey: false });
  });

  it('em rotação, Shift atualiza o estado e o preview', () => {
    section.setSelection(['box']);
    const node = section.getSnapshot().document.nodes['box'] as RectangleNode;
    const handle = getRotationHandlePoint([node], 1)!;
    down(machine, handle.x, handle.y);
    expect(machine.getState()).toBe('rotating');

    shiftDown();
    expect(machine.getData()).toMatchObject({ name: 'rotating', shiftKey: true });
    shiftUp();
    expect(machine.getData()).toMatchObject({ name: 'rotating', shiftKey: false });
  });

  it('em seleção pendente, Shift só atualiza o estado', () => {
    section.setTool('select');
    down(machine, 100, 100);
    expect(machine.getState()).toBe('selecting');

    shiftDown();
    expect(machine.getData()).toMatchObject({ name: 'selecting', shiftKey: true });
    shiftUp();
    expect(machine.getData()).toMatchObject({ name: 'selecting', shiftKey: false });
  });

  it('em marquee, Shift só atualiza o estado', () => {
    section.setTool('select');
    down(machine, 400, 400);
    move(machine, 450, 450);
    expect(machine.getState()).toBe('marquee');

    shiftDown();
    expect(machine.getData()).toMatchObject({ name: 'marquee', shiftKey: true });
    shiftUp();
    expect(machine.getData()).toMatchObject({ name: 'marquee', shiftKey: false });
  });

  it('Shift em repouso não muda o estado', () => {
    shiftDown();
    shiftUp();
    expect(machine.getState()).toBe('idle');
  });

  it('Espaço em repouso emite o cursor de mão e o devolve ao soltar', () => {
    const cursors: string[] = [];
    machine.onAction((action) => {
      if (action.type === 'SET_CURSOR') cursors.push(action.cursor);
    });

    machine.process({ type: 'KEY_DOWN', key: ' ', code: 'Space' });
    machine.process({ type: 'KEY_UP', key: ' ', code: 'Space' });
    expect(cursors).toEqual(['grab', 'default']);
  });

  it('Espaço fora de repouso não emite cursor', () => {
    section.setTool('rectangle');
    down(machine, 300, 300);
    const cursors: string[] = [];
    machine.onAction((action) => {
      if (action.type === 'SET_CURSOR') cursors.push(action.cursor);
    });

    machine.process({ type: 'KEY_DOWN', key: ' ', code: 'Space' });
    machine.process({ type: 'KEY_UP', key: ' ', code: 'Space' });
    expect(cursors).toEqual([]);
  });

  it('Escape cancela o gesto e restaura o repouso sem criar forma', () => {
    section.setTool('rectangle');
    down(machine, 300, 300);
    move(machine, 360, 360);
    machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

    expect(machine.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['box']);
  });
});

describe('InteractionStateMachine.editSelectedText: Enter abre o texto da forma (US-SL.8)', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;

  const create = (id: string, extra: Record<string, unknown> = {}, layerId?: string) =>
    section.dispatch({
      type: 'shape.create',
      ...(layerId === undefined ? {} : { layerId }),
      shape: { id, type: 'rectangle', x: 0, y: 0, width: 200, height: 100, rotation: 0, ...extra },
    } as never);

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
  });

  it('com uma só forma elegível selecionada, abre o editor e devolve true', () => {
    create('r');
    section.setSelection(['r']);

    expect(machine.editSelectedText()).toBe(true);

    expect(machine.getState()).toBe('editing-text');
    expect(machine.getData()).toMatchObject({ nodeId: 'r', isNew: false });
  });

  it('não faz nada com dois nós, sem seleção, com texto livre ou nota, ou em leitura', () => {
    create('a');
    create('b', { x: 400 });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'txt', type: 'text', x: 0, y: 300, width: 100, text: 'x' },
    } as never);
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'note', type: 'sticky', x: 0, y: 500 },
    } as never);

    section.setSelection(['a', 'b']);
    expect(machine.editSelectedText()).toBe(false);
    section.setSelection([]);
    expect(machine.editSelectedText()).toBe(false);
    section.setSelection(['txt']);
    expect(machine.editSelectedText()).toBe(false);
    section.setSelection(['note']);
    expect(machine.editSelectedText()).toBe(false);
    section.setSelection(['a']);
    section.setReadOnly(true);
    expect(machine.editSelectedText()).toBe(false);
    expect(machine.getState()).toBe('idle');
  });

  it('não abre com a forma bloqueada ou bloqueada por outra sessão', () => {
    create('lk', { locked: true });
    section.setSelection(['lk']);
    expect(machine.editSelectedText()).toBe(false);

    create('r', { x: 400 });
    section.setSelection(['r']);
    section.setPeers([
      {
        sessionId: 'outra',
        name: 'Bia',
        color: '#dc2626',
        cursor: null,
        selection: ['r'],
        selectedAt: 0,
        drag: null,
        view: null,
        locks: ['r'],
        followed: false,
      },
    ]);
    expect(machine.editSelectedText()).toBe(false);
  });

  it('forma dentro de grupo cuja camada é bloqueada depois continua selecionada e não abre', () => {
    section.dispatch({ type: 'layer.create', layer: { id: 'L2' } });
    create('a', {}, 'L2');
    create('b', { x: 400 }, 'L2');
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['a', 'b'] });
    section.setSelection(['a']);
    expect(section.getSnapshot().session.selectedIds).toEqual(['a']);

    section.dispatch({ type: 'layer.update', id: 'L2', patch: { locked: true } });

    // O nó segue na seleção: só o que fica oculto sai dela.
    expect(section.getSnapshot().session.selectedIds).toEqual(['a']);
    expect(machine.editSelectedText()).toBe(false);
    expect(machine.getState()).toBe('idle');
  });

  it('não abre com outro gesto em andamento', () => {
    create('r');
    section.setSelection(['r']);
    machine.startTextEdit(section.getSnapshot().document.nodes['r'] as never);
    expect(machine.getState()).toBe('editing-text');

    expect(machine.editSelectedText()).toBe(false);
  });
});
