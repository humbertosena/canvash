import { describe, expect, it } from 'vitest';
import {
  BOARDS_BENCHMARK_BOARD_ID,
  BOARDS_BENCHMARK_BOX,
  BOARDS_BENCHMARK_CHILDREN,
  generateBoardsBenchmarkScene,
  type BoardsBenchmarkBoard,
} from './scene-boards.js';

describe('gerador da cena de benchmark dos boards', () => {
  it('é determinístico com semente fixa e muda com outra', () => {
    expect(generateBoardsBenchmarkScene(42, 1500)).toEqual(generateBoardsBenchmarkScene(42, 1500));
    expect(generateBoardsBenchmarkScene(7, 1500)).not.toEqual(
      generateBoardsBenchmarkScene(42, 1500),
    );
  });

  it('gera 10.000 nós num documento schema v1, numa camada', () => {
    const doc = generateBoardsBenchmarkScene();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.id).toBe('doc-benchmark-boards-42');
    expect(Object.keys(doc.nodes)).toHaveLength(10000);
    expect(doc.layers).toHaveLength(1);
  });

  it('tem um board com 1.000 filhos, fora de Layer.childIds', () => {
    const doc = generateBoardsBenchmarkScene();
    const board = doc.nodes[BOARDS_BENCHMARK_BOARD_ID] as BoardsBenchmarkBoard;
    expect(board.type).toBe('board');
    expect(board.childIds).toHaveLength(BOARDS_BENCHMARK_CHILDREN);
    const layer = new Set(doc.layers[0]!.childIds);
    expect(layer.has(BOARDS_BENCHMARK_BOARD_ID)).toBe(true);
    for (const id of board.childIds) expect(layer.has(id)).toBe(false);
    expect(layer.size).toBe(10000 - BOARDS_BENCHMARK_CHILDREN);
  });

  it('os filhos ficam dentro do board e as formas soltas fora dele', () => {
    const doc = generateBoardsBenchmarkScene();
    const box = BOARDS_BENCHMARK_BOX;
    for (const [id, node] of Object.entries(doc.nodes)) {
      if (node.type === 'board') continue;
      const inside =
        node.x >= box.x &&
        node.y >= box.y &&
        node.x + node.width <= box.x + box.width &&
        node.y + node.height <= box.y + box.height;
      expect(inside).toBe(id.startsWith('child-'));
    }
  });
});
