import {
  createCanvasSection,
  type CanvasSectionApi,
  type CanvasPeer,
  type InkNode,
  type Point,
  type PreviewShape,
} from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  executeDelete,
  executeGroup,
  executeNudge,
  executeReorder,
  executeUngroup,
} from './keyboard.js';
import {
  InteractionStateMachine,
  type InteractionAction,
  type PointerDownInput,
} from './state-machine.js';
import { executeMarqueeSelection } from './tools/marquee.js';
import { getMovableNodes } from './tools/move.js';

const down = (x: number, y: number, extra: Partial<PointerDownInput> = {}): PointerDownInput => ({
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
  ...extra,
});
const move = (x: number, y: number) =>
  ({ type: 'POINTER_MOVE', pointerId: 1, point: { x, y }, buttons: 1 }) as const;
const hover = (x: number, y: number) =>
  ({ type: 'POINTER_MOVE', pointerId: 1, point: { x, y }, buttons: 0 }) as const;
const up = (x: number, y: number) =>
  ({ type: 'POINTER_UP', pointerId: 1, point: { x, y }, button: 0 }) as const;

const peer = (locks: string[], overrides: Partial<CanvasPeer> = {}): CanvasPeer => ({
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
  ...overrides,
});

describe('InteractionStateMachine: nós bloqueados por outro participante (US-RL.1)', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;
  let actions: InteractionAction[];

  const rect = (id: string, x: number, y: number, w = 100, h = 100) =>
    section.dispatch({
      type: 'shape.create',
      shape: {
        id,
        type: 'rectangle',
        x,
        y,
        width: w,
        height: h,
        rotation: 0,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });
  const lock = (...ids: string[]) => section.setPeers([peer(ids)]);
  const selected = () => section.getSnapshot().session.selectedIds;
  const nodeX = (id: string) => (section.getSnapshot().document.nodes[id] as { x: number }).x;
  const cursors = () =>
    actions.filter((a) => a.type === 'SET_CURSOR').map((a) => (a as { cursor: string }).cursor);

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    actions = [];
    machine.onAction((action) => actions.push(action));
    rect('atras', 0, 0, 200, 200);
    rect('a', 20, 20);
    rect('b', 400, 0);
  });

  it('sem bloqueios o clique seleciona como antes', () => {
    machine.process(down(50, 50));
    machine.process(up(50, 50));

    expect(selected()).toEqual(['a']);
  });

  it('o clique em nó bloqueado não o seleciona nem seleciona o que está atrás', () => {
    lock('a');

    machine.process(down(50, 50));
    machine.process(up(50, 50));

    expect(selected()).toEqual([]);
    expect(machine.getState()).toBe('idle');
  });

  it('o clique em nó bloqueado preserva a seleção que já existia', () => {
    section.setSelection(['b']);
    lock('a');

    machine.process(down(50, 50));
    machine.process(up(50, 50));

    expect(selected()).toEqual(['b']);
  });

  it('o clique com Shift em nó bloqueado também não o adiciona', () => {
    section.setSelection(['b']);
    lock('a');

    machine.process(down(50, 50, { shiftKey: true }));
    machine.process(up(50, 50));

    expect(selected()).toEqual(['b']);
  });

  it('arrastar um nó bloqueado não o move nem inicia marquee', () => {
    lock('a');

    machine.process(down(50, 50));
    machine.process(move(90, 90));
    machine.process(move(150, 150));
    expect(machine.getState()).toBe('selecting');
    machine.process(up(150, 150));

    expect(nodeX('a')).toBe(20);
    expect(machine.getState()).toBe('idle');
    expect(selected()).toEqual([]);
  });

  it('a marquee que cobre o nó bloqueado não o inclui', () => {
    lock('a');

    const result = executeMarqueeSelection(
      section,
      { x: -10, y: -10, width: 700, height: 300 },
      'intersect',
      false,
      [],
    );

    expect(result).not.toContain('a');
    expect(result).toContain('b');
    expect(selected()).not.toContain('a');
  });

  it('uma seleção mista só move os nós livres', () => {
    section.setSelection(['a', 'b']);
    lock('a');

    expect(getMovableNodes(section, ['a', 'b']).map((n) => n.id)).toEqual(['b']);
    expect(executeNudge(section, ['a', 'b'], 'right', false)).toBe(true);
    expect(nodeX('a')).toBe(20);
    expect(nodeX('b')).toBe(401);
  });

  it('as alças de um nó selecionado e bloqueado não iniciam redimensionar nem girar', () => {
    section.setSelection(['a']);
    lock('a');

    // Canto inferior direito de `a`: onde fica a alça de redimensionamento.
    machine.process(down(120, 120));
    expect(machine.getState()).not.toBe('resizing');
    machine.process(up(120, 120));

    // Alça de rotação: acima do topo.
    machine.process(down(70, -4));
    expect(machine.getState()).not.toBe('rotating');
    machine.process(up(70, -4));
  });

  it('Delete ignora os nós bloqueados', () => {
    lock('a');

    expect(executeDelete(section, ['a', 'b'])).toBe(true);

    expect(section.getSnapshot().document.nodes['a']).toBeDefined();
    expect(section.getSnapshot().document.nodes['b']).toBeUndefined();
    expect(executeDelete(section, ['a'])).toBe(false);
  });

  it('agrupar, desagrupar e reordenar ignoram os nós bloqueados', () => {
    rect('c', 600, 0);
    lock('a');

    expect(executeGroup(section, ['a', 'b'])).toBe(false);
    expect(executeGroup(section, ['a', 'b', 'c'])).toBe(true);
    const group = Object.values(section.getSnapshot().document.nodes).find(
      (n) => n.type === 'group',
    );
    expect(group && 'childIds' in group ? group.childIds : []).toEqual(
      expect.not.arrayContaining(['a']),
    );

    const before = section.getSnapshot().revision;
    expect(executeReorder(section, ['a'], 'bringToFront')).toBe(false);
    expect(section.getSnapshot().revision).toBe(before);
  });

  it('desagrupar ignora o grupo bloqueado', () => {
    rect('c', 600, 0);
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['b', 'c'] });
    lock('g');

    expect(executeUngroup(section, ['g'])).toBe(false);
    expect(section.getSnapshot().document.nodes['g']).toBeDefined();
  });

  it('um grupo bloqueado trava o membro isolado', () => {
    rect('c', 600, 0);
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['b', 'c'] });
    lock('g');

    machine.process(down(450, 50));
    machine.process(up(450, 50));

    expect(selected()).toEqual([]);
  });

  it('o duplo clique num texto bloqueado não abre o editor', () => {
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'txt', type: 'text', x: 700, y: 700, width: 200, text: 'Olá', fontSize: 16 },
    });
    lock('txt');

    machine.process({ type: 'DOUBLE_CLICK', point: { x: 710, y: 710 }, button: 0 });

    expect(machine.getState()).toBe('idle');
    expect(actions.some((a) => a.type === 'START_TEXT_EDIT')).toBe(false);
  });

  it('o duplo clique num texto livre continua abrindo o editor', () => {
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'txt', type: 'text', x: 700, y: 700, width: 200, text: 'Olá', fontSize: 16 },
    });

    machine.process({ type: 'DOUBLE_CLICK', point: { x: 710, y: 710 }, button: 0 });

    expect(machine.getState()).toBe('editing-text');
  });

  it('a borracha não apaga traço bloqueado', () => {
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tinta',
        type: 'ink',
        strokes: [
          {
            points: [
              { x: 0, y: 500 },
              { x: 200, y: 500 },
            ],
          },
        ],
      } as never,
    });
    lock('tinta');
    section.setTool('eraser');
    const before = JSON.stringify(section.getSnapshot().document.nodes['tinta']);

    machine.process(down(100, 497));
    for (let x = 100; x <= 110; x += 1) machine.process(move(x, 500));
    machine.process(up(110, 500));

    expect(JSON.stringify(section.getSnapshot().document.nodes['tinta'])).toBe(before);
    expect((section.getSnapshot().document.nodes['tinta'] as InkNode).strokes).toHaveLength(1);
  });

  it('o cursor vira not-allowed sobre nó bloqueado e volta ao normal fora dele', () => {
    lock('a');

    machine.process(hover(50, 50));
    expect(cursors().at(-1)).toBe('not-allowed');

    machine.process(hover(300, 300));
    expect(cursors().at(-1)).toBe('default');
  });

  it('liberar o nó devolve o comportamento normal', () => {
    lock('a');
    machine.process(down(50, 50));
    machine.process(up(50, 50));
    expect(selected()).toEqual([]);

    section.setPeers([]);
    machine.process(down(50, 50));
    machine.process(up(50, 50));

    expect(selected()).toEqual(['a']);
  });

  it('os tipos usados no teste existem', () => {
    const point: Point = { x: 0, y: 0 };
    const shape: PreviewShape | undefined = undefined;
    expect(point.x).toBe(0);
    expect(shape).toBeUndefined();
  });
});

describe('InteractionStateMachine: board bloqueado por outro participante (US-BD.15)', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;

  const style = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 };
  const rect = (id: string, x: number, y: number) => ({
    id,
    type: 'rectangle',
    x,
    y,
    width: 50,
    height: 50,
    rotation: 0,
    style,
  });
  const selected = () => section.getSnapshot().session.selectedIds;
  const nodeOf = (id: string) => section.getSnapshot().document.nodes[id];

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    const result = section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 100, y: 100, width: 300, height: 200 },
      },
      { type: 'shape.create', shape: rect('c', 120, 120) },
      { type: 'shape.create', shape: rect('d', 300, 120) },
      { type: 'shape.create', shape: rect('m1', 120, 200) },
      { type: 'shape.create', shape: rect('m2', 200, 200) },
      { type: 'shape.create', shape: rect('fora', 600, 100) },
      { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      { type: 'board.attach', boardId: 'b', ids: ['c', 'd', 'g'] },
    ] as never);
    expect(result.ok).toBe(true);
    section.setPeers([peer(['b'])]);
  });

  it('o clique no filho, no membro do grupo e no fundo do board não seleciona nada', () => {
    for (const [x, y] of [
      [140, 140],
      [140, 220],
      [350, 280],
    ] as const) {
      machine.process(down(x, y));
      machine.process(up(x, y));
      expect(selected()).toEqual([]);
    }
  });

  it('o clique no título do board também não o seleciona', () => {
    machine.process(down(200, 88));
    machine.process(up(200, 88));

    expect(selected()).toEqual([]);
  });

  it('a marquee não pega o board nem os descendentes, só o que está fora', () => {
    const result = executeMarqueeSelection(
      section,
      { x: 0, y: 0, width: 800, height: 400 },
      'intersect',
      false,
      [],
    );

    expect(result).toEqual(['fora']);
  });

  it('arrastar o filho ou o título não move nada', () => {
    machine.process(down(140, 140));
    machine.process(move(200, 200));
    machine.process(up(200, 200));
    machine.process(down(200, 88));
    machine.process(move(260, 150));
    machine.process(up(260, 150));

    expect(nodeOf('b')).toMatchObject({ x: 100 });
    expect(nodeOf('c')).toMatchObject({ x: 120 });
    expect(nodeOf('m1')).toMatchObject({ x: 120 });
    expect(selected()).toEqual([]);
  });

  it('o board e os descendentes não se movem pelas setas nem são apagados', () => {
    expect(getMovableNodes(section, ['b'])).toEqual([]);
    expect(executeNudge(section, ['b'], 'right', false)).toBe(false);
    expect(executeDelete(section, ['b'])).toBe(false);
    expect(executeDelete(section, ['c', 'g'])).toBe(false);

    expect(nodeOf('b')).toBeDefined();
    expect(nodeOf('c')).toBeDefined();
    expect(nodeOf('m1')).toBeDefined();
  });

  it('o nó em released de A, detido por B, continua bloqueado; sem B, fica livre e os outros não', () => {
    section.setPeers([
      peer(['b'], { sessionId: 'a', released: ['c'] }),
      peer(['c'], { sessionId: 'b', name: 'Beto', color: '#2563eb' }),
    ]);
    machine.process(down(140, 140));
    machine.process(up(140, 140));
    expect(selected()).toEqual([]);

    section.setPeers([peer(['b'], { sessionId: 'a', released: ['c'] })]);
    machine.process(down(140, 140));
    machine.process(up(140, 140));
    expect(selected()).toEqual(['c']);

    machine.process(down(320, 140));
    machine.process(up(320, 140));
    expect(selected()).toEqual(['c']);
  });
});
