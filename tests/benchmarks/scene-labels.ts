/**
 * Gerador determinístico da cena de benchmark do texto dentro das formas: 10.000 retângulos e
 * elipses espalhados como na cena do Marco 2, metade deles com um texto de três linhas.
 *
 * Mesmo PRNG e mesma semente da cena do Marco 2, para a medição ser reproduzível. As formas são
 * um pouco maiores que as do Marco 2 (de 100 a 220 de largura e de 70 a 150 de altura), para o
 * texto caber na área inscrita sem virar só recorte.
 */

import { createPrng } from './scene.js';

export { createPrng } from './scene.js';

/** O `label` completo, como o documento guardado exige: sem campos opcionais. */
export interface LabelsBenchmarkLabel {
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight: 'normal';
  readonly color: null;
  readonly textAlign: 'center';
  readonly verticalAlign: 'middle';
}

export interface LabelsBenchmarkShape {
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
  readonly label?: LabelsBenchmarkLabel;
}

export interface LabelsBenchmarkDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly nodes: Record<string, LabelsBenchmarkShape>;
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

/** Tamanho do texto da cena, em unidades do documento. */
export const LABELS_BENCHMARK_FONT_SIZE = 14;

/** O texto de três linhas do `i`-ésimo nó: o número muda a cada forma, como numa cena real. */
export function labelsBenchmarkText(i: number): string {
  return `Etapa ${i}\nresponsável ${(i % 17) + 1}\nprazo ${(i % 28) + 1}`;
}

/**
 * Gera o documento. Os nós de índice par têm texto (5.000 de 10.000); entre eles, metade é
 * retângulo e metade é elipse, e o mesmo vale para os de índice ímpar, sem texto.
 */
export function generateLabelsBenchmarkScene(
  seed = 42,
  totalNodes = 10000,
): LabelsBenchmarkDocument {
  const random = createPrng(seed);
  const nodes: Record<string, LabelsBenchmarkShape> = {};
  const childIds: string[] = [];

  for (let i = 0; i < totalNodes; i += 1) {
    const id = `node-${i}`;
    const type = i % 4 < 2 ? 'rectangle' : 'ellipse';
    const x = Math.round((random() * 5000 - 2500) * 10) / 10;
    const y = Math.round((random() * 4000 - 2000) * 10) / 10;
    const width = Math.round((100 + random() * 120) * 10) / 10;
    const height = Math.round((70 + random() * 80) * 10) / 10;
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
      ...(i % 2 === 0
        ? {
            label: {
              text: labelsBenchmarkText(i),
              fontSize: LABELS_BENCHMARK_FONT_SIZE,
              fontFamily: 'sans-serif',
              fontWeight: 'normal',
              color: null,
              textAlign: 'center',
              verticalAlign: 'middle',
            },
          }
        : {}),
    };
    childIds.push(id);
  }

  return {
    schemaVersion: 1,
    id: `doc-benchmark-labels-${seed}`,
    nodes,
    layers: [
      { id: 'layer-bench', name: 'Benchmark Layer', visible: true, locked: false, childIds },
    ],
  };
}
