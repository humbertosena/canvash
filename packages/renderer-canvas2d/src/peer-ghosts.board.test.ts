import {
  createCanvasSection,
  shapeBounds,
  type BoardNode,
  type CanvasSectionApi,
  type CanvasPeer,
} from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_GHOST_NODES, buildGhostParts, ghostIdsOf } from './peer-ghosts.js';

// A prévia remota do arrasto de um board (spec boards, US-BD.16): o board e os descendentes,
// deslocados juntos, na cor de quem arrasta.

const COLOR = '#dc2626';
const STYLE = { fill: '#ffffff', stroke: '#000000', strokeWidth: 4, opacity: 1 };

const peer = (overrides: Partial<CanvasPeer> = {}): CanvasPeer => ({
  sessionId: 'outra',
  name: 'Bia',
  color: COLOR,
  cursor: null,
  selection: ['b'],
  selectedAt: 1,
  drag: { ids: ['b', 'c', 'd'], dx: 30, dy: 10 },
  view: null,
  locks: ['b'],
  followed: false,
  ...overrides,
});

describe('prévia remota do arrasto de um board (US-BD.16)', () => {
  let section: CanvasSectionApi;

  const setup = (children = 2) => {
    const ids = Array.from({ length: children }, (_, i) =>
      i === 0 ? 'c' : i === 1 ? 'd' : `x${i}`,
    );
    const result = section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 100, y: 200, width: 300, height: 150 },
      },
      ...ids.map((id, i) => ({
        type: 'shape.create',
        shape: {
          id,
          type: 'rectangle',
          x: 110 + i,
          y: 230,
          width: 20,
          height: 20,
          rotation: 0,
          style: STYLE,
        },
      })),
      { type: 'board.attach', boardId: 'b', ids },
    ] as never);
    expect(result.ok).toBe(true);
    return ids;
  };
  const board = () => section.getSnapshot().document.nodes['b'] as BoardNode;
  const parts = (ids: string[], zoom = 1) =>
    buildGhostParts(section.getSnapshot().document, ids, COLOR, zoom);

  beforeEach(() => {
    section = createCanvasSection();
  });

  it('o board vira a moldura com a faixa do título, e os filhos o contorno deles', () => {
    setup();

    const built = parts(['b', 'c', 'd']);

    expect(built).toHaveLength(3);
    expect(built[0]).toEqual({
      kind: 'box',
      bounds: shapeBounds(board(), { stroke: false }),
      dashed: false,
    });
    expect(built[0]).toMatchObject({ bounds: { x: 100, y: 176, width: 300, height: 174 } });
    expect(built.slice(1).map((part) => part.kind)).toEqual(['item', 'item']);
  });

  it(`com ${MAX_GHOST_NODES} nós ainda desenha cada um, e acima disso só a caixa da união com a faixa`, () => {
    setup(MAX_GHOST_NODES - 1);
    const ids = [
      'b',
      'c',
      'd',
      ...Array.from({ length: MAX_GHOST_NODES - 3 }, (_, i) => `x${i + 2}`),
    ];
    expect(ids).toHaveLength(MAX_GHOST_NODES);
    expect(parts(ids)).toHaveLength(MAX_GHOST_NODES);

    section = createCanvasSection();
    const many = setup(MAX_GHOST_NODES);
    const built = parts(['b', ...many]);

    expect(built).toEqual([
      { kind: 'box', bounds: { x: 100, y: 176, width: 300, height: 174 }, dashed: true },
    ]);
  });

  it('ghostIdsOf traz o board e os descendentes que o remetente detém pelo board', () => {
    setup();

    expect(ghostIdsOf(section, peer()).length).toBe(0);
    section.setPeers([peer()]);

    expect(ghostIdsOf(section, section.getPeers()[0]!)).toEqual(['b', 'c', 'd']);
  });

  it('o descendente que outro participante venceu fica fora da prévia', () => {
    setup();
    section.setPeers([
      peer({ released: ['c'] }),
      peer({
        sessionId: 'beto',
        name: 'Beto',
        color: '#2563eb',
        selection: ['c'],
        locks: ['c'],
        drag: null,
      }),
    ]);

    expect(ghostIdsOf(section, section.getPeers()[0]!)).toEqual(['b', 'd']);
  });

  it('sem o bloqueio do board o remetente não desenha nada dele nem dos filhos', () => {
    setup();
    section.setPeers([peer({ locks: [] })]);

    expect(ghostIdsOf(section, section.getPeers()[0]!)).toEqual([]);
  });
});
