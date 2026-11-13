import { createCanvasSection, type BoardNode, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getDocumentCollections, initYjsDocument } from './crdt-schema.js';
import { RECOVERY_LAYER_ID, projectYDocToCanvasDocument } from './projection.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

// O board no Y.Doc (spec boards, US-BD.14): a escrita, a projeção e a convergência entre sessões.

const BOX = { x: 0, y: 0, width: 100, height: 60, rotation: 0 } as const;

/** Um registro de forma ou de board no Y.Doc, como outra sessão o escreveria. */
function putRecord(
  ydoc: Y.Doc,
  id: string,
  type: string,
  placement: { parentId: string; orderKey: string },
  fields: Record<string, unknown> = {},
): void {
  const { shapes } = getDocumentCollections(ydoc);
  const map = new Y.Map<unknown>();
  map.set('id', id);
  map.set('type', type);
  map.set('placement', placement);
  map.set('geometry', { ...BOX });
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  shapes.set(id, map);
}

function putGroup(
  ydoc: Y.Doc,
  id: string,
  placement: { parentId: string; orderKey: string },
): void {
  const { groups } = getDocumentCollections(ydoc);
  const map = new Y.Map<unknown>();
  map.set('id', id);
  map.set('placement', placement);
  groups.set(id, map);
}

function freshDoc(): Y.Doc {
  const ydoc = new Y.Doc();
  initYjsDocument(ydoc);
  return ydoc;
}

const LAYER = { parentId: 'layer-default', orderKey: 'm_0' };

describe('board no Y.Doc: projeção', () => {
  it('projeta o board com título, estilo, geometria sem rotação e os filhos em ordem', () => {
    const ydoc = freshDoc();
    putRecord(ydoc, 'b', 'board', LAYER, {
      title: 'Fluxo',
      fill: '#EFF6FF',
      fillOpacity: 0.4,
      stroke: null,
    });
    putRecord(ydoc, 'c2', 'rectangle', { parentId: 'b', orderKey: 'b_000001' });
    putRecord(ydoc, 'c1', 'rectangle', { parentId: 'b', orderKey: 'b_000000' });

    const projected = projectYDocToCanvasDocument(ydoc);

    expect(projected.nodes['b']).toMatchObject({
      type: 'board',
      title: 'Fluxo',
      x: 0,
      width: 100,
      height: 60,
      style: { fill: '#eff6ff', fillOpacity: 0.4, stroke: null },
      childIds: ['c1', 'c2'],
    });
    expect(projected.layers[0]!.childIds).toEqual(['b']);
  });

  it('projeta um documento aceito por replaceDocument', () => {
    const ydoc = freshDoc();
    putRecord(ydoc, 'b', 'board', LAYER, { title: 'Fluxo' });
    putRecord(ydoc, 'c', 'rectangle', { parentId: 'b', orderKey: 'b_000000' });
    const section = createCanvasSection();

    expect(section.replaceDocument(projectYDocToCanvasDocument(ydoc)).ok).toBe(true);
  });

  it('um grupo dentro do board vira filho do board, com os membros no grupo', () => {
    const ydoc = freshDoc();
    putRecord(ydoc, 'b', 'board', LAYER, { title: 'Fluxo' });
    putGroup(ydoc, 'g', { parentId: 'b', orderKey: 'b_000001' });
    putRecord(ydoc, 'm1', 'rectangle', { parentId: 'g', orderKey: 'm_0' });
    putRecord(ydoc, 'm2', 'rectangle', { parentId: 'g', orderKey: 'm_1' });
    putRecord(ydoc, 'c', 'rectangle', { parentId: 'b', orderKey: 'b_000000' });

    const projected = projectYDocToCanvasDocument(ydoc);

    expect((projected.nodes['b'] as BoardNode).childIds).toEqual(['c', 'g']);
    expect(projected.nodes['g']).toMatchObject({ type: 'group', childIds: ['m1', 'm2'] });
    expect(projected.layers[0]!.childIds).toEqual(['b']);
  });

  it('título, opacidade e cores inválidos voltam ao padrão', () => {
    const cases: Array<Record<string, unknown>> = [
      { title: '', fillOpacity: 7, fill: 'azul', stroke: 12 },
      { title: 'a\nb', fillOpacity: -1 },
      { title: '<b>x</b>', fillOpacity: 'metade' },
      { title: 'x'.repeat(201), fillOpacity: Number.NaN },
      { title: 42 },
      {},
    ];
    for (const fields of cases) {
      const ydoc = freshDoc();
      putRecord(ydoc, 'b', 'board', LAYER, fields);

      const board = projectYDocToCanvasDocument(ydoc).nodes['b'] as BoardNode;

      expect(board.title).toBe('Board');
      expect(board.style.fillOpacity).toBe(1);
      expect(board.style.fill).toBe('#ffffff');
      expect(board.style.stroke).toBe('#d4d4d8');
    }
  });

  it('um board de pai inválido, ou dentro de outro board, vai para a primeira camada', () => {
    const ydoc = freshDoc();
    putRecord(ydoc, 'outer', 'board', LAYER, { title: 'A' });
    putRecord(ydoc, 'lost', 'board', { parentId: 'nao-existe', orderKey: 'm_1' }, { title: 'B' });
    putRecord(ydoc, 'inner', 'board', { parentId: 'outer', orderKey: 'm_2' }, { title: 'C' });

    const projected = projectYDocToCanvasDocument(ydoc);

    expect(projected.layers[0]!.childIds).toEqual(['outer', 'lost', 'inner']);
    expect((projected.nodes['outer'] as BoardNode).childIds).toEqual([]);
    expect(projected.layers.some((layer) => layer.id === RECOVERY_LAYER_ID)).toBe(false);
  });

  it('o nó cujo board foi apagado vai para a camada de recuperação', () => {
    const ydoc = freshDoc();
    putRecord(ydoc, 'b', 'board', LAYER, { title: 'Fluxo', isDeleted: true });
    putRecord(ydoc, 'c', 'rectangle', { parentId: 'b', orderKey: 'b_000000' });

    const projected = projectYDocToCanvasDocument(ydoc);

    expect(projected.nodes['b']).toBeUndefined();
    expect(projected.layers.find((layer) => layer.id === RECOVERY_LAYER_ID)?.childIds).toEqual([
      'c',
    ]);
  });

  it('o grupo cujo board foi apagado vai para a recuperação com os membros', () => {
    const ydoc = freshDoc();
    putRecord(ydoc, 'b', 'board', LAYER, { title: 'Fluxo', isDeleted: true });
    putGroup(ydoc, 'g', { parentId: 'b', orderKey: 'b_000000' });
    putRecord(ydoc, 'm1', 'rectangle', { parentId: 'g', orderKey: 'm_0' });
    putRecord(ydoc, 'm2', 'rectangle', { parentId: 'g', orderKey: 'm_1' });

    const projected = projectYDocToCanvasDocument(ydoc);

    expect(projected.layers.find((layer) => layer.id === RECOVERY_LAYER_ID)?.childIds).toEqual([
      'g',
    ]);
    expect(projected.nodes['g']).toMatchObject({ childIds: ['m1', 'm2'] });
    expect(projected.layers[0]!.childIds).toEqual([]);
  });

  it('o grupo de pai inválido fora de board continua indo para a primeira camada', () => {
    const ydoc = freshDoc();
    putGroup(ydoc, 'g', { parentId: 'nao-existe', orderKey: 'g_0' });
    putRecord(ydoc, 'm1', 'rectangle', { parentId: 'g', orderKey: 'm_0' });

    const projected = projectYDocToCanvasDocument(ydoc);

    expect(projected.layers[0]!.childIds).toEqual(['g']);
    expect(projected.layers.some((layer) => layer.id === RECOVERY_LAYER_ID)).toBe(false);
  });

  it('sem nada apagado, não cria a camada de recuperação', () => {
    const ydoc = freshDoc();
    putRecord(ydoc, 'b', 'board', LAYER, { title: 'Fluxo' });
    putRecord(ydoc, 'c', 'rectangle', { parentId: 'b', orderKey: 'b_000000' });

    expect(
      projectYDocToCanvasDocument(ydoc).layers.some((layer) => layer.id === RECOVERY_LAYER_ID),
    ).toBe(false);
  });
});

async function twoSessions() {
  const server = new CollaborativeServerEmulator();
  const transport = new DeterministicTransportHub(server);
  const provider = new YjsCollaborationProvider({ server, transport });
  const sectionA = createCanvasSection();
  const sectionB = createCanvasSection();
  const connA = await provider.connect({ documentId: 'doc-boards', section: sectionA });
  const connB = await provider.connect({ documentId: 'doc-boards', section: sectionB });
  if (!connA.ok || !connB.ok) throw new Error('conexão recusada');
  return {
    sectionA,
    sectionB,
    sessionA: connA.value,
    sessionB: connB.value,
    close: () => {
      connA.value.destroy();
      connB.value.destroy();
      server.destroy();
    },
  };
}

/** O shape de um board novo: sem rotação, que o board não aceita. */
const boardShape = (id: string, title = 'Board', x = 0) => ({
  id,
  type: 'board',
  x,
  y: 0,
  width: 100,
  height: 60,
  title,
});

/** Aplica os comandos e confere que o canvas os aceitou. */
function apply(section: CanvasSectionApi, commands: unknown[]): void {
  const result = section.transact(commands as never);
  expect(result.ok).toBe(true);
}

const rect = (id: string, x = 0) => ({
  id,
  type: 'rectangle',
  x,
  y: 0,
  width: 20,
  height: 20,
  rotation: 0,
});

const node = (section: CanvasSectionApi, id: string) => section.getSnapshot().document.nodes[id];
const boardOf = (section: CanvasSectionApi, id: string) => node(section, id) as BoardNode;

// Cada canvas nasce com uma camada de ID próprio, então só os nós e o que mora nas camadas se
// comparam: a lista dos nós de nível superior, em ordem.
const topLevelIds = (section: CanvasSectionApi): string[] =>
  section.getSnapshot().document.layers.flatMap((layer) => [...layer.childIds]);

function expectConverged(a: CanvasSectionApi, b: CanvasSectionApi): void {
  expect(b.getSnapshot().document.nodes).toEqual(a.getSnapshot().document.nodes);
  expect(topLevelIds(b)).toEqual(topLevelIds(a));
}

describe('board entre sessões: convergência', () => {
  it('criar, mover, redimensionar, renomear e mudar o estilo chegam à outra sessão', async () => {
    const { sectionA, sectionB, close } = await twoSessions();
    apply(sectionA, [
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 10, y: 20, width: 300, height: 200, title: 'Fluxo' },
      },
      { type: 'shape.create', shape: rect('c', 30) },
      { type: 'board.attach', boardId: 'b', ids: ['c'] },
    ]);
    expectConverged(sectionA, sectionB);
    expect(boardOf(sectionB, 'b')).toMatchObject({ title: 'Fluxo', childIds: ['c'], x: 10 });

    apply(sectionA, [
      { type: 'shape.update', id: 'b', patch: { x: 50, y: 60 } },
      { type: 'shape.update', id: 'c', patch: { x: 70, y: 40 } },
    ]);
    sectionA.dispatch({ type: 'shape.update', id: 'b', patch: { width: 400, height: 250 } });
    sectionA.dispatch({ type: 'shape.update', id: 'b', patch: { title: 'Jornada' } });
    sectionA.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: { style: { fill: null, fillOpacity: 0.3, stroke: '#112233' } },
    });

    expectConverged(sectionA, sectionB);
    expect(boardOf(sectionB, 'b')).toMatchObject({
      x: 50,
      y: 60,
      width: 400,
      height: 250,
      title: 'Jornada',
      style: { fill: null, fillOpacity: 0.3, stroke: '#112233' },
      childIds: ['c'],
    });
    expect(node(sectionB, 'c')).toMatchObject({ x: 70, y: 40 });
    close();
  });

  it('mudar a pertença chega à outra sessão: entrar, sair e trocar de board', async () => {
    const { sectionA, sectionB, close } = await twoSessions();
    apply(sectionA, [
      { type: 'shape.create', shape: boardShape('b1', 'Um') },
      {
        type: 'shape.create',
        shape: { id: 'b2', type: 'board', x: 500, y: 0, width: 100, height: 60, title: 'Dois' },
      },
      { type: 'shape.create', shape: rect('n', 10) },
      { type: 'shape.create', shape: rect('m', 40) },
    ]);

    sectionA.dispatch({ type: 'board.attach', boardId: 'b1', ids: ['n', 'm'] });
    expectConverged(sectionA, sectionB);
    expect(boardOf(sectionB, 'b1').childIds).toEqual(['n', 'm']);

    sectionA.dispatch({ type: 'board.attach', boardId: 'b2', ids: ['n'] });
    expectConverged(sectionA, sectionB);
    expect(boardOf(sectionB, 'b1').childIds).toEqual(['m']);
    expect(boardOf(sectionB, 'b2').childIds).toEqual(['n']);

    sectionA.dispatch({ type: 'board.detach', ids: ['m'] });
    expectConverged(sectionA, sectionB);
    expect(boardOf(sectionB, 'b1').childIds).toEqual([]);
    expect(topLevelIds(sectionB)).toContain('m');
    close();
  });

  it('a ordem dos filhos do board, grupos incluídos, chega igual', async () => {
    const { sectionA, sectionB, close } = await twoSessions();
    apply(sectionA, [
      { type: 'shape.create', shape: boardShape('b') },
      ...Array.from({ length: 12 }, (_, i) => ({ type: 'shape.create', shape: rect(`c${i}`, i) })),
      { type: 'group.create', id: 'g', childIds: ['c3', 'c4'] },
      {
        type: 'board.attach',
        boardId: 'b',
        ids: ['c0', 'c1', 'g', 'c2', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'],
      },
    ]);

    expectConverged(sectionA, sectionB);
    expect(boardOf(sectionB, 'b').childIds).toEqual(boardOf(sectionA, 'b').childIds);
    expect(boardOf(sectionB, 'b').childIds).toHaveLength(11);
    expect(boardOf(sectionB, 'b').childIds).toContain('g');
    close();
  });

  it('apagar o board apaga os filhos nas duas sessões', async () => {
    const { sectionA, sectionB, close } = await twoSessions();
    apply(sectionA, [
      { type: 'shape.create', shape: boardShape('b') },
      { type: 'shape.create', shape: rect('c') },
      { type: 'board.attach', boardId: 'b', ids: ['c'] },
    ]);

    sectionA.dispatch({ type: 'shape.remove', id: 'b' });

    expectConverged(sectionA, sectionB);
    expect(node(sectionB, 'b')).toBeUndefined();
    expect(node(sectionB, 'c')).toBeUndefined();
    close();
  });

  it('A e B soltam o mesmo nó em boards diferentes ao mesmo tempo: as duas terminam com o nó no mesmo board', async () => {
    const { sectionA, sectionB, sessionA, sessionB, close } = await twoSessions();
    apply(sectionA, [
      { type: 'shape.create', shape: boardShape('b1', 'Um') },
      {
        type: 'shape.create',
        shape: { id: 'b2', type: 'board', x: 500, y: 0, width: 100, height: 60, title: 'Dois' },
      },
      { type: 'shape.create', shape: rect('n', 10) },
    ]);
    expectConverged(sectionA, sectionB);

    sessionA.disconnect();
    sessionB.disconnect();
    sectionA.dispatch({ type: 'board.attach', boardId: 'b1', ids: ['n'] });
    sectionB.dispatch({ type: 'board.attach', boardId: 'b2', ids: ['n'] });
    await sessionA.reconnect();
    await sessionB.reconnect();

    expectConverged(sectionA, sectionB);
    const owners = ['b1', 'b2'].filter((id) => boardOf(sectionA, id).childIds.includes('n'));
    expect(owners).toHaveLength(1);
    expect(topLevelIds(sectionA)).not.toContain('n');
    close();
  });

  it('A apaga o board enquanto B põe um nó nele: o nó de B aparece na camada de recuperação', async () => {
    const { sectionA, sectionB, sessionB, close } = await twoSessions();
    // O nó vem antes do board na camada: apagar o board não muda a posição dele, então a sessão A
    // não regrava o posicionamento do nó e a escrita de B não disputa com ela.
    apply(sectionA, [
      { type: 'shape.create', shape: rect('n', 10) },
      { type: 'shape.create', shape: boardShape('b') },
    ]);
    expectConverged(sectionA, sectionB);

    sessionB.disconnect();
    sectionA.dispatch({ type: 'shape.remove', id: 'b' });
    sectionB.dispatch({ type: 'board.attach', boardId: 'b', ids: ['n'] });
    await sessionB.reconnect();

    expectConverged(sectionA, sectionB);
    expect(node(sectionA, 'b')).toBeUndefined();
    const recovery = sectionA
      .getSnapshot()
      .document.layers.find((layer) => layer.id === RECOVERY_LAYER_ID);
    expect(recovery?.childIds).toEqual(['n']);
    close();
  });

  it('A apaga o board enquanto B põe um grupo nele: o grupo vai para a recuperação com os membros', async () => {
    const { sectionA, sectionB, sessionB, close } = await twoSessions();
    apply(sectionA, [
      { type: 'shape.create', shape: rect('m1', 10) },
      { type: 'shape.create', shape: rect('m2', 40) },
      { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      { type: 'shape.create', shape: boardShape('b') },
    ]);
    expectConverged(sectionA, sectionB);

    sessionB.disconnect();
    sectionA.dispatch({ type: 'shape.remove', id: 'b' });
    sectionB.dispatch({ type: 'board.attach', boardId: 'b', ids: ['g'] });
    await sessionB.reconnect();

    expectConverged(sectionA, sectionB);
    const recovery = sectionA
      .getSnapshot()
      .document.layers.find((layer) => layer.id === RECOVERY_LAYER_ID);
    expect(recovery?.childIds).toEqual(['g']);
    expect(node(sectionA, 'g')).toMatchObject({ type: 'group', childIds: ['m1', 'm2'] });
    close();
  });
});
