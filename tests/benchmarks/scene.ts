/**
 * Gerador determinístico de cena de benchmark com 10.000 nós.
 * Utiliza PRNG Mulberry32 com semente fixa para garantir reprodutibilidade exata.
 */

export interface BenchmarkShapeStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly opacity: number;
}

export interface BenchmarkShape {
  readonly id: string;
  readonly type: 'rectangle' | 'ellipse';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly style: BenchmarkShapeStyle;
}

export interface BenchmarkDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly nodes: Record<string, BenchmarkShape>;
  readonly layers: readonly [
    {
      readonly id: string;
      readonly name: string;
      readonly visible: true;
      readonly locked: false;
      readonly childIds: readonly string[];
    },
  ];
}

const PALETTE = [
  '#2563eb',
  '#1d4ed8',
  '#16a34a',
  '#15803d',
  '#ea580c',
  '#c2410c',
  '#dc2626',
  '#b91c1c',
  '#9333ea',
  '#7e22ce',
  '#0891b2',
  '#0e7490',
  '#ca8a04',
  '#a16207',
  '#475569',
  '#334155',
] as const;

/**
 * PRNG Mulberry32 determinístico.
 */
export function createPrng(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gera documento com 10.000 nós (5.000 retângulos e 5.000 elipses) com semente fixa.
 *
 * Dimensão do mundo: [-2500, +2500] em x, [-2000, +2000] em y.
 * Em um viewport de 1440×900 com zoom 1 na origem, aproximadamente 600 a 700 nós
 * ficam dentro da visão ("até 1.000 visíveis").
 */
export function generateBenchmarkScene(seed = 42, totalNodes = 10000): BenchmarkDocument {
  const random = createPrng(seed);

  const nodes: Record<string, BenchmarkShape> = {};
  const childIds: string[] = [];

  for (let i = 0; i < totalNodes; i += 1) {
    const id = `node-${i}`;
    const type = i % 2 === 0 ? 'rectangle' : 'ellipse';

    // Posições no intervalo [-2500, +2500] x [-2000, +2000]
    const x = Math.round((random() * 5000 - 2500) * 10) / 10;
    const y = Math.round((random() * 4000 - 2000) * 10) / 10;

    // Dimensões de 40 a 160 px
    const width = Math.round((40 + random() * 120) * 10) / 10;
    const height = Math.round((40 + random() * 120) * 10) / 10;

    // Rotação entre -PI e +PI
    const rotation = Math.round((random() * 2 * Math.PI - Math.PI) * 100) / 100;

    const fillIndex = Math.floor(random() * PALETTE.length);
    const fill = PALETTE[fillIndex] ?? '#2563eb';
    const strokeWidth = Math.floor(random() * 3) + 1; // 1, 2 ou 3 px

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
      style: {
        fill,
        stroke: '#0f172a',
        strokeWidth,
        opacity: Math.round((0.8 + random() * 0.2) * 100) / 100,
      },
    };

    childIds.push(id);
  }

  return {
    schemaVersion: 1,
    id: `doc-benchmark-${seed}`,
    nodes,
    layers: [
      {
        id: 'layer-bench',
        name: 'Benchmark Layer',
        visible: true,
        locked: false,
        childIds,
      },
    ],
  };
}
