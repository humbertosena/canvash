import { createCanvasSection, type CanvasPeer, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildMoveCommands,
  buildMovePreviews,
  executeMove,
  findBoardDropTarget,
  getMovableNodes,
} from './move.js';

describe('move tool com boards (spec boards, §5.3 e US-BD.5)', () => {
  let section: CanvasSectionApi;

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
  const rect = (id: string, x: number) => ({
    type: 'shape.create' as const,
    shape: { id, type: 'rectangle' as const, x, y: 200, width: 20, height: 20, rotation: 0 },
  });
  const idsOf = (nodes: readonly { id: string }[]) => nodes.map((node) => node.id);
  const nodeAt = (id: string) =>
    section.getSnapshot().document.nodes[id] as { x: number; y: number };

  beforeEach(() => {
    section = createCanvasSection();
    section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 100, y: 150, width: 400, height: 200 },
      },
      rect('c1', 120),
      rect('m1', 200),
      rect('m2', 240),
      rect('c2', 300),
      rect('out', 700),
      { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      { type: 'board.attach', boardId: 'b', ids: ['c1', 'g', 'c2'] },
    ] as never);
  });

  it('um board selecionado expande para o board, os filhos e os membros dos grupos filhos', () => {
    const nodes = getMovableNodes(section, ['b']);

    expect(idsOf(nodes)).toEqual(['b', 'c1', 'm1', 'm2', 'c2']);
  });

  it('um descendente que também está na seleção não conta à parte', () => {
    const nodes = getMovableNodes(section, ['c1', 'b', 'g', 'out']);

    expect(idsOf(nodes).sort()).toEqual(['b', 'c1', 'c2', 'm1', 'm2', 'out']);
    expect(new Set(idsOf(nodes)).size).toBe(nodes.length);
  });

  it('um filho de board se move sozinho como os outros nós', () => {
    expect(idsOf(getMovableNodes(section, ['c1']))).toEqual(['c1']);
  });

  it('um descendente locked trava a seleção inteira, e não só o board', () => {
    section.dispatch({ type: 'shape.update', id: 'm2', patch: { locked: true } });

    expect(getMovableNodes(section, ['b'])).toEqual([]);
    expect(getMovableNodes(section, ['b', 'out'])).toEqual([]);
  });

  it('um descendente bloqueado por outra sessão trava a seleção inteira', () => {
    section.setPeers([peerLocking(['c2'])]);

    expect(getMovableNodes(section, ['b', 'out'])).toEqual([]);
  });

  it('o board locked, o board de uma camada bloqueada e o filho de board locked não se movem', () => {
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } });

    expect(getMovableNodes(section, ['b'])).toEqual([]);
    expect(getMovableNodes(section, ['c1'])).toEqual([]);
    expect(idsOf(getMovableNodes(section, ['out']))).toEqual(['out']);
  });

  it('uma camada bloqueada trava o board e os filhos', () => {
    const layerId = section.getSnapshot().document.layers[0]!.id;
    section.dispatch({ type: 'layer.update', id: layerId, patch: { locked: true } });

    expect(getMovableNodes(section, ['b', 'c1'])).toEqual([]);
  });

  it('o comando do board move só x e y, e o deslocamento é o mesmo em todos', () => {
    const commands = buildMoveCommands(getMovableNodes(section, ['b']), { x: 10, y: 20 });

    expect(commands).toHaveLength(5);
    expect(commands[0]).toEqual({
      type: 'shape.update',
      id: 'b',
      patch: { x: 110, y: 170 },
    });
    expect(commands[1]).toEqual({
      type: 'shape.update',
      id: 'c1',
      patch: expect.objectContaining({ x: 130, y: 220 }),
    });
  });

  it('executeMove desloca o board e todos os descendentes pelo mesmo vetor, numa entrada de histórico', () => {
    const before = section.getSnapshot().revision;

    executeMove(section, getMovableNodes(section, ['b']), { x: 30, y: -10 });

    expect(section.getSnapshot().revision).toBe(before + 1);
    expect(nodeAt('b')).toMatchObject({ x: 130, y: 140 });
    expect(nodeAt('c1')).toMatchObject({ x: 150, y: 190 });
    expect(nodeAt('m2')).toMatchObject({ x: 270, y: 190 });
    expect(nodeAt('out')).toMatchObject({ x: 700, y: 200 });
    section.undo();
    expect(nodeAt('b')).toMatchObject({ x: 100, y: 150 });
    expect(nodeAt('c2')).toMatchObject({ x: 300, y: 200 });
  });

  it('a prévia do arrasto traz o board e todos os descendentes deslocados', () => {
    const previews = buildMovePreviews(getMovableNodes(section, ['b']), { x: 5, y: 5 });

    expect(previews.map((preview) => preview.id)).toEqual(['b', 'c1', 'm1', 'm2', 'c2']);
    expect(previews[0]).toMatchObject({ type: 'board', x: 105, y: 155, title: 'Board' });
    expect(section.setPreview({ updates: previews }).ok).toBe(true);
    expect(section.getPreview()!.updates['m1']).toMatchObject({ x: 205, y: 205 });
  });
});

describe('pertença no fim do arrasto (spec boards, §5.2 e US-BD.3)', () => {
  let section: CanvasSectionApi;

  const rect = (id: string, x: number, y = 100) => ({
    type: 'shape.create' as const,
    shape: { id, type: 'rectangle' as const, x, y, width: 20, height: 20, rotation: 0 },
  });
  const board = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    type: 'shape.create' as const,
    shape: { id, type: 'board' as const, x, y, width: 200, height: 200, ...extra },
  });
  const childrenOf = (id: string) =>
    (section.getSnapshot().document.nodes[id] as unknown as { childIds: string[] }).childIds;
  const layerChildren = () => section.getSnapshot().document.layers[0]!.childIds;
  const drop = (ids: string[], delta: { x: number; y: number }, selected = ids) =>
    executeMove(section, getMovableNodes(section, ids), delta, { selectedIds: selected });

  beforeEach(() => {
    section = createCanvasSection();
    section.transact([
      board('b1', 0, 300),
      board('b2', 400, 300),
      rect('free', 600, 100),
      rect('kid', 20, 320),
      rect('kid2', 60, 320),
      { type: 'board.attach', boardId: 'b1', ids: ['kid', 'kid2'] },
    ] as never);
  });

  it('soltar um nó de nível superior com o centro dentro do board o põe no fim de childIds, numa entrada', () => {
    const revision = section.getSnapshot().revision;

    // O centro de `free` (610, 110) vai para (110, 410): dentro de b1 (0..200 × 300..500).
    drop(['free'], { x: -500, y: 300 });

    expect(childrenOf('b1')).toEqual(['kid', 'kid2', 'free']);
    expect(layerChildren()).toEqual(['b1', 'b2']);
    expect(section.getSnapshot().revision).toBe(revision + 1);
    section.undo();
    expect(childrenOf('b1')).toEqual(['kid', 'kid2']);
    expect(layerChildren()).toEqual(['b1', 'b2', 'free']);
    expect((section.getSnapshot().document.nodes['free'] as { x: number }).x).toBe(600);
  });

  it('soltar um filho com o centro fora o devolve à camada, logo à frente do board', () => {
    drop(['kid'], { x: 0, y: -250 });

    expect(childrenOf('b1')).toEqual(['kid2']);
    expect(layerChildren()).toEqual(['b1', 'kid', 'b2', 'free']);
  });

  it('soltar um filho com o centro dentro de outro board o move para ele', () => {
    drop(['kid'], { x: 420, y: 0 });

    expect(childrenOf('b1')).toEqual(['kid2']);
    expect(childrenOf('b2')).toEqual(['kid']);
  });

  it('soltar dentro do mesmo board não muda childIds nem gera comando de pertença', () => {
    const before = section.getSnapshot().document.layers;

    drop(['kid'], { x: 50, y: 20 });

    expect(childrenOf('b1')).toEqual(['kid', 'kid2']);
    expect(section.getSnapshot().document.layers).toBe(before);
  });

  it('US-BD.9: soltar um board com o centro dentro de outro board não o põe dentro', () => {
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'small', type: 'board', x: 700, y: 0, width: 50, height: 50 },
    } as never);

    // Centro de `small` (725, 25) vai para (125, 425): dentro de b1.
    drop(['small'], { x: -600, y: 400 });

    expect(layerChildren()).toContain('small');
    expect(childrenOf('b1')).toEqual(['kid', 'kid2']);
  });

  it('os boards em movimento não contam como destino', () => {
    // b2 e `free` movem juntos: o centro de `free` cai dentro de b2 antes do deslocamento? Não: b2
    // também se move, e um board que se move não recebe nada.
    drop(['b2', 'free'], { x: -100, y: 0 });

    expect(childrenOf('b2')).toEqual([]);
    expect(layerChildren()).toContain('free');
  });

  it('o board mais à frente vence quando dois se sobrepõem no ponto', () => {
    section.dispatch(board('front', 50, 350) as never);

    // Centro de `free` vai para (110, 410): dentro de b1 e de `front`; `front` está à frente.
    drop(['free'], { x: -500, y: 300 });

    expect(childrenOf('front')).toEqual(['free']);
    expect(childrenOf('b1')).toEqual(['kid', 'kid2']);
  });

  it('um board locked ou oculto não recebe o nó', () => {
    section.dispatch({ type: 'shape.update', id: 'b1', patch: { locked: true } } as never);
    section.dispatch({ type: 'shape.update', id: 'b2', patch: { visible: false } } as never);

    drop(['free'], { x: -500, y: 300 });
    drop(['free'], { x: 0, y: 0 });

    expect(layerChildren()).toContain('free');
    expect(childrenOf('b1')).toEqual(['kid', 'kid2']);
  });

  it('um grupo é a unidade: entra inteiro, e os membros acompanham', () => {
    section.transact([
      rect('g1', 600, 40),
      rect('g2', 640, 40),
      { type: 'group.create', id: 'grp', childIds: ['g1', 'g2'] },
    ] as never);

    drop(['grp'], { x: -500, y: 360 });

    expect(childrenOf('b1')).toEqual(['kid', 'kid2', 'grp']);
  });

  it('um descendente selecionado junto com o board não conta à parte', () => {
    const revision = section.getSnapshot().revision;

    drop(['b1', 'kid'], { x: 700, y: 0 }, ['b1', 'kid']);

    expect(section.getSnapshot().revision).toBe(revision + 1);
    expect(childrenOf('b1')).toEqual(['kid', 'kid2']);
  });

  it('duas unidades com destinos diferentes: cada uma vai para o seu', () => {
    section.dispatch(rect('also', 1000, 100) as never);

    // `free` vai para (110, 410), dentro de b1; `also`, para (510, 410), dentro de b2.
    drop(['free', 'also'], { x: -500, y: 300 });

    expect(childrenOf('b2')).toEqual(['also']);
    expect(childrenOf('b1')).toEqual(['kid', 'kid2', 'free']);
  });

  it('sem selectedIds (as setas), a pertença não é recalculada', () => {
    executeMove(section, getMovableNodes(section, ['free']), { x: -500, y: 300 });

    expect(childrenOf('b1')).toEqual(['kid', 'kid2']);
    expect(layerChildren()).toContain('free');
  });

  it('uma unidade de outra camada não entra no board', () => {
    section.dispatch({ type: 'layer.create', layer: { id: 'other' } });
    section.dispatch({ ...rect('far', 600, 100), layerId: 'other' } as never);

    drop(['far'], { x: -500, y: 300 });

    expect(childrenOf('b1')).toEqual(['kid', 'kid2']);
  });
});

describe('alvo de soltura do arrasto (findBoardDropTarget)', () => {
  it('devolve o board de destino da primeira unidade que cai num, ou undefined', () => {
    const section = createCanvasSection();
    section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 200, height: 200 },
      },
      {
        type: 'shape.create',
        shape: { id: 'r', type: 'rectangle', x: 500, y: 100, width: 20, height: 20, rotation: 0 },
      },
    ] as never);

    expect(findBoardDropTarget(section, ['r'], { x: -400, y: 0 })).toBe('b');
    expect(findBoardDropTarget(section, ['r'], { x: 0, y: 0 })).toBeUndefined();
  });
});
