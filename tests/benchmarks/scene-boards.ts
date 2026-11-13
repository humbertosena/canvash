/**
 * Gerador determinístico da cena de benchmark dos boards: 10.000 nós, com 8.999 retângulos e
 * elipses soltos espalhados como na cena do Marco 2, um board grande e 1.000 filhos dentro dele.
 *
 * Mesmo PRNG e mesma semente da cena do Marco 2, para a medição ser reproduzível. O board e os
 * filhos ficam na origem, à vista no viewport do benchmark com o zoom do arrasto (0,5), e os
 * filhos moram em `childIds` do board, fora de `Layer.childIds`.
 */

import { createPrng } from './scene.js';

export { createPrng } from './scene.js';

/** Quantos filhos o board da cena tem. */
export const BOARDS_BENCHMARK_CHILDREN = 1000;
/** O ID do board da cena. */
export const BOARDS_BENCHMARK_BOARD_ID = 'board-main';

export interface BoardsBenchmarkShape {
  readonly id: string;
  readonly type: 'rectangle' | 'ellipse';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly style: {
    readonly fill: string;
    readonly stroke: string;
    readonly strokeWidth: number;
    readonly opacity: number;
  };
}

export interface BoardsBenchmarkBoard {
  readonly id: string;
  readonly type: 'board';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly style: { readonly fill: string; readonly fillOpacity: number; readonly stroke: string };
  readonly childIds: readonly string[];
  readonly visible: boolean;
  readonly locked: boolean;
}

export interface BoardsBenchmarkDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly nodes: Record<string, BoardsBenchmarkShape | BoardsBenchmarkBoard>;
  readonly layers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly visible: boolean;
    readonly locked: boolean;
    readonly childIds: readonly string[];
  }>;
}

const PALETTE = [
  '#fef3c7',
  '#dbeafe',
  '#dcfce7',
  '#fee2e2',
  '#ede9fe',
  '#cffafe',
  '#ffedd5',
  '#e2e8f0',
] as const;

/** A caixa do board: na origem, com folga para os filhos em grade de 50 por 20. */
export const BOARDS_BENCHMARK_BOX = { x: 100, y: 100, width: 2500, height: 1500 } as const;

/**
 * Gera o documento: `totalNodes - 1001` formas soltas, o board e os 1.000 filhos. Os filhos
 * seguem uma grade de 50 colunas por 20 linhas dentro do board, sem rotação.
 */
export function generateBoardsBenchmarkScene(
  seed = 42,
  totalNodes = 10000,
): BoardsBenchmarkDocument {
  const random = createPrng(seed);
  const nodes: Record<string, BoardsBenchmarkShape | BoardsBenchmarkBoard> = {};
  const layerChildIds: string[] = [];
  const free = totalNodes - BOARDS_BENCHMARK_CHILDREN - 1;

  for (let i = 0; i < free; i += 1) {
    const id = `node-${i}`;
    const type = i % 4 < 2 ? 'rectangle' : 'ellipse';
    // Soltas fora da área do board, para o arrasto dele não passar por cima delas.
    const x = Math.round((random() * 5000 + 2800) * 10) / 10;
    const y = Math.round((random() * 4000 - 2000) * 10) / 10;
    const width = Math.round((30 + random() * 90) * 10) / 10;
    const height = Math.round((20 + random() * 60) * 10) / 10;
    const rotation = Math.round((random() * 2 * Math.PI - Math.PI) * 100) / 100;
    const fill = PALETTE[Math.floor(random() * PALETTE.length)] ?? '#dbeafe';
    const strokeWidth = Math.floor(random() * 3) + 1;
    const opacity = Math.round((0.8 + random() * 0.2) * 100) / 100;
    nodes[id] = {
      id,
      type,
      x,
      y,
      width,
      height,
      rotation,
      visible: true,
      locked: false,
      style: { fill, stroke: '#0f172a', strokeWidth, opacity },
    };
    layerChildIds.push(id);
  }

  const childIds: string[] = [];
  for (let i = 0; i < BOARDS_BENCHMARK_CHILDREN; i += 1) {
    const id = `child-${i}`;
    const column = i % 50;
    const row = Math.floor(i / 50);
    nodes[id] = {
      id,
      type: i % 2 === 0 ? 'rectangle' : 'ellipse',
      x: BOARDS_BENCHMARK_BOX.x + 20 + column * 48,
      y: BOARDS_BENCHMARK_BOX.y + 20 + row * 72,
      width: 36 + (i % 7),
      height: 48 + (i % 5),
      rotation: 0,
      visible: true,
      locked: false,
      style: {
        fill: PALETTE[i % PALETTE.length] ?? '#dbeafe',
        stroke: '#0f172a',
        strokeWidth: 1,
        opacity: 1,
      },
    };
    childIds.push(id);
  }

  nodes[BOARDS_BENCHMARK_BOARD_ID] = {
    id: BOARDS_BENCHMARK_BOARD_ID,
    type: 'board',
    ...BOARDS_BENCHMARK_BOX,
    title: 'Planejamento',
    style: { fill: '#eff6ff', fillOpacity: 0.6, stroke: '#d4d4d8' },
    childIds,
    visible: true,
    locked: false,
  };
  layerChildIds.push(BOARDS_BENCHMARK_BOARD_ID);

  return {
    schemaVersion: 1,
    id: `doc-benchmark-boards-${seed}`,
    nodes,
    layers: [
      {
        id: 'layer-bench',
        name: 'Benchmark Layer',
        visible: true,
        locked: false,
        childIds: layerChildIds,
      },
    ],
  };
}
