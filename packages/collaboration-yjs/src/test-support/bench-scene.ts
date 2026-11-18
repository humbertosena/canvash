import { validateDocument, type CanvasDocument } from '@canvash/core';

/** PRNG Mulberry32: a mesma cena em toda medição. */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Um documento de retângulos e elipses, no formato das cenas dos benchmarks do renderer. */
export function benchmarkDocument(count: number, documentId = 'doc-benchmark'): CanvasDocument {
  const random = createPrng(42);
  const nodes: Record<string, unknown> = {};
  const childIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `node-${index}`;
    nodes[id] = {
      id,
      type: index % 2 === 0 ? 'rectangle' : 'ellipse',
      x: Math.round((random() * 5000 - 2500) * 10) / 10,
      y: Math.round((random() * 4000 - 2000) * 10) / 10,
      width: Math.round((40 + random() * 120) * 10) / 10,
      height: Math.round((40 + random() * 120) * 10) / 10,
      rotation: Math.round((random() * 2 * Math.PI - Math.PI) * 100) / 100,
      visible: true,
      locked: false,
      style: {
        fill: '#2563eb',
        stroke: '#0f172a',
        strokeWidth: 1 + Math.floor(random() * 3),
        opacity: Math.round((0.8 + random() * 0.2) * 100) / 100,
      },
    };
    childIds.push(id);
  }
  const document = {
    schemaVersion: 1,
    id: documentId,
    nodes,
    layers: [{ id: 'layer-default', name: 'Camada 1', visible: true, locked: false, childIds }],
  };
  const checked = validateDocument(document);
  if (!checked.ok) throw new Error(`a cena do benchmark não é válida: ${checked.error.message}`);
  return checked.value;
}

/** Percentil `p` (0 a 1) de uma amostra, pelo método do posto mais próximo. */
export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}
