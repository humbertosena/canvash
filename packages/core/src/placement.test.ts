import { describe, expect, it } from 'vitest';
import { emptyNodes, type CanvasDocument } from './document.js';
import { createPlacements } from './placement.js';
import type { BoardNode, CanvasNode, GroupNode, RectangleNode } from './shapes.js';

// A ordem visual percorre o board e, logo depois, os filhos dele (spec boards, §3.3).

const STYLE = { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 } as const;

const rectangle = (id: string): RectangleNode => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  visible: true,
  locked: false,
  style: STYLE,
});

const group = (id: string, childIds: string[]): GroupNode => ({
  id,
  type: 'group',
  childIds,
  visible: true,
  locked: false,
});

const board = (id: string, childIds: string[]): BoardNode => ({
  id,
  type: 'board',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  title: id,
  style: { fill: '#ffffff', fillOpacity: 1, stroke: null },
  childIds,
  visible: true,
  locked: false,
});

function documentOf(nodes: CanvasNode[], layerChildIds: string[]): CanvasDocument {
  return {
    schemaVersion: 1,
    id: 'doc',
    nodes: Object.assign(emptyNodes(), Object.fromEntries(nodes.map((node) => [node.id, node]))),
    layers: [{ id: 'l', name: 'L', visible: true, locked: false, childIds: layerChildIds }],
  };
}

describe('createPlacements com boards', () => {
  const doc = documentOf(
    [
      rectangle('before'),
      board('b', ['c1', 'g', 'c2']),
      rectangle('c1'),
      group('g', ['m1', 'm2']),
      rectangle('m1'),
      rectangle('m2'),
      rectangle('c2'),
      rectangle('after'),
    ],
    ['before', 'b', 'after'],
  );

  it('os filhos vêm logo depois do board, e o membro do grupo logo depois do grupo', () => {
    const placements = createPlacements()(doc);

    const order = [...placements.entries()]
      .sort(([, a], [, b]) => a.rank - b.rank)
      .map(([id]) => id);

    expect(order).toEqual(['before', 'b', 'c1', 'g', 'm1', 'm2', 'c2', 'after']);
  });

  it('US-BD.4 (core): o rank de cada filho é maior que o do board', () => {
    const placements = createPlacements()(doc);
    const rankOf = (id: string) => placements.get(id)!.rank;

    for (const id of ['c1', 'g', 'm1', 'm2', 'c2']) {
      expect(rankOf(id)).toBeGreaterThan(rankOf('b'));
    }
    expect(rankOf('after')).toBeGreaterThan(rankOf('c2'));
  });

  it('o filho herda o índice do board em Layer.childIds', () => {
    const placements = createPlacements()(doc);

    for (const id of ['b', 'c1', 'g', 'm1', 'm2', 'c2']) {
      expect(placements.get(id)!.index).toBe(1);
    }
    expect(placements.get('after')!.index).toBe(2);
  });

  it('boardId marca o filho, o grupo dentro do board e os membros dele', () => {
    const placements = createPlacements()(doc);

    expect(placements.get('b')!.boardId).toBeUndefined();
    expect(placements.get('c1')!.boardId).toBe('b');
    expect(placements.get('g')!.boardId).toBe('b');
    expect(placements.get('m1')).toMatchObject({ boardId: 'b', groupId: 'g' });
    expect(placements.get('before')!.boardId).toBeUndefined();
  });

  it('a camada de todo filho é a do board', () => {
    const placements = createPlacements()(doc);

    for (const id of ['c1', 'g', 'm1', 'c2']) expect(placements.get(id)!.layer.id).toBe('l');
  });

  it('sem boards, as posições são as de sempre', () => {
    const plain = documentOf(
      [rectangle('a'), group('g', ['m1']), rectangle('m1'), rectangle('z')],
      ['a', 'g', 'z'],
    );

    const placements = createPlacements()(plain);

    expect(placements.get('m1')).toMatchObject({ groupId: 'g', rank: 2, index: 1 });
    expect(placements.get('m1')!.boardId).toBeUndefined();
    expect(placements.get('z')).toMatchObject({ rank: 3, index: 2 });
  });
});
