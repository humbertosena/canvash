/**
 * Gerador determinístico da cena de benchmark da caneta: 1.000 elementos de traço à mão livre,
 * cada um com um traço de 200 pontos, espalhados por uma área que um viewport de 1440 × 900 cobre
 * boa parte do tempo (pan/zoom com 500 a 1.000 elementos visíveis).
 *
 * Mesmo PRNG e mesma semente da cena do Marco 2, para a medição ser reproduzível.
 */

import { createPrng } from './scene.js';

export { createPrng } from './scene.js';

export interface InkBenchmarkPoint {
  readonly x: number;
  readonly y: number;
}

export interface InkBenchmarkStroke {
  readonly points: readonly InkBenchmarkPoint[];
  readonly color: string;
  readonly kind: 'pen' | 'marker' | 'highlighter';
  readonly width: 'thin' | 'medium' | 'thick';
}

export interface InkBenchmarkNode {
  readonly id: string;
  readonly type: 'ink';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly strokes: readonly InkBenchmarkStroke[];
  readonly visible: boolean;
  readonly locked: boolean;
  readonly style: { readonly opacity: number };
}

export interface InkBenchmarkDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly nodes: Record<string, InkBenchmarkNode>;
  readonly layers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly visible: boolean;
    readonly locked: boolean;
    readonly childIds: readonly string[];
  }>;
}

const PALETTE = [
  '#1f2937',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;
const KINDS = ['pen', 'marker', 'highlighter'] as const;
const WIDTHS = ['thin', 'medium', 'thick'] as const;

/** Largura e altura da área em que os elementos ficam, em unidades do documento. */
export const INK_BENCHMARK_AREA = { width: 2000, height: 1300 } as const;

/**
 * Gera o documento. Cada elemento tem uma caixa de 80 a 200 de lado, sem rotação em dois terços
 * dos casos, e um traço de `pointsPerInk` pontos locais que serpenteia pela caixa.
 */
export function generateInkBenchmarkScene(
  seed = 42,
  count = 1000,
  pointsPerInk = 200,
): InkBenchmarkDocument {
  const random = createPrng(seed);
  const nodes: Record<string, InkBenchmarkNode> = {};
  const childIds: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const id = `ink-${i}`;
    const width = Math.round((80 + random() * 120) * 10) / 10;
    const height = Math.round((80 + random() * 120) * 10) / 10;
    const x = Math.round((random() * INK_BENCHMARK_AREA.width - 500) * 10) / 10;
    const y = Math.round((random() * INK_BENCHMARK_AREA.height - 300) * 10) / 10;
    const rotation =
      random() < 0.33 ? Math.round((random() * 2 * Math.PI - Math.PI) * 100) / 100 : 0;

    // Serpentina: o x anda de 0 a 1 e o y oscila com fase e frequência próprias do elemento.
    const phase = random() * 2 * Math.PI;
    const turns = 2 + random() * 6;
    const points: InkBenchmarkPoint[] = [];
    for (let k = 0; k < pointsPerInk; k += 1) {
      const t = k / (pointsPerInk - 1);
      const wave = 0.5 + 0.45 * Math.sin(phase + t * turns * Math.PI);
      points.push({ x: Math.round(t * 1e6) / 1e6, y: Math.round(wave * 1e6) / 1e6 });
    }

    nodes[id] = {
      id,
      type: 'ink',
      x,
      y,
      width,
      height,
      rotation,
      strokes: [
        {
          points,
          color: PALETTE[Math.floor(random() * PALETTE.length)] ?? '#1f2937',
          kind: KINDS[Math.floor(random() * KINDS.length)] ?? 'pen',
          width: WIDTHS[Math.floor(random() * WIDTHS.length)] ?? 'medium',
        },
      ],
      visible: true,
      locked: false,
      style: { opacity: 1 },
    };
    childIds.push(id);
  }

  return {
    schemaVersion: 1,
    id: `doc-benchmark-ink-${seed}`,
    nodes,
    layers: [
      { id: 'layer-bench', name: 'Benchmark Layer', visible: true, locked: false, childIds },
    ],
  };
}
